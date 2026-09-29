#!/usr/bin/env python3
"""
Turn the studio's body models (assets/*.fbx) into web-ready rigged GLBs.

    (lab dev server running)  node tools/body/extract.mjs     # FBX → tools/body/out/<name>.json (mesh + skeleton)
    python3 tools/body/prepare.py                             # → web/public/body/{male,female}.glb

- welds the mesh (one vertex per position → smooth shading, no texture seams), metres, feet on
  y = 0, centred, facing +z
- skeleton renamed to the pose library's bone names (pelvis, spine_01…, upperarm_l, thumb_01_l …)
  from the model's own rig (Mixamo for the male, Character Creator for the female), keeping its
  skin weights; helper bones (twist, share, breast, face, toes) fold into their parents
- several meshes (body, eyes, teeth, underwear …) merge into one skinned mesh; each vertex is
  tagged with its part (_PART) so the runtime material can colour skin / eyes / fabric / mouth
- bone rest frames follow the runtime's convention (y head → tail, x = y × +z; hands use the palm)
"""
import json
import os
import sys

import numpy as np
from scipy import ndimage as nd, sparse
from scipy.spatial import cKDTree

import glb

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
PUB = os.path.join(HERE, '..', '..', 'web', 'public', 'body')

# ours ← Mixamo
MIXAMO = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2', 'neck_01': 'Neck', 'head': 'Head'}
for s, S in (('l', 'Left'), ('r', 'Right')):
    MIXAMO.update({f'clavicle_{s}': f'{S}Shoulder', f'upperarm_{s}': f'{S}Arm', f'lowerarm_{s}': f'{S}ForeArm',
                   f'hand_{s}': f'{S}Hand', f'thigh_{s}': f'{S}UpLeg', f'calf_{s}': f'{S}Leg', f'foot_{s}': f'{S}Foot',
                   f'ball_{s}': f'{S}ToeBase'})
    for f, F in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
        for k in (1, 2, 3):
            MIXAMO[f'{f}_0{k}_{s}'] = f'{S}Hand{F}{k}'
HAND_CHAIN = ('hand_', 'thumb_', 'index_', 'middle_', 'ring_', 'pinky_')

# ours ← Character Creator (CC3/CC4, "CC_Base_" prefix stripped)
CC = {'pelvis': 'Hip', 'spine_01': 'Waist', 'spine_02': 'Spine01', 'spine_03': 'Spine02', 'neck_01': 'NeckTwist01', 'head': 'Head'}
for s, S in (('l', 'L_'), ('r', 'R_')):
    CC.update({f'clavicle_{s}': f'{S}Clavicle', f'upperarm_{s}': f'{S}Upperarm', f'lowerarm_{s}': f'{S}Forearm',
               f'hand_{s}': f'{S}Hand', f'thigh_{s}': f'{S}Thigh', f'calf_{s}': f'{S}Calf', f'foot_{s}': f'{S}Foot',
               f'ball_{s}': f'{S}ToeBase'})
    for f, F in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Mid'), ('ring', 'Ring'), ('pinky', 'Pinky')):
        for k in (1, 2, 3):
            CC[f'{f}_0{k}_{s}'] = f'{S}{F}{k}'
strip = lambda n: n.replace('mixamorig1', '').replace('mixamorig', '').replace('CC_Base_', '')

# parts (runtime material): 0 skin, 1 eye, 4 fabric, 5 teeth, 6 tongue
PART = {'skin': 0, 'eye': 1, 'fabric': 4, 'teeth': 5, 'tongue': 6}



