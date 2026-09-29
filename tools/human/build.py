#!/usr/bin/env python3
"""
Build the web human from CC0 MakeHuman / MPFB data.

    tools/human/fetch.sh            # sparse-clone the sources (once)
    python3 tools/human/build.py    # writes web/public/human/

Outputs
  human.json     manifest: bones, joints, targets, section table
  human.bin      brotli-compressed binary (base mesh, targets, weights, eyes)
  skin_a.png     packed region masks  R lips  G areolae  B nails  A eyelids
  skin_b.png     packed region masks  R ears  G mouth    B face   A crotch
  eye.png        eye texture

Everything stays in MakeHuman's native space (decimetres, y up, faces +z);
the browser applies targets, fits the skeleton and converts to metres.
"""
import glob
import json
import os
import sys

import brotli
import numpy as np
from PIL import Image

import paint

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '.src')
OUT = os.path.join(HERE, '..', '..', 'web', 'public', 'human')
MH = os.path.join(SRC, 'makehuman', 'makehuman', 'data')
MPFB = os.path.join(SRC, 'mpfb2', 'src', 'mpfb', 'data')
RIG = 'game_engine'
STEP = 0.00025  # target quantisation step (dm) = 0.025 mm


def parse_obj(path):
    V, VT, faces, group = [], [], [], None
    for line in open(path):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            group = line.split()[1]
        elif line.startswith('f '):
            corners = []
            for c in line.split()[1:]:
                p = c.split('/')
                corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            faces.append((group, corners))
    return np.array(V, np.float32), np.array(VT, np.float32), faces


class Split:
    """Split vertices on UV seams: one render vertex per (position, uv) pair."""

    def __init__(self):
        self.key, self.src, self.uv = {}, [], []

    def tris(self, faces, VT):
        out = []
        for corners in faces:
            ids = []
            for v, t in corners:
                k = (v, t)
                if k not in self.key:
                    self.key[k] = len(self.src)
                    self.src.append(v)
                    self.uv.append(VT[t] if t >= 0 else (0.0, 0.0))
                ids.append(self.key[k])
            for i in range(1, len(ids) - 1):
                out += [ids[0], ids[i], ids[i + 1]]
        return np.array(out, np.uint32)


class Blob:
    def __init__(self):
        self.parts, self.table, self.size = [], {}, 0

    def add(self, name, arr):
        arr = np.ascontiguousarray(arr)
        b = arr.tobytes()
        pad = (-self.size) % 4
        if pad:
            self.parts.append(b'\0' * pad)
            self.size += pad
        self.table[name] = [self.size, int(arr.size), str(arr.dtype)]
        self.parts.append(b)
        self.size += len(b)


