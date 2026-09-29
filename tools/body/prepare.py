#!/usr/bin/env python3
"""
Turn the studio's body models (assets/*.fbx) into web-ready rigged GLBs.

    (lab dev server running)  node tools/body/extract.mjs     # FBX → tools/body/out/<name>.json (mesh + skeleton)
    python3 tools/body/prepare.py                             # → web/public/body/{male,female}.glb

- welds the mesh (one vertex per position → smooth shading, no texture seams), metres, feet on
  y = 0, centred, facing +z
- skeleton with the pose library's bone names (pelvis, spine_01…, upperarm_l, thumb_01_l …).
  The male keeps his Mixamo skin weights; the female ships unrigged, so she gets a skeleton
  placed from her own geometry and weights computed here (bone-segment distance, part-limited,
  diffused over the surface)
- bone rest frames follow the runtime's convention (y head → tail, x = y × +z; hands use the palm)
"""
import json
import os
import sys

import numpy as np
from scipy import sparse
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


def shoulder_points(V, names, heads):
    """the bony shoulder tips (acromion): outermost vertex on top of each shoulder"""
    out = {}
    for s, sg in (('l', 1), ('r', -1)):
        h = heads[names.index(f'upperarm_{s}')]
        m = (V[:, 1] > h[1] + 0.015) & (V[:, 1] < h[1] + 0.07) & (sg * V[:, 0] > 0) & (sg * V[:, 0] < sg * h[0] + 0.035) & (np.abs(V[:, 2] - h[2]) < 0.06)
        idx = np.nonzero(m)[0]
        out[s] = int(idx[np.argmax(sg * V[idx, 0])])
    return out