def weld(P, N, tol=1e-4):
    """one vertex per position; normals recomputed from faces (area weighted)"""
    key = np.round(P / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    V = P[first]
    F = inv.reshape(-1, 3)
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return V, F, first, inv


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    n = np.zeros_like(V)
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def frames(names, parents, heads, tails, palm):
    """rest world orientations (xyzw) per bone, runtime convention"""
    out = []
    FWD, DOWN = np.array([0, 0, 1.0]), np.array([0, -1.0, 0])
    for i, n in enumerate(names):
        y = tails[i] - heads[i]
        if np.linalg.norm(y) < 1e-6 or parents[i] < 0:
            out.append(np.array([0, 0, 0, 1.0]))
            continue
        y = y / np.linalg.norm(y)
        if n.startswith(HAND_CHAIN):
            x = np.cross(y, -palm[n[-1]])
        elif n.startswith(('foot_', 'ball_')):  # point forward: roll from "up", never a switching axis
            x = np.cross(y, np.array([0, 1.0, 0]))
        else:
            x = np.cross(y, FWD)
            if np.dot(x, x) < 0.04:
                x = np.cross(y, DOWN)
        x /= np.linalg.norm(x)
        z = np.cross(x, y)
        z /= np.linalg.norm(z)
        x = np.cross(y, z)
        R = np.stack([x, y, z], 1)
        out.append(glb.mat_to_quat(R))
    return np.array(out)


def tails_of(names, parents, heads, extra_tails):
    """tail = the (first-listed / main) child's head, else a given end point"""
    tails = heads.copy()
    prefer = {'pelvis': 'spine_01', 'spine_03': 'neck_01', 'hand_l': 'middle_01_l', 'hand_r': 'middle_01_r'}
    for i, n in enumerate(names):
        kids = [j for j in range(len(names)) if parents[j] == i]
        if n in prefer and prefer[n] in names:
            tails[i] = heads[names.index(prefer[n])]
        elif kids:
            tails[i] = heads[kids[0]]
        elif n in extra_tails:
            tails[i] = extra_tails[n]
        else:
            p = parents[i]
            tails[i] = heads[i] + (heads[i] - heads[p]) * 0.6
    return tails


def palm_normals(names, heads):
    pal = {}
    for s, sg in (('l', 1), ('r', -1)):
        if f'index_01_{s}' not in names:  # no finger bones: hanging hand, back of the hand faces out
            pal[s] = np.array([sg, 0.0, 0.0])
            continue
        w, a, b = (heads[names.index(f'{k}_{s}')] for k in ('hand', 'index_01', 'pinky_01'))
        n = np.cross(a - w, b - w)
        n /= np.linalg.norm(n)
        if n[0] * sg < 0:
            n = -n
        pal[s] = n
    return pal


ARM = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
LEG = ('thigh', 'calf', 'foot', 'ball')


def chain_weight(names, J4, W4, prefixes, side=None):
    ids = [i for i, n in enumerate(names) if n.split('_')[0] in prefixes and (side is None or n.endswith('_' + side))]
    return (W4 * np.isin(J4, ids)).sum(1)


def width_morph(V, names, heads, J4, W4):
    """
    One morph target "width" (+1 = shoulders 20 % wider): the chest/shoulders spread, the arms move
    out without getting thicker, the hips follow a little, the head and neck stay. Also returns
    how far each bone's head moves, so the runtime can rebind the skeleton to the widened body.
    """
    H = lambda n: heads[names.index(n)]
    y_sh = (H('upperarm_l')[1] + H('upperarm_r')[1]) / 2
    y_hip = (H('thigh_l')[1] + H('thigh_r')[1]) / 2
    y_neck = H('neck_01')[1]
    xs = {s: abs(H(f'upperarm_{s}')[0]) for s in 'lr'}
    xh = {s: abs(H(f'thigh_{s}')[0]) for s in 'lr'}
    K_SH, K_HIP = 0.20, 0.07
    y = V[:, 1]
    a = K_HIP + (K_SH - K_HIP) * np.clip((y - y_hip) / (y_sh - y_hip), 0, 1)
    a *= 1 - np.clip((y - y_sh) / max(y_neck + 0.03 - y_sh, 1e-3), 0, 1)
    dx = np.zeros(len(V))
    w_rest = np.ones(len(V))
    for s, sg in (('l', 1), ('r', -1)):
        wa = chain_weight(names, J4, W4, ARM, s)
        wl = chain_weight(names, J4, W4, LEG, s)
        dx += wa * sg * xs[s] * K_SH + wl * sg * xh[s] * K_HIP
        w_rest -= wa + wl
    dx += np.clip(w_rest, 0, 1) * V[:, 0] * a
    D = np.zeros_like(V)
    D[:, 0] = dx
    bone_dx = []
    for n, h in zip(names, heads):
        sd = n[-1] if n[-2:] in ('_l', '_r') else None
        sg = {'l': 1, 'r': -1}.get(sd, 0)
        if n.split('_')[0] in ARM:
            bone_dx.append(sg * xs[sd] * K_SH)
        elif n.split('_')[0] in LEG:
            bone_dx.append(sg * xh[sd] * K_HIP)
        elif n.startswith('clavicle'):
            bone_dx.append(h[0] * K_SH)
        else:
            bone_dx.append(0.0)
    return D, bone_dx


def shoulder_points(V, names, heads, part=None):
    """the bony shoulder tips (acromion): outermost skin vertex on top of each shoulder"""
    out = {}
    for s, sg in (('l', 1), ('r', -1)):
        h = heads[names.index(f'upperarm_{s}')]
        m = (V[:, 1] > h[1] + 0.015) & (V[:, 1] < h[1] + 0.07) & (sg * V[:, 0] > 0) & (sg * V[:, 0] < sg * h[0] + 0.035) & (np.abs(V[:, 2] - h[2]) < 0.06)
        if part is not None:
            m &= part == 0
        idx = np.nonzero(m)[0]
        out[s] = int(idx[np.argmax(sg * V[idx, 0])])
    return out


def export(name, V, F, names, parents, heads, tails, J, Wt, extra=None, part=None, eyes=None):
    os.makedirs(PUB, exist_ok=True)
    pal = palm_normals(names, heads)
    rot = frames(names, parents, heads, tails, pal)
    N = vertex_normals(V, F)
    order = np.argsort(-Wt, 1)[:, :4]
    J4 = np.take_along_axis(J, order, 1)
    W4 = np.take_along_axis(Wt, order, 1)
    W4 /= W4.sum(1, keepdims=True)
    D, bone_dx = width_morph(V, names, heads, J4, W4)
    probes = shoulder_points(V, names, heads, part)
    extras = {'widthBoneDx': [round(float(v), 5) for v in bone_dx], 'shoulderProbes': probes, 'eyes': eyes or {},
              'tails': [[round(float(c), 5) for c in t] for t in tails]}
    glb.write(os.path.join(PUB, f'{name}.glb'), V, N, F, attrs=extra,
              skin={'names': names, 'parents': parents, 'heads': heads, 'rot': rot, 'joints': J4, 'weights': W4},
              name=name, targets={'width': D}, extras=extras)
    w = abs(V[probes['l'], 0] - V[probes['r'], 0])
    print(f'{name}: {len(V)} verts, {len(F)} tris, {len(names)} bones, height {V[:, 1].max():.3f} m, shoulder width {w * 100:.1f} cm')


def normalise(V, height=None):
    """metres, feet on the floor, centred on x/z; returns (V, scale, offset)"""
    s = 1.0 if height is None else height / (V[:, 1].max() - V[:, 1].min())
    V = V * s
    off = np.array([-(V[:, 0].max() + V[:, 0].min()) / 2, -V[:, 1].min(), -(V[:, 2].max() + V[:, 2].min()) / 2])
    return V + off, s, off


# --------------------------------------------------------------------------- mannequin head
def mannequin_head(V, F, J, W, part, cut_y, head_bone, neck_bone, blur=0.015, vox=0.0018):
    """
    Turn the head into a plain mannequin head: the real head (skin + eyeballs + teeth, which fill the
    sockets and the mouth) becomes a solid, the ears are shaved off, and the solid is blurred by
    `blur` (m) — nose, lips and eye sockets melt away while the skull and jaw keep their shape. Its
    surface replaces everything above `cut_y`; it reaches a little way down into the kept neck,
    so the joint reads like the male mannequin's head/neck line.
    """
    import trimesh
    from skimage import measure as skm
    skin = part == 0
    fill = (part == 0) | (part == PART['eye']) | (part == PART['teeth'])
    y0 = cut_y - 0.05
    rel_c = np.median(V[skin & (V[:, 1] > cut_y), 0])
    tri = F[(V[F, 1] > y0).all(1) & fill[F].all(1)]
    # sample the surface densely
    A, Bv, C = V[tri[:, 0]], V[tri[:, 1]], V[tri[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(Bv - A, C - A), axis=1)
    n = np.maximum(1, (area / (vox * vox * 0.25)).astype(int))
    idx = np.repeat(np.arange(len(tri)), n)
    u, v = np.random.default_rng(0).random((2, len(idx)))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = A[idx] + (Bv - A)[idx] * u[:, None] + (C - A)[idx] * v[:, None]
    lo = pts.min(0) - 0.03
    hi = pts.max(0) + 0.03
    shape = np.ceil((hi - lo) / vox).astype(int) + 1
    occ = np.zeros(shape[[1, 2, 0]], bool)                      # (y, z, x)
    ijk = np.round((pts - lo) / vox).astype(int)
    occ[ijk[:, 1], ijk[:, 2], ijk[:, 0]] = True
    occ = nd.binary_dilation(occ, iterations=1)
    for k in range(occ.shape[0]):                               # every horizontal slice: fill inside the outline
        occ[k] = nd.binary_fill_holes(occ[k])
    occ = nd.binary_closing(occ, iterations=2)
    for k in range(occ.shape[0]):
        occ[k] = nd.binary_fill_holes(occ[k])
    # shave the ears: in every slice, open with a 2.4 cm disk — thin flaps go, the skull stays
    rr = int(round(0.012 / vox))
    yy, xx = np.mgrid[-rr:rr + 1, -rr:rr + 1]
    disk = xx * xx + yy * yy <= rr * rr
    cut_k = int((cut_y + 0.03 - lo[1]) / vox)
    for k in range(cut_k, occ.shape[0]):
        occ[k] = nd.binary_opening(occ[k], structure=disk)
    fld = nd.gaussian_filter(occ.astype(np.float32), blur / vox)
    fld[: int((cut_y - 0.035 - lo[1]) / vox)] = 0              # open bottom, inside the neck
    vv, ff, _, _ = skm.marching_cubes(fld, 0.5, spacing=(vox, vox, vox))
    HV = np.stack([vv[:, 2], vv[:, 0], vv[:, 1]], 1) + lo       # (y, z, x) → x, y, z
    hm = trimesh.Trimesh(HV, ff, process=True)
    hm = max(hm.split(only_watertight=False), key=lambda m: len(m.faces))
    trimesh.smoothing.filter_taubin(hm, lamb=0.5, nu=-0.53, iterations=25)   # voxel steps → smooth shell
    hm = hm.simplify_quadric_decimation(face_count=12000)
    trimesh.smoothing.filter_taubin(hm, lamb=0.5, nu=-0.53, iterations=20)
    HV, HF = np.asarray(hm.vertices), np.asarray(hm.faces)
    cen = HV[HF].mean(1)
    nrm = np.cross(HV[HF[:, 1]] - HV[HF[:, 0]], HV[HF[:, 2]] - HV[HF[:, 0]])
    axis = np.array([rel_c, 0, np.median(HV[:, 2])])
    outward = cen - axis
    outward[:, 1] = 0
    if np.mean(np.sum(nrm * outward, 1)) < 0:
        HF = HF[:, ::-1]
    # body: drop the old head and every non-skin part up there (eyes, teeth, tongue)
    face_parts = (part == PART['eye']) | (part == PART['teeth']) | (part == PART['tongue'])
    kill = (V[:, 1] > cut_y) | face_parts                   # never the clothing (bra straps reach up here)
    F = F[~kill[F].any(1)]
    wh = np.clip((HV[:, 1] - (cut_y - 0.02)) / 0.04, 0, 1)
    HJ = np.zeros((len(HV), J.shape[1]), int)
    HW = np.zeros((len(HV), W.shape[1]))
    HJ[:, 0], HJ[:, 1] = head_bone, neck_bone
    HW[:, 0], HW[:, 1] = wh, 1 - wh
    n0 = len(V)
    V2, F2 = np.concatenate([V, HV]), np.concatenate([F, HF + n0])
    J2, W2 = np.concatenate([J, HJ]), np.concatenate([W, HW])
    part2 = np.concatenate([part, np.zeros(len(HV), np.float32)])
    used = np.unique(F2)
    remap = -np.ones(len(V2), int)
    remap[used] = np.arange(len(used))
    return V2[used], remap[F2], J2[used], W2[used], part2[used]


# --------------------------------------------------------------------------- boxer briefs
def boxer_briefs(V, F, J, W, part, top, hem):
    """
    Black boxer briefs: a copy of the skin between the waistband (`top`) and the leg hems (`hem`),
    tagged as fabric (the runtime floats fabric 2.5 mm off the skin). Its open edges are snapped onto
    the two cut heights so the waistband and the hems are clean straight lines.
    """
    skin = part == PART['skin']
    inside = skin & (V[:, 1] <= top) & (V[:, 1] >= hem)
    tri = F[inside[F].all(1)]
    used = np.unique(tri)
    remap = -np.ones(len(V), int)
    remap[used] = np.arange(len(used)) + len(V)
    BV = V[used].copy()
    e = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), 1)
    u, cnt = np.unique(e, axis=0, return_counts=True)
    edge_v = np.unique(u[cnt == 1])
    k = remap[edge_v] - len(V)
    y = BV[k, 1]
    BV[k, 1] = np.where(np.abs(y - top) < np.abs(y - hem), top, hem)
    print(f'  boxer briefs: {len(used)} verts, {len(tri)} tris, waistband {top:.3f} m, hems {hem:.3f} m')
    return (np.concatenate([V, BV]), np.concatenate([F, remap[tri]]), np.concatenate([J, J[used]]),
            np.concatenate([W, W[used]]), np.concatenate([part, np.full(len(used), PART['fabric'], np.float32)]))