def main():
    os.makedirs(OUT, exist_ok=True)
    blob = Blob()

    # ---------------------------------------------------------------- base mesh
    V, VT, faces = parse_obj(os.path.join(MH, '3dobjs', 'base.obj'))
    N = len(V)
    groups = json.load(open(os.path.join(MPFB, 'mesh_metadata', 'basemesh_vertex_groups.json')))

    def group_verts(name):
        out = []
        for a, b in groups[name]:
            out += range(a, b + 1)
        return out

    split = Split()
    by_group = lambda pred: [c for g, c in faces if pred(g)]
    parts = {
        'body': split.tris(by_group(lambda g: g == 'body'), VT),
        'lashes': split.tris(by_group(lambda g: g.startswith('helper-l-eyelashes') or g.startswith('helper-r-eyelashes')), VT),
        'teeth': split.tris(by_group(lambda g: g in ('helper-upper-teeth', 'helper-lower-teeth')), VT),
        'tongue': split.tris(by_group(lambda g: g == 'helper-tongue'), VT),
        'tights': split.tris(by_group(lambda g: g == 'helper-tights'), VT),
        'skirt': split.tris(by_group(lambda g: g == 'helper-skirt'), VT),
        'hair': split.tris(by_group(lambda g: g == 'helper-hair'), VT),
    }
    blob.add('base', V)
    blob.add('render.src', np.array(split.src, np.uint16))
    blob.add('render.uv', np.array(split.uv, np.float32))
    for k, idx in parts.items():
        blob.add(f'index.{k}', idx)
    print(f'base: {N} verts, {len(split.src)} render verts', {k: len(v) // 3 for k, v in parts.items()})

    # ---------------------------------------------------------------- rig
    rig = json.load(open(os.path.join(MPFB, 'rigs', 'standard', f'rig.{RIG}.json')))
    order, seen = [], set()

    def visit(name):
        if name in seen:
            return
        p = rig[name]['parent']
        if p:
            visit(p)
        seen.add(name)
        order.append(name)

    for name in sorted(rig):
        visit(name)

    joints, joint_index = [], {}

    def joint(spec):
        key = spec.get('cube_name') or 'mean:' + ','.join(map(str, spec['vertex_indices']))
        if key not in joint_index:
            verts = group_verts(spec['cube_name']) if spec['strategy'] == 'CUBE' else spec['vertex_indices']
            joint_index[key] = len(joints)
            joints.append({'name': key, 'verts': verts})
        return joint_index[key]

    bones = []
    for name in order:
        b = rig[name]
        bones.append({'name': name, 'parent': order.index(b['parent']) if b['parent'] else -1,
                      'head': joint(b['head']), 'tail': joint(b['tail'])})
    for extra in ('joint-l-eye', 'joint-r-eye', 'joint-l-eye-target', 'joint-r-eye-target', 'joint-jaw', 'joint-mouth'):
        joint({'strategy': 'CUBE', 'cube_name': extra})

    weights = json.load(open(os.path.join(MPFB, 'rigs', 'standard', f'weights.{RIG}.json')))['weights']
    infl = [[] for _ in range(N)]
    for bname, lst in weights.items():
        bi = order.index(bname)
        for vi, w in lst:
            infl[vi].append((w, bi))
    skin_i = np.zeros((N, 4), np.uint8)
    skin_w = np.zeros((N, 4), np.uint16)
    head_bone = order.index('head')
    for vi, lst in enumerate(infl):
        lst = sorted(lst, reverse=True)[:4]
        if not lst:
            lst = [(1.0, head_bone)]  # unweighted helper verts ride with the head
        tot = sum(w for w, _ in lst)
        for k, (w, bi) in enumerate(lst):
            skin_i[vi, k] = bi
            skin_w[vi, k] = round(w / tot * 65535)
    blob.add('skin.index', skin_i)
    blob.add('skin.weight', skin_w)
    print(f'rig {RIG}: {len(bones)} bones, {len(joints)} joints')

    # ---------------------------------------------------------------- eyes (mhclo proxy)
    EV, EVT, efaces = parse_obj(os.path.join(MH, 'eyes', 'high-poly', 'high-poly.obj'))
    refs, wts, offs, scales, in_verts = [], [], [], {}, False
    for line in open(os.path.join(MH, 'eyes', 'high-poly', 'high-poly.mhclo')):
        t = line.split()
        if not t or t[0].startswith('#'):
            continue
        if t[0] in ('x_scale', 'y_scale', 'z_scale'):
            scales[t[0][0]] = [int(t[1]), int(t[2]), float(t[3])]
        elif t[0] == 'verts':
            in_verts = True
        elif in_verts and len(t) == 9:
            refs.append([int(x) for x in t[:3]])
            wts.append([float(x) for x in t[3:6]])
            offs.append([float(x) for x in t[6:9]])
        elif in_verts and len(t) == 1 and t[0].isdigit():
            refs.append([int(t[0])] * 3)
            wts.append([1.0, 0.0, 0.0])
            offs.append([0.0, 0.0, 0.0])
        elif in_verts:
            in_verts = False
    assert len(refs) == len(EV), (len(refs), len(EV))
    esplit = Split()
    eidx = esplit.tris([c for _, c in efaces], EVT)
    blob.add('eye.ref', np.array(refs, np.uint16))
    blob.add('eye.w', np.array(wts, np.float32))
    blob.add('eye.off', np.array(offs, np.float32))
    blob.add('eye.src', np.array(esplit.src, np.uint16))
    blob.add('eye.uv', np.array(esplit.uv, np.float32))
    blob.add('eye.index', eidx)
    # which eye each proxy vertex belongs to (for skinning to the head / aiming)
    print(f'eyes: {len(EV)} verts')

    # ---------------------------------------------------------------- painted detail (brows, scalp, beard)
    eye = lambda s: V[group_verts(f'joint-{s}-eye')].mean(0)
    ears = Image.open(os.path.join(MPFB, 'textures', 'mpfb_ears.jpg')).convert('L')
    detail = paint.paint(V, VT, faces, eye('l'), eye('r'), ears)
    g = np.asarray(detail)[:, :, 1].astype(np.float32) / 255
    uv = np.array(split.uv)
    px = np.clip((uv[:, 0] * paint.S).astype(int), 0, paint.S - 1)
    py = np.clip(((1 - uv[:, 1]) * paint.S).astype(int), 0, paint.S - 1)
    scalp = (g[py, px] * 255).astype(np.uint8)
    body_render = np.zeros(len(split.src), bool)
    body_render[parts['body']] = True
    scalp[~body_render] = 0
    blob.add('render.scalp', scalp)
    print(f'scalp: {(scalp > 8).sum()} render verts')

    # ---------------------------------------------------------------- underwear (body surface + painted outline)
    J = lambda n: V[group_verts(n)].mean(0)
    bv = V[:13380]
    chest = bv[(bv[:, 0] > 0.4) & (bv[:, 0] < 1.6) & (bv[:, 1] > 2.2) & (bv[:, 1] < 4.5)]
    apex = chest[chest[:, 2].argmax()]
    lm = {
        'crotch': bv[(np.abs(bv[:, 0]) < 0.08) & (bv[:, 1] > -1.5) & (bv[:, 1] < 1.0)][:, 1].min(),
        'waist': J('joint-pelvis')[1] + 0.32,
        'apex': apex,
        'ub': apex[1] - 0.72,
    }
    uw_img, uw_tris = paint.paint_underwear(V, VT, faces, lm)
    uw_img.save(os.path.join(OUT, 'underwear.png'), optimize=True)
    body_idx = parts['body'].reshape(-1, 3)
    for name, ids in zip(('briefs', 'boxers', 'bra'), uw_tris):
        blob.add(f'index.{name}', body_idx[ids].ravel().astype(np.uint32))
    print('underwear:', {n: len(t) for n, t in zip(('briefs', 'boxers', 'bra'), uw_tris)})

    # ---------------------------------------------------------------- targets
    T = os.path.join(MH, 'targets')
    patterns = [
        'macrodetails/universal-*-young-*', 'macrodetails/universal-*-old-*',
        'macrodetails/*-young.target', 'macrodetails/*-old.target',
        'macrodetails/height/*-young-*', 'macrodetails/height/*-old-*',
        'macrodetails/proportions/*-young-*', 'macrodetails/proportions/*-old-*',
        'breast/*male-young-*', 'breast/*male-old-*', 'breast/breast-*', 'breast/nipple-*',
        # local shaping: body width (shoulders / torso / hips) and a fit, athletic build
        'measure/measure-shoulder-dist-*', 'torso/torso-scale-horiz-*', 'hip/hip-scale-horiz-*',
        'torso/torso-vshape-*', 'torso/torso-muscle-pectoral-*', 'torso/torso-muscle-dorsi-*',
        'stomach/stomach-tone-*', 'buttocks/buttocks-volume-*',
        # body design: limb muscle/fat and circumferences
        'armslegs/?-upperarm-muscle-*', 'armslegs/?-upperarm-shoulder-muscle-*', 'armslegs/?-lowerarm-muscle-*',
        'armslegs/?-upperleg-muscle-*', 'armslegs/?-lowerleg-muscle-*', 'armslegs/?-upperleg-fat-*',
        'measure/measure-waist-circ-*', 'measure/measure-hips-circ-*', 'measure/measure-thigh-circ-*',
        'measure/measure-bust-circ-*', 'measure/measure-upperarm-circ-*', 'measure/measure-calf-circ-*',
        'measure/measure-neck-circ-*',
        # silhouette matching (design.py --match): proportions, segment lengths, limb and head scales
        'measure/measure-*-dist-*', 'measure/measure-*-length-*', 'measure/measure-*-height-*',
        'measure/measure-knee-circ-*', 'measure/measure-ankle-circ-*', 'measure/measure-wrist-circ-*',
        'measure/measure-underbust-circ-*', 'torso/torso-scale-depth-*', 'torso/torso-scale-vert-*',
        'hip/hip-scale-depth-*', 'hip/hip-scale-vert-*', 'stomach/stomach-pregnant-*',
        'armslegs/?-upperarm-scale-*', 'armslegs/?-lowerarm-scale-*', 'armslegs/?-upperleg-scale-*',
        'armslegs/?-lowerleg-scale-*', 'armslegs/?-lowerleg-fat-*', 'armslegs/?-upperarm-fat-*', 'armslegs/?-lowerarm-fat-*',
        'neck/neck-scale-*', 'head/head-scale-*',
    ]
    files = []
    for p in patterns:
        files += [f for f in sorted(glob.glob(os.path.join(T, p))) if f not in files]
    targets, gaps, vals = [], [], []
    for f in files:
        rows = [l.split() for l in open(f) if l[:1].isdigit()]
        if not rows:
            continue
        d = np.zeros((N, 3), np.float64)
        arr = np.array(rows, np.float64)
        d[arr[:, 0].astype(int)] = arr[:, 1:4]
        q = np.round(d / STEP).astype(np.int32)
        assert np.abs(q).max() < 32767
        nz = np.nonzero(np.any(q != 0, axis=1))[0]
        if not len(nz):
            continue
        g = np.diff(np.concatenate([[-1], nz])) - 1
        gaps.append(g.astype(np.uint16))
        vals.append(q[nz].astype(np.int16))
        name = os.path.relpath(f, T).replace('macrodetails/', '').replace('.target', '')
        if name.split('/')[0] in ('measure', 'torso', 'hip', 'stomach', 'buttocks', 'armslegs', 'neck', 'head'):
            name = 'local/' + name.split('/')[1]
        targets.append([name, int(len(nz))])
    g = np.concatenate(gaps)
    v = np.concatenate(vals)
    # byte planes compress far better than interleaved records
    blob.add('targets.gaps', np.concatenate([g.view(np.uint8)[0::2], g.view(np.uint8)[1::2]]))
    planes = []
    for c in range(3):
        col = np.ascontiguousarray(v[:, c])
        planes += [col.view(np.uint8)[0::2], col.view(np.uint8)[1::2]]
    blob.add('targets.vals', np.concatenate(planes))
    print(f'targets: {len(targets)} files, {len(g)} entries')

    # ---------------------------------------------------------------- write
    raw = b''.join(blob.parts)
    packed = brotli.compress(raw, quality=11, lgwin=24)
    open(os.path.join(OUT, 'human.bin'), 'wb').write(packed)
    manifest = {
        'version': 1,
        'source': 'MakeHuman / MPFB (CC0) — see LICENSE.md',
        'units': 'decimetre',
        'vertexCount': N,
        'renderVertexCount': len(split.src),
        'eyeVertexCount': len(EV),
        'eyeRenderVertexCount': len(esplit.src),
        'eyeScale': scales,
        'targetStep': STEP,
        'bytes': len(raw),
        'sections': blob.table,
        'bones': bones,
        'joints': joints,
        'targets': targets,
        'groups': {k: groups[k] for k in ('body', 'helper-tights', 'helper-skirt', 'helper-hair')},
    }
    json.dump(manifest, open(os.path.join(OUT, 'human.json'), 'w'), separators=(',', ':'))
    print(f'human.bin {len(raw) / 1e6:.2f} MB raw → {len(packed) / 1e6:.2f} MB brotli')

    # ---------------------------------------------------------------- textures
    tex = os.path.join(MPFB, 'textures')
    S = 1024
    m = lambda n: Image.open(os.path.join(tex, f'mpfb_{n}.jpg')).convert('L').resize((S, S), Image.LANCZOS)
    nails = Image.fromarray(np.maximum(np.asarray(m('fingernails')), np.asarray(m('toenails'))))
    Image.merge('RGBA', (m('lips'), m('aureolae'), nails, m('eyelids'))).save(os.path.join(OUT, 'skin_a.png'), optimize=True)
    Image.merge('RGBA', (m('ears'), m('inside-mouth'), m('face'), m('crotch'))).save(os.path.join(OUT, 'skin_b.png'), optimize=True)
    Image.open(os.path.join(MH, 'eyes', 'materials', 'brown_eye.png')).convert('RGBA').save(os.path.join(OUT, 'eye.png'), optimize=True)
    detail.save(os.path.join(OUT, 'detail.png'), optimize=True)
    for f in ('human.json', 'human.bin', 'skin_a.png', 'skin_b.png', 'eye.png', 'detail.png', 'underwear.png'):
        print(f'  {f:12s} {os.path.getsize(os.path.join(OUT, f)) / 1e3:8.0f} kB')


if __name__ == '__main__':
    main()