def export(name, V, F, names, parents, heads, tails, J, Wt, extra=None):
    os.makedirs(PUB, exist_ok=True)
    pal = palm_normals(names, heads)
    rot = frames(names, parents, heads, tails, pal)
    N = vertex_normals(V, F)
    order = np.argsort(-Wt, 1)[:, :4]
    J4 = np.take_along_axis(J, order, 1)
    W4 = np.take_along_axis(Wt, order, 1)
    W4 /= W4.sum(1, keepdims=True)
    D, bone_dx = width_morph(V, names, heads, J4, W4)
    probes = shoulder_points(V, names, heads)
    extras = {'widthBoneDx': [round(float(v), 5) for v in bone_dx], 'shoulderProbes': probes,
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


# --------------------------------------------------------------------------- male (Mixamo rig)
def rigged(name, src, height=None):
    """A model that ships with a Mixamo-style rig: keep its skeleton and skin weights."""
    d = json.load(open(os.path.join(OUT, f'{src}.json')))
    P = np.array(d['P'], float).reshape(-1, 3)
    unit = 1 / 100 if height is None else height / (P[:, 1].max() - P[:, 1].min())  # cm → m, or to a height
    P = P * unit
    SI = np.array(d['SI']).reshape(-1, 4)
    SW = np.array(d['SW'], float).reshape(-1, 4)
    V, F, first, inv = weld(P, None)
    V, s, off = normalise(V)
    s *= unit
    SI, SW = SI[first], SW[first]
    mb = d['bones']
    mnames = [b['name'].replace('mixamorig1', '').replace('mixamorig', '') for b in mb]
    names = [n for n in MIXAMO if MIXAMO[n] in mnames]
    src_i = [mnames.index(MIXAMO[n]) for n in names]
    heads = np.array([mb[i]['p'] for i in src_i], float) * s + off
    # parent: nearest mapped ancestor
    parents = []
    for i in src_i:
        p = mb[i]['parent']
        while p >= 0 and mnames[p] not in [MIXAMO[n] for n in names]:
            p = mb[p]['parent']
        parents.append(names.index([n for n in names if MIXAMO[n] == mnames[p]][0]) if p >= 0 else -1)
    # skin: Mixamo bone → our bone (unmapped end bones fold into their parent)
    remap = {}
    for i, mn in enumerate(mnames):
        j = i
        while j >= 0 and mnames[j] not in [MIXAMO[n] for n in names]:
            j = mb[j]['parent']
        remap[i] = names.index([n for n in names if MIXAMO[n] == mnames[j]][0])
    J = np.vectorize(remap.get)(SI)
    ends = {e['name'].replace('mixamorig1', '').replace('mixamorig', ''): np.array(e['p']) * s + off for e in d.get('ends', [])}
    extra_t = {'head': ends.get('HeadTop_End', heads[names.index('head')] + [0, 0.2, 0])}
    for sd, S in (('l', 'Left'), ('r', 'Right')):
        extra_t[f'ball_{sd}'] = ends.get(f'{S}Toe_End', None)
        for f, Fn in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
            extra_t[f'{f}_03_{sd}'] = np.array([mb[k]['p'] for k in range(len(mb)) if mnames[k] == f'{S}Hand{Fn}4'][0]) * s + off
    extra_t = {k: v for k, v in extra_t.items() if v is not None}
    tails = tails_of(names, parents, heads, extra_t)
    export(name, V, F, names, parents, heads, tails, J, SW)


# --------------------------------------------------------------------------- female (auto-rig)
def adjacency(nv, F):
    i = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    j = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = sparse.coo_matrix((np.ones(len(i)), (i, j)), shape=(nv, nv)).tocsr()
    A.data[:] = 1
    return A


def segment(V, H, gap=0.012, band=0.006):
    """label each vertex: 0 torso/head, 1 arm_l, 2 arm_r, 3 leg_l, 4 leg_r (slice clustering by x gaps)"""
    lab = np.zeros(len(V), int)
    ys = np.arange(V[:, 1].min(), V[:, 1].max() + band, band)
    for y in ys:
        idx = np.nonzero(np.abs(V[:, 1] - y) <= band / 2)[0]
        if len(idx) < 3:
            continue
        o = idx[np.argsort(V[idx, 0])]
        xs = V[o, 0]
        cut = np.nonzero(np.diff(xs) > gap)[0] + 1
        groups = np.split(o, cut)
        cen = [V[g, 0].mean() for g in groups]
        n = len(groups)
        for gi, g in enumerate(groups):
            c = cen[gi]
            if y < 0.47 * H:                                 # below the hips: legs, and hands beside them
                if n >= 3 and gi in (0, n - 1) and abs(c) > 0.14:
                    lab[g] = 1 if c > 0 else 2
                else:
                    lab[g] = 3 if c > 0 else 4
            elif n >= 3 and gi in (0, n - 1):
                lab[g] = 1 if c > 0 else 2
    return lab


def geodesic(V, F, seeds):
    from scipy.sparse.csgraph import dijkstra
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1) + 1e-9
    G = sparse.coo_matrix((w, (e[:, 0], e[:, 1])), shape=(len(V), len(V))).tocsr()
    G = G.maximum(G.T)
    return dijkstra(G, indices=seeds, min_only=True)