# --------------------------------------------------------------------------- garment detail lines
def garment_lines(V, F, part, band_edge, band_width):
    """
    Per fabric vertex, for the shader's stitching and elastic band:
      _EDGE  distance (m) to the garment's nearest open edge (hem stitches run parallel to it)
      _BAND  distance to the band edge / band width (< 1 inside the elastic band): the waist edge
             of briefs/boxers ('top'), the underband of a bra ('bottom')
    Non-fabric vertices get large values (no lines).
    """
    edge = np.full(len(V), 9.0, np.float32)
    band = np.full(len(V), 9.0, np.float32)
    fab = part == PART['fabric']
    if not fab.any():
        return edge, band
    Ff = F[fab[F].all(1)]
    e = np.sort(np.concatenate([Ff[:, [0, 1]], Ff[:, [1, 2]], Ff[:, [2, 0]]]), 1)
    u, cnt = np.unique(e, axis=0, return_counts=True)
    be = u[cnt == 1]
    # boundary as dense points (edges sampled every 2 mm)
    pts, lab = [], []
    comp = _edge_components(be, len(V))
    for (a, b) in be:
        n = max(2, int(np.linalg.norm(V[a] - V[b]) / 0.002) + 1)
        t = np.linspace(0, 1, n)[:, None]
        pts.append(V[a] + (V[b] - V[a]) * t)
        lab.append(np.full(n, comp[a]))
    pts, lab = np.concatenate(pts), np.concatenate(lab)
    fi = np.nonzero(fab)[0]
    d, _ = cKDTree(pts).query(V[fi])
    edge[fi] = d
    # band loops: per garment piece (connected fabric), the highest / lowest boundary loop
    loops = np.unique(lab)
    ymean = {l: pts[lab == l, 1].mean() for l in loops}
    piece = _vertex_components(Ff, len(V))
    for pc in np.unique(piece[fi]):
        vs = fi[piece[fi] == pc]
        mine = [l for l in loops if piece[be[comp[be[:, 0]] == l][0, 0]] == pc]
        if not mine:
            continue
        pick = max(mine, key=ymean.get) if band_edge == 'top' else min(mine, key=ymean.get)
        db, _ = cKDTree(pts[lab == pick]).query(V[vs])
        band[vs] = db / band_width
    return edge, band


