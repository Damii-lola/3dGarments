#!/usr/bin/env python3
"""
Match a body to reference photos, slice by slice.

    python3 tools/human/ref/extract.py        # (once) silhouette masks from the photos
    python3 tools/human/match.py male         # prints the fitted preset as JSON

The reference figure is photographed from the front and the side on a flat background
(tools/human/ref/*.png → *_mask.png). The body is posed the same way (arms hanging,
legs apart: two pose angles that are fitted too and then thrown away), rendered as an
orthographic silhouette from the front and the side, and both silhouettes are compared
row by row from the crown to the ankle:

  front  outer width · torso width between the arms · arm thickness · leg width · leg gap
  side   depth · front edge · back edge (chest, belly, butt, calves)

Everything is in units of crown→ankle length, so the photos' scale does not matter.
A bounded least-squares fit then moves the MakeHuman shape targets until the rows line up.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import least_squares

import design as D

HERE = os.path.dirname(os.path.abspath(__file__))
REFDIR = os.path.join(HERE, 'ref')
ROWS = 220  # normalised rows crown → ankle

# reference photos: sole row (lowest point of the standing foot) per view
REF_SOLE = {'front': 2119, 'side': 1890}

# --------------------------------------------------------------------------- skinning for the two pose angles
man, S, N = D.man, D.S, D.N
BONES = [b['name'] for b in man['bones']]
SI = S['skin.index'].reshape(N, 4).astype(int)
SW = S['skin.weight'].reshape(N, 4).astype(np.float64)
SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)


def chain_weight(names):
    ids = [BONES.index(n) for n in names]
    return (SW * np.isin(SI, ids)).sum(1)


UPPER = chain_weight([b for b in BONES if b not in ('Root', 'pelvis') and not b.startswith(('thigh', 'calf', 'foot', 'ball'))])
W_HEAD = chain_weight(['neck_01', 'head'])
FINGERS = [b for b in BONES if b.split('_')[0] in ('thumb', 'index', 'middle', 'ring', 'pinky')]
W_ARM = {s: chain_weight([f'upperarm_{s}', f'lowerarm_{s}', f'hand_{s}'] + [f for f in FINGERS if f.endswith('_' + s)]) for s in 'lr'}
W_LEG = {s: chain_weight([f'thigh_{s}', f'calf_{s}', f'foot_{s}', f'ball_{s}']) for s in 'lr'}
TRI = D.TRI


def rot(p, pivot, axis, ang):
    """Rodrigues rotation of points p about the line (pivot, axis) by ang radians."""
    k = axis / np.linalg.norm(axis)
    q = p - pivot
    c, s_ = np.cos(ang), np.sin(ang)
    return q * c + np.cross(k, q) * s_ + np.outer(q @ k, k) * (1 - c) + pivot


W_FORE = {s: chain_weight([f'lowerarm_{s}', f'hand_{s}'] + [f for f in FINGERS if f.endswith('_' + s)]) for s in 'lr'}
W_CLAV = {s: chain_weight([f'clavicle_{s}']) + W_ARM[s] for s in 'lr'}
X, Z = np.array([1.0, 0, 0]), np.array([0, 0, 1.0])


def pose(P, arm_deg, leg_deg, fwd_deg=0.0, lean_deg=0.0, head_deg=0.0, elbow_deg=10.0, clav_deg=0.0):
    """
    Linear-blend-skinned swings, in the order a rig applies them: elbow (rest pose is flexed 46°,
    left at elbow_deg), collarbone drop, arm down + forward/back, legs in/out, upper body and head pitch.
    """
    J = lambda n: P[D.JOINT[n]].mean(0)
    blend = lambda P, w, moved: P + w[:, None] * (moved - P)
    for s in 'lr':
        sh, el, wr = J(f'joint-{s}-shoulder'), J(f'joint-{s}-elbow'), J(f'joint-{s}-hand')
        u, f = el - sh, wr - el
        axis = np.cross(u, f)
        rest = np.degrees(np.arccos(u @ f / np.linalg.norm(u) / np.linalg.norm(f)))
        P = blend(P, W_FORE[s], rot(P, el, axis, -np.radians(rest - elbow_deg)))
        side = np.sign(sh[0])
        P = blend(P, W_CLAV[s], rot(P, J(f'joint-{s}-clavicle'), Z, -side * np.radians(clav_deg)))
        sh = J(f'joint-{s}-shoulder')
        P = blend(P, W_ARM[s], rot(rot(P, sh, Z, -side * np.radians(arm_deg)), sh, X, np.radians(fwd_deg)))
        P = blend(P, W_LEG[s], rot(P, J(f'joint-{s}-upper-leg'), Z, side * np.radians(leg_deg)))
    P = blend(P, UPPER, rot(P, J('joint-spine-3'), X, np.radians(lean_deg)))
    P = blend(P, W_HEAD, rot(P, J('joint-neck'), X, np.radians(head_deg)))
    return P


# --------------------------------------------------------------------------- silhouettes
def raster(P, axis, px_per_m=900):
    """Orthographic silhouette. axis 0 → front view (x right), 2 → side view (+z right)."""
    u, v = P[:, axis], P[:, 1]
    x0, y1 = u.min() - 0.05, v.max() + 0.05
    W = int((u.max() - x0 + 0.05) * px_per_m) + 1
    H = int((y1 - v.min() + 0.05) * px_per_m) + 1
    img = Image.new('1', (W, H), 0)
    d = ImageDraw.Draw(img)
    X = (u - x0) * px_per_m
    Y = (y1 - v) * px_per_m
    for a, b, c in TRI:
        d.polygon([(X[a], Y[a]), (X[b], Y[b]), (X[c], Y[c])], fill=1)
    return np.asarray(img), int((y1 - v.min()) * px_per_m)


def runs_of(row):
    xs = np.nonzero(row)[0]
    if not len(xs):
        return []
    cut = np.nonzero(np.diff(xs) > 1)[0] + 1
    return [(r[0], r[-1] + 1) for r in np.split(xs, cut)]


def ankle_row(mask, crown, sole, view):
    best, row = 1e9, None
    for y in range(int(crown + 0.86 * (sole - crown)), int(sole - 0.03 * (sole - crown))):
        rs = [r for r in runs_of(mask[y]) if r[1] - r[0] > 3]
        if not rs:
            continue
        w = np.mean([b - a for a, b in rs]) if view == 'front' else rs[-1][1] - rs[0][0]
        if view == 'front' and len(rs) < 2:
            continue
        if w < best:
            best, row = w, y
    return row


def features(mask, sole, view):
    rows = np.nonzero(mask.any(1))[0]
    crown = rows[0]
    ank = ankle_row(mask, crown, sole, view)
    L = ank - crown
    F = {}
    if view == 'side':
        ar = runs_of(mask[ank])
        cx = (ar[0][0] + ar[-1][1]) / 2
    for i, u in enumerate(np.linspace(0.005, 1.0, ROWS)):
        y = int(round(crown + u * L))
        rs = [r for r in runs_of(mask[y]) if r[1] - r[0] > 2]
        if not rs:
            continue
        put = lambda k, val: F.setdefault(k, np.full(ROWS, np.nan)).__setitem__(i, val / L)
        if view == 'side':
            put('depth', rs[-1][1] - rs[0][0])
            put('front', rs[-1][1] - cx)
            put('back', cx - rs[0][0])
            continue
        put('outer', rs[-1][1] - rs[0][0])
        if len(rs) >= 3 and u > 0.2:  # (ears can split the head rows)
            put('torso', rs[-2][1] - rs[1][0])
            put('arm', ((rs[0][1] - rs[0][0]) + (rs[-1][1] - rs[-1][0])) / 2)
            put('armpos', (rs[-1][0] + rs[-1][1] - rs[0][0] - rs[0][1]) / 2)  # arm spread (pose)
        if len(rs) == 4 or (len(rs) == 2 and u > 0.6):
            legs = rs[1:3] if len(rs) == 4 else rs
            put('leg', ((legs[0][1] - legs[0][0]) + (legs[1][1] - legs[1][0])) / 2)
            put('gap', legs[1][0] - legs[0][1])
    # where the arms separate from the torso (armpit) and where they end (fingertips), as rows
    sep = [i for i, u in enumerate(np.linspace(0.005, 1.0, ROWS)) if not np.isnan(F.get('arm', np.full(ROWS, np.nan))[i])]
    if view == 'front' and sep:
        F['armtop'] = np.array([sep[0] / ROWS])
        F['armend'] = np.array([sep[-1] / ROWS])
    return F


def ref_features():
    out = {}
    for view in ('front', 'side'):
        m = np.asarray(Image.open(os.path.join(REFDIR, f'{view}_mask.png'))) > 0
        out[view] = features(m, REF_SOLE[view], view)
    return out


def model_features(P):
    out = {}
    for view, axis in (('front', 0), ('side', 2)):
        m, sole = raster(P, axis)
        out[view] = features(m, sole, view)
    return out


# which rows/features count, and how much
WEIGHT = {('front', 'outer'): 1.0, ('front', 'torso'): 1.5, ('front', 'arm'): 1.0, ('front', 'armpos'): 0.4,
          ('front', 'leg'): 1.5, ('front', 'gap'): 0.6, ('front', 'armtop'): 25.0, ('front', 'armend'): 25.0,
          ('side', 'depth'): 1.5, ('side', 'front'): 1.0, ('side', 'back'): 1.0}


def residual(ref, mod):
    r = []
    for (view, k), w in WEIGHT.items():
        a, b = ref[view].get(k), mod[view].get(k)
        n = ROWS if k not in ('armtop', 'armend') else 1
        a = a if a is not None else np.full(n, np.nan)
        b = b if b is not None else np.full(n, np.nan)
        ok = ~np.isnan(a) & ~np.isnan(b)
        r.append(np.where(ok, b - a, 0.0) * w * 100)
    return np.concatenate(r)


# --------------------------------------------------------------------------- soft silhouettes (the main objective)
# Canvas in units of crown→ankle length L: u (down) from −0.04 to 1.0, v (across) ±0.42 around the centre.
U0, U1, V0 = -0.04, 1.0, 0.42


def frame_of(mask, sole, view):
    rows = np.nonzero(mask.any(1))[0]
    crown = rows[0]
    ank = ankle_row(mask, crown, sole, view)
    rs = runs_of(mask[ank])
    if view == 'front':  # centre between the ankles
        cx = (rs[0][0] + rs[-1][1]) / 2
    else:
        cx = (rs[0][0] + rs[-1][1]) / 2
    return crown, ank - crown, cx


def soft(mask, sole, view, res):
    """Coverage of each canvas cell (area-averaged, so it moves smoothly with the shape)."""
    crown, L, cx = frame_of(mask, sole, view)
    h, w = res
    top, left = crown + U0 * L, cx - V0 * L
    img = Image.fromarray((mask * 255).astype(np.uint8))
    box = (left, top, left + 2 * V0 * L, top + (U1 - U0) * L)
    return np.asarray(img.transform((w * 4, h * 4), Image.EXTENT, box, Image.BILINEAR).resize((w, h), Image.BOX)) / 255.0


RES = [(52, 42), (104, 84)]
_ref_soft = {}


def ref_soft():
    if not _ref_soft:
        for view in ('front', 'side'):
            m = np.asarray(Image.open(os.path.join(REFDIR, f'{view}_mask.png'))) > 0
            _ref_soft[view] = [soft(m, REF_SOLE[view], view, r) for r in RES]
    return _ref_soft


def soft_residual(P):
    ref = ref_soft()
    out = []
    for view, axis in (('front', 0), ('side', 2)):
        m, sole = raster(P, axis)
        for r, R in zip(RES, ref[view]):
            d = soft(m, sole, view, r) - R
            out.append(d.ravel() * (100 / np.sqrt(d.size)) * (1.0 if view == 'front' else 0.8))
    return np.concatenate(out)


# --------------------------------------------------------------------------- the fit
BASE_MALE = {'gender': 1, 'ageYears': 27, 'proportions': 1, 'breastSize': 0.5, 'breastFirmness': 0.5, 'height': 0.584}
BI = lambda k: [f'l-{k}', f'r-{k}']
VARS = [
    # (key, lo, hi, start). Muscle DEFINITION targets are locked high (the reference is a fully
    # defined physique: pecs, lats, abs, delts, arms, quads, calves); only scale / girth / length
    # targets move to match the outline, so the silhouette never "spends" the definition.
    ('muscle', 1.0, 1.0001, 1.0), ('weight', 0.05, 0.5, 0.25), ('proportions', 0.3, 1.0, 0.8),
    ('L:torso-muscle-pectoral', 1.0, 1.0001, 1.0), ('L:torso-muscle-dorsi', 0.6, 0.6001, 0.6),
    ('L:stomach-tone', 1.0, 1.0001, 1.0), ('B:upperarm-muscle', 1.0, 1.0001, 1.0),
    ('B:upperarm-shoulder-muscle', 1.0, 1.0001, 1.0), ('B:lowerarm-muscle', 1.0, 1.0001, 1.0),
    ('B:upperleg-muscle', 1.0, 1.0001, 1.0), ('B:lowerleg-muscle', 1.0, 1.0001, 1.0),
    ('L:torso-scale-horiz', -0.6, 0.6, 0.3), ('L:torso-scale-depth', -0.6, 0.6, 0.3), ('L:torso-vshape', -1, 1, 0.35),
    ('L:hip-scale-horiz', -0.6, 0.6, 0.4), ('L:hip-scale-depth', -0.6, 0.6, 0.1), ('L:buttocks-volume', -1, 1, 0.8),
    ('L:measure-shoulder-dist', -1, 1, 0), ('L:measure-bust-circ', -1, 1, 0), ('L:measure-waist-circ', -1, 1, 0.3),
    ('L:measure-hips-circ', -1, 1, -0.3),
    ('L:measure-neck-circ', -1, 1, 0.5), ('L:measure-neck-height', -1, 1, 0.9),
    ('L:measure-upperarm-length', -1, 1, 0.33), ('L:measure-lowerarm-length', -1, 1, -0.34),
    ('L:measure-upperleg-height', -1, 1, 0.18), ('L:measure-lowerleg-height', -1, 1, 0.18),
    ('L:measure-upperarm-circ', -1, 1, 0), ('L:measure-thigh-circ', -1, 1, 0.7), ('L:measure-knee-circ', -1, 1, 0.8),
    ('L:measure-calf-circ', -1, 1, -0.3), ('L:measure-ankle-circ', -1, 1, 0.48), ('L:measure-wrist-circ', -1, 1, 0.44),
    ('B:upperarm-scale-horiz', -1, 1, 0), ('B:lowerarm-scale-horiz', -1, 1, 0),
    ('B:upperleg-scale-horiz', -1, 1, 0), ('B:lowerleg-scale-horiz', -1, 1, 0),
    ('L:head-scale-horiz', -1, 1, 0.97), ('L:head-scale-vert', -1, 1, 0.67), ('L:head-scale-depth', -1, 1, -0.42),
    ('P:arm', 20, 45, 30), ('P:leg', -12, 5, -7.7), ('P:fwd', -10, 15, 8.6), ('P:elbow', 0, 30, 22), ('P:clav', 0, 12, 4.3),
]


def unpack(x):
    s = dict(BASE_MALE)
    loc, pz = {}, {}
    for (k, *_), v in zip(VARS, x):
        v = float(v)
        if k.startswith('L:'):
            loc[k[2:]] = v
        elif k.startswith('B:'):
            for kk in BI(k[2:]):
                loc[kk] = v
        elif k.startswith('P:'):
            pz[k[2:]] = v
        else:
            s[k] = v
    s['local'] = loc
    return s, pz


def evaluate(x):
    s, pz = unpack(x)
    return model_features(pose(D.morph(s), pz['arm'], pz['leg'], pz['fwd'], 0.0, 0.0, pz['elbow'], pz['clav']))


def overlay(x, path):
    """Model silhouette (red) over the reference (white), front + side, for eyeballing."""
    s, pz = unpack(x)
    P = pose(D.morph(s), pz['arm'], pz['leg'], pz['fwd'], 0.0, 0.0, pz['elbow'], pz['clav'])
    tiles = []
    for view, axis in (('front', 0), ('side', 2)):
        ref = np.asarray(Image.open(os.path.join(REFDIR, f'{view}_mask.png'))) > 0
        rows = np.nonzero(ref.any(1))[0]
        crown, ank = rows[0], ankle_row(ref, rows[0], REF_SOLE[view], view)
        m, sole = raster(P, axis)
        mr = np.nonzero(m.any(1))[0]
        mc, ma = mr[0], ankle_row(m, mr[0], sole, view)
        k = (ank - crown) / (ma - mc)
        img = Image.fromarray((m * 255).astype(np.uint8)).resize((int(m.shape[1] * k), int(m.shape[0] * k)))
        mm = np.asarray(img) > 127
        # align crown rows and horizontal centres (front: ankle midpoint, side: ankle centre)
        def centre(msk, row):
            rs = runs_of(msk[row])
            return (rs[0][0] + rs[-1][1]) / 2
        oy = crown - int(mc * k)
        ox = int(centre(ref, ank) - centre(mm, int(ma * k)))
        canvas = np.zeros(ref.shape + (3,), np.uint8)
        canvas[ref] = (90, 90, 90)
        ys, xs = np.nonzero(mm)
        ys, xs = ys + oy, xs + ox
        ok = (ys >= 0) & (ys < ref.shape[0]) & (xs >= 0) & (xs < ref.shape[1])
        edge = mm ^ np.pad(mm, 1)[2:, 1:-1] | mm ^ np.pad(mm, 1)[1:-1, 2:]
        ey, ex = np.nonzero(edge)
        ey, ex = ey + oy, ex + ox
        ok = (ey >= 0) & (ey < ref.shape[0]) & (ex >= 0) & (ex < ref.shape[1])
        canvas[ey[ok], ex[ok]] = (255, 40, 40)
        tiles.append(Image.fromarray(canvas).resize((540, 1110)))
    out = Image.new('RGB', (1080, 1110))
    out.paste(tiles[0], (0, 0))
    out.paste(tiles[1], (540, 0))
    out.save(path)


def fit(max_nfev=40):
    ref = ref_features()
    x0 = np.array([v[3] for v in VARS], float)
    anchor = x0.copy()  # regularisation always pulls towards the athletic start, not the resume point
    if os.environ.get('RESUME'):
        x0 = np.load(os.path.join(REFDIR, 'fit_x.npy'))
    lo = np.array([v[1] for v in VARS], float)
    hi = np.array([v[2] for v in VARS], float)
    reg = np.array([0.0 if k.startswith('P:') else 1.5 for k, *_ in VARS])

    def resid(x):
        pen = reg * np.where([k.startswith('P:') for k, *_ in VARS], 0, x - anchor)  # stay near the athletic start
        sp, pz = unpack(x)
        P = pose(D.morph(sp), pz['arm'], pz['leg'], pz['fwd'], 0.0, 0.0, pz['elbow'], pz['clav'])
        # the upper arm overlaps the torso in the front photo, so its girth is pinned by the width
        # measured where it hangs free (≈8 cm across → ≈26.5 cm around)
        arm = D.measure(sp)['upperarm']
        return np.concatenate([soft_residual(P), pen * 0.3, [(arm - 26.5) * 1.5]])

    H = 0.04 * (hi - lo) / 2  # absolute steps: big enough to move the silhouette by whole pixels

    def jac(x):
        f0 = resid(x)
        Jm = np.empty((len(f0), len(x)))
        for i in range(len(x)):
            h = H[i] if x[i] + H[i] <= hi[i] else -H[i]
            x1 = x.copy()
            x1[i] += h
            Jm[:, i] = (resid(x1) - f0) / h
        return Jm

    r0 = resid(x0)
    print(f'start cost {np.sum(r0 ** 2):.1f}', file=sys.stderr)
    res = least_squares(resid, x0, jac=jac, bounds=(lo, hi), max_nfev=max_nfev, verbose=1, x_scale=hi - lo)
    print(f'end cost {np.sum(res.fun ** 2):.1f}', file=sys.stderr)
    return res.x


if __name__ == '__main__':
    x0 = np.array([v[3] for v in VARS], float)
    if len(sys.argv) > 1 and sys.argv[1] == 'overlay':
        overlay(x0, sys.argv[2])
        sys.exit()
    x = fit(int(os.environ.get('NFEV', 40)))
    np.save(os.path.join(REFDIR, 'fit_x.npy'), x)
    overlay(x, os.path.join(REFDIR, 'fit_overlay.png'))
    s, pz = unpack(x)
    print(json.dumps({'shape': s, 'pose': pz}, indent=1))