def track_parts(V, H, band=0.016, step=0.004, gap=0.012):
    """
    Label vertices 0 torso/head, 1 arm_l, 2 arm_r, 3 leg_l, 4 leg_r by following each limb upward:
    slices are split into clusters at gaps in x; a limb starts at its lowest slice (hand / foot) and
    carries on upward while a cluster overlaps the limb's cluster in the slice below and stays apart
    from the rest of the slice.
    """
    lab = np.zeros(len(V), int)
    ys = np.arange(V[:, 1].min(), V[:, 1].max() + step, step)
    slices = []
    for y in ys:
        idx = np.nonzero(np.abs(V[:, 1] - y) <= band / 2)[0]
        if len(idx) == 0:
            slices.append([])
            continue
        o = idx[np.argsort(V[idx, 0])]
        cut = np.nonzero(np.diff(V[o, 0]) > gap)[0] + 1
        slices.append(np.split(o, cut))
    ext = lambda g: (V[g, 0].min(), V[g, 0].max())
    for k, sg, start in ((3, 1, 0.0), (4, -1, 0.0), (1, 1, None), (2, -1, None)):
        prev = None
        for si, groups in enumerate(slices):
            y = ys[si]
            if not groups:
                continue
            if prev is None:
                if k in (3, 4):   # legs start at the floor: the cluster on this side
                    cand = [g for g in groups if np.sign(V[g, 0].mean()) == sg]
                else:             # arms start at the fingertips: an outer cluster clear of the body, below the hips
                    if y > 0.6 * H or len(groups) < 3:
                        continue
                    g0 = groups[-1] if sg > 0 else groups[0]
                    if abs(V[g0, 0].mean()) < 0.12:
                        continue
                    cand = [g0]
                if not cand:
                    continue
                prev = ext(cand[0])
                lab[cand[0]] = k
                continue
            hits = [g for g in groups if ext(g)[1] >= prev[0] - 0.01 and ext(g)[0] <= prev[1] + 0.01]
            if not hits:
                break
            hit = np.concatenate(hits)
            e = ext(hit)
            # stop when the limb merges into a much wider cluster (torso / pelvis)
            if (e[1] - e[0]) > 1.8 * (prev[1] - prev[0]) + 0.02:
                break
            lab[hit[lab[hit] == 0]] = k
            prev = e
    return lab