def _edge_components(edges, n):
    from scipy.sparse.csgraph import connected_components
    G = sparse.coo_matrix((np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(n, n))
    _, lab = connected_components(G, directed=False)
    return lab


def adjacency(nv, F):
    i = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    j = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = sparse.coo_matrix((np.ones(len(i)), (i, j)), shape=(nv, nv)).tocsr()
    A.data[:] = 1
    return A


def _vertex_components(F, n):
    from scipy.sparse.csgraph import connected_components
    _, lab = connected_components(adjacency(n, F), directed=False)
    return lab


# --------------------------------------------------------------------------- rigged models
def rigged(name, src, MAP, keep, faceless=False, boxers=False, band_edge='top', band_width=0.012):
    """
    keep: {mesh name: (part, [material names to drop])} — meshes not listed are left out
    (transparent cards: lashes, brows, tear lines … read as floating strips in a clay render).
    """
    d = json.load(open(os.path.join(OUT, f'{src}.json')))
    B = {strip(k): {'p': np.array(v['p'], float), 'parent': strip(v['parent']) if v['parent'] else None} for k, v in d['bones'].items()}
    names = [n for n in MAP if MAP[n] in B]
    theirs = {MAP[n]: i for i, n in enumerate(names)}

    def mapped(b):  # nearest mapped bone at or above b
        while b is not None and b not in theirs:
            b = B[b]['parent'] if b in B else None
        return theirs.get(b, 0)

    parents = [mapped(B[MAP[n]]['parent']) if B[MAP[n]]['parent'] else -1 for n in names]
    parents[0] = -1
    Vs, Fs, Js, Ws, Ps = [], [], [], [], []
    off = 0
    for m in d['meshes']:
        if m['name'] not in keep:
            continue
        part, drop = keep[m['name']]
        P = np.array(m['P'], float).reshape(-1, 3) / 100          # cm → m
        tri = np.array(m['I'], int).reshape(-1, 3) if m['I'] else np.arange(len(P)).reshape(-1, 3)
        if drop and m['groups']:
            keepf = np.ones(len(tri), bool)
            for start, count, mi in m['groups']:
                if m['mats'][mi] in drop:
                    keepf[start // 3:(start + count) // 3] = False
            tri = tri[keepf]
        SI = np.array(m['SI'], int).reshape(-1, 4)
        SW = np.array(m['SW'], float).reshape(-1, 4)
        lut = np.array([mapped(strip(b)) for b in m['boneNames']])
        # weld on the kept triangles only
        used = np.unique(tri)
        V, Fm, first, inv = weld(P[used], None)
        Fm = inv[np.searchsorted(used, tri)]
        Fm = Fm[(Fm[:, 0] != Fm[:, 1]) & (Fm[:, 1] != Fm[:, 2]) & (Fm[:, 0] != Fm[:, 2])]
        src_v = used[first]
        Jm, Wm = lut[SI[src_v]], SW[src_v]
        if part == PART['fabric']:  # low-poly garment: one loop subdivision (weights come from the skin later)
            import trimesh
            V, Fm = trimesh.remesh.subdivide_loop(V, Fm, iterations=1)
            Jm, Wm = np.zeros((len(V), 4), int), np.zeros((len(V), 4))
        Vs.append(V); Fs.append(Fm + off); Js.append(Jm); Ws.append(Wm); Ps.append(np.full(len(V), part))
        off += len(V)
    V, F = np.concatenate(Vs), np.concatenate(Fs)
    J, W, part = np.concatenate(Js), np.concatenate(Ws), np.concatenate(Ps).astype(np.float32)
    # clothing moves exactly like the skin under it: copy the nearest skin vertex's weights
    # (its own weights drift from the skin's when the shoulders move, and the skin pokes through)
    cloth = part == PART['fabric']
    if cloth.any():
        skin_i = np.nonzero(part == PART['skin'])[0]
        _, k = cKDTree(V[skin_i]).query(V[cloth])
        J[cloth], W[cloth] = J[skin_i[k]], W[skin_i[k]]
        # and never below it: the source model hides skin under clothes, so some fabric (the
        # straps over the shoulders) was modelled inside the skin — lift it to 2.5 mm above
        Ns = vertex_normals(V, F)
        ci = np.nonzero(cloth)[0]
        near = skin_i[k]
        # skin surface point + normal around each fabric vertex (average of a few neighbours: smoother)
        dist, kk = cKDTree(V[skin_i]).query(V[ci], k=6)
        base = V[skin_i[kk]].mean(1)
        nrm = Ns[skin_i[kk]].mean(1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        h = np.sum((V[ci] - base) * nrm, 1)
        lift = np.maximum(0, 0.0025 - h)
        V[ci] += nrm * lift[:, None]
        print(f'  fabric lifted out of the skin: {(lift > 0.0005).sum()} verts (max {lift.max() * 1000:.1f} mm)')
    body = part == 0
    shift = np.array([-(V[body, 0].max() + V[body, 0].min()) / 2, -V[:, 1].min(), -(V[body, 2].max() + V[body, 2].min()) / 2])
    V = V + shift
    heads = np.array([B[MAP[n]]['p'] for n in names]) / 100 + shift
    if boxers:
        H = lambda n: heads[names.index(n)]
        top = H('pelvis')[1] + 0.055                                        # waistband, just under the navel
        hem = H('calf_l')[1] + 0.5 * (H('thigh_l')[1] - H('calf_l')[1])     # mid-thigh
        V, F, J, W, part = boxer_briefs(V, F, J, W, part, top, hem)
        body = part == 0
    # tails: end bones where the rig has them, else the top of the head / extrapolated
    extra_t = {'head': np.array([heads[names.index('head')][0], V[body, 1].max(), heads[names.index('head')][2]])}
    for sd, S in (('l', 'Left'), ('r', 'Right')):
        for f, Fn in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
            e = f'{S}Hand{Fn}4'
            if e in B:
                extra_t[f'{f}_03_{sd}'] = B[e]['p'] / 100 + shift
        if f'{S}Toe_End' in B:
            extra_t[f'ball_{sd}'] = B[f'{S}Toe_End']['p'] / 100 + shift
    if faceless:
        cut = heads[names.index('neck_01')][1] + 0.03       # under the jaw: the new head covers the neck end
        V, F, J, W, part = mannequin_head(V, F, J, W, part, cut, names.index('head'), names.index('neck_01'))
        body = part == 0
        extra_t['head'] = np.array([heads[names.index('head')][0], V[body, 1].max(), heads[names.index('head')][2]])
    tails = tails_of(names, parents, heads, extra_t)
    eyes = {}
    for sd, sg in (('l', 1), ('r', -1)):
        m = (part == PART['eye']) & (np.sign(V[:, 0]) == sg)
        if m.any():
            eyes[sd] = [round(float(x), 5) for x in V[m].mean(0)]
    edge, band = garment_lines(V, F, part, band_edge, band_width)
    export(name, V, F, names, parents, heads, tails, J, W, extra={'_PART': part, '_EDGE': edge, '_BAND': band},
           part=part, eyes=eyes)


if __name__ == '__main__':
    which = sys.argv[1:] or ['male', 'female']
    if 'male' in which:
        rigged('male', 'MaleModel', MIXAMO, {'Ch36': (PART['skin'], [])}, boxers=True, band_edge='top', band_width=0.035)
    if 'female' in which:
        rigged('female', 'FemaleModel', CC, {
            'CC_Base_Body': (PART['skin'], ['Std_Eyelash']),
            'CC_Game_Eye': (PART['eye'], []),      # fill the sockets for the mannequin head, then dropped
            'CC_Game_Teeth': (PART['teeth'], []),
            'Bra': (PART['fabric'], []),
            'Underwear_Bottoms': (PART['fabric'], []),
        }, faceless=True, band_edge='top', band_width=0.012)  # plain mannequin head, like the male