def female():
    d = json.load(open(os.path.join(OUT, 'FemaleModel.json')))
    P = np.array(d['P'], float).reshape(-1, 3)
    V, F, first, inv = weld(P, None, tol=1e-3)
    H = 1.70
    V, s, off = normalise(V, H)
    A = adjacency(len(V), F)
    lab = track_parts(V, H)
    slab = lab
    crotch = V[(np.abs(V[:, 0]) < 0.008) & (V[:, 1] > 0.3 * H) & (V[:, 1] < 0.6 * H), 1].min()
    arm_top = {k: V[lab == k, 1].max() for k in (1, 2)}
    print(f'female: crotch {crotch:.3f}, arm tops {arm_top[1]:.3f} {arm_top[2]:.3f}, parts', np.bincount(lab))

    def centre(mask, y, band=0.012):
        m = mask & (np.abs(V[:, 1] - y) < band)
        if not m.any():
            m = mask & (np.abs(V[:, 1] - y) < band * 3)
        q = V[m]
        return np.array([(q[:, 0].max() + q[:, 0].min()) / 2, y, (q[:, 2].max() + q[:, 2].min()) / 2])

    torso = lab == 0
    J = {}
    J['pelvis'] = centre(torso, crotch + 0.06 * H)
    J['spine_01'] = centre(torso, 0.60 * H)
    J['spine_02'] = centre(torso, 0.67 * H)
    J['spine_03'] = centre(torso, 0.74 * H)
    shoulder_y = min(arm_top.values()) - 0.012
    J['neck_01'] = centre(torso, 0.835 * H)
    J['head'] = centre(torso, 0.875 * H)
    head_top = np.array([J['head'][0], V[:, 1].max(), J['head'][2]])
    for sd, k, sg in (('l', 1, 1), ('r', 2, -1)):
        arm = lab == k
        top = V[(slab == k), 1].max()          # armpit: where the arm leaves the torso (slices)
        tip = V[arm][np.argmin(V[arm, 1])]
        J[f'_handtip_{sd}'] = tip
        up = centre(arm, top - 0.03)
        ys = top + 0.075                       # shoulder joint sits ~7 cm above the armpit
        J[f'upperarm_{sd}'] = np.array([up[0] - sg * 0.006, ys, up[2]])
        J[f'clavicle_{sd}'] = np.array([sg * 0.02, ys + 0.005, J['spine_03'][2] + 0.01])
        Lt = ys - tip[1]                       # shoulder → fingertip, split upper 42% / fore 33% / hand 25%
        J[f'lowerarm_{sd}'] = centre(arm, ys - 0.42 * Lt)
        J[f'hand_{sd}'] = centre(arm, ys - 0.755 * Lt)
        leg = lab == (3 if sd == 'l' else 4)
        hip = centre(leg, crotch - 0.03)
        J[f'thigh_{sd}'] = np.array([hip[0] - sg * 0.005, crotch + 0.05 * H, hip[2]])
        J[f'calf_{sd}'] = centre(leg, 0.285 * H)
        J[f'foot_{sd}'] = centre(leg, 0.047 * H)
        foot = V[leg & (V[:, 1] < 0.05 * H)]
        toe_z = foot[:, 2].max()
        J[f'ball_{sd}'] = np.array([J[f'foot_{sd}'][0], 0.018 * H, J[f'foot_{sd}'][2] + 0.72 * (toe_z - J[f'foot_{sd}'][2])])
        J[f'_toe_{sd}'] = np.array([J[f'ball_{sd}'][0], 0.012 * H, toe_z])

    names = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head']
    parents = [-1, 0, 1, 2, 3, 4]
    for sd in 'lr':
        base = len(names)
        names += [f'clavicle_{sd}', f'upperarm_{sd}', f'lowerarm_{sd}', f'hand_{sd}']
        parents += [3, base, base + 1, base + 2]
        base = len(names)
        names += [f'thigh_{sd}', f'calf_{sd}', f'foot_{sd}', f'ball_{sd}']
        parents += [0, base, base + 1, base + 2]
    heads = np.array([J[n] for n in names])
    extra_t = {'head': head_top}
    for sd in 'lr':
        extra_t[f'hand_{sd}'] = J[f'_handtip_{sd}']
        extra_t[f'ball_{sd}'] = J[f'_toe_{sd}']
    tails = tails_of(names, parents, heads, extra_t)
    for sd in 'lr':  # hands: no finger bones → point the hand at the fingertips
        tails[names.index(f'hand_{sd}')] = J[f'_handtip_{sd}']

    # ---- weights: nearest bone segment within the vertex's part, then diffused over the surface
    B = len(names)
    allowed = {0: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r',
                   'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r'],
               1: ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l'], 2: ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'],
               3: ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l'], 4: ['pelvis', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']}
    D = np.full((len(V), B), np.inf)
    for b, n in enumerate(names):
        a, t = heads[b], tails[b]
        ab = t - a
        tt = np.clip(((V - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        dist = np.linalg.norm(V - (a + tt[:, None] * ab), axis=1)
        for k, ok in allowed.items():
            if n in ok:
                m = lab == k
                if k == 0 and n.startswith('upperarm'):
                    m = m & (V[:, 1] > heads[b][1] - 0.05)   # only the shoulder cap, never the ribs/waist
                if k == 0 and n.startswith('thigh'):
                    m = m & (V[:, 1] < heads[b][1] + 0.02) & (np.sign(V[:, 0]) == np.sign(heads[b][0]))
                D[m, b] = dist[m]
    # the clavicle and pelvis are short: keep them from grabbing the chest / belly
    for n, k in (('clavicle_l', 1.6), ('clavicle_r', 1.6), ('pelvis', 1.2)):
        D[:, names.index(n)] *= k
    Wt = np.zeros((len(V), B))
    Wt[np.arange(len(V)), np.argmin(D, 1)] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    L = sparse.diags(1 / np.maximum(deg, 1)) @ A
    for _ in range(32):
        Wt = 0.5 * Wt + 0.5 * (L @ Wt)
    # heads and hands stay rigid where they are far from a joint: re-sharpen tiny weights
    Wt[Wt < 0.02] = 0
    Wt /= Wt.sum(1, keepdims=True)
    J4 = np.tile(np.arange(B), (len(V), 1))
    export('female', V, F, names, parents, heads, tails, J4, Wt)
    np.save(os.path.join(OUT, 'female_lab.npy'), lab)


if __name__ == '__main__':
    which = sys.argv[1:] or ['male', 'female']
    if 'male' in which:
        rigged('male', 'MaleModel')
    if 'female' in which:
        d = json.load(open(os.path.join(OUT, 'FemaleModel.json')))
        if d.get('bones'):
            rigged('female', 'FemaleModel', height=1.70)  # a rigged female: keep her own rig
        else:
            female()                                     # unrigged: auto-rig
