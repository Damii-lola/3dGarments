#!/usr/bin/env python3
"""
Design the studio's two bodies against REAL measurements of people in each category.

    python3 tools/human/design.py            # prints the fitted presets as JSON

The body is measured like a tailor measures a person: tape-measure circumferences
(convex hull of a horizontal slice) at chest, waist, hips, thigh, calf and upper
arm, plus neck. A bounded least-squares fit then finds the muscle/shape values that
hit the reference numbers, preferring muscle targets over plain "inflate" targets.

It reads the BUILT assets (web/public/human), so it measures exactly what the
browser renders, with the same maths as web/src/human/modifiers.js.
"""
import json
import os
import sys

import brotli
import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', '..', 'web', 'public', 'human')

# --------------------------------------------------------------------------- references (cm)
# Fit muscular male — men's physique / fitness-model build (185 cm)
#   chest 110–115, waist 78–81 (waist:chest ≈ 0.72), arm 38–40, thigh ≈ 60, calf ≈ 40
# Thick fit female — wellness / fitness-model build (170 cm)
#   bust 91–94, waist ≈ 66, hips 104–108, thigh ≈ 62, calf ≈ 38
REF = {
    'male': {'height': 185, 'chest': 112, 'waist': 80, 'hips': 98, 'thigh': 60, 'calf': 40, 'upperarm': 38.5, 'neck': 41},
    'female': {'height': 170, 'chest': 93, 'waist': 66, 'hips': 106, 'thigh': 62, 'calf': 38, 'upperarm': 29, 'neck': 32},
}

# --------------------------------------------------------------------------- assets
man = json.load(open(os.path.join(PUB, 'human.json')))
raw = brotli.decompress(open(os.path.join(PUB, 'human.bin'), 'rb').read())
S = {k: np.frombuffer(raw, dtype=dt, count=n, offset=o) for k, (o, n, dt) in man['sections'].items()}
N = man['vertexCount']
BASE = S['base'].reshape(N, 3).astype(np.float64)
STEP = man['targetStep']


def decode_targets():
    total = sum(n for _, n in man['targets'])
    g, v = S['targets.gaps'], S['targets.vals']
    gaps = g[:total].astype(np.int64) | (g[total:2 * total].astype(np.int64) << 8)
    vals = np.zeros((total, 3))
    for c in range(3):
        lo = v[2 * c * total: 2 * c * total + total].astype(np.int64)
        hi = v[2 * c * total + total: 2 * c * total + 2 * total].astype(np.int64)
        x = lo | (hi << 8)
        vals[:, c] = np.where(x >= 32768, x - 65536, x)
    out, at = {}, 0
    for name, n in man['targets']:
        idx = np.cumsum(gaps[at:at + n] + 1) - 1
        out[name] = (idx, vals[at:at + n] * STEP)
        at += n
    return out


T = decode_targets()


# --------------------------------------------------------------------------- MakeHuman macros (port of modifiers.js)
def tri(v, lo, mid, hi, rem=True):
    mx, mn = max(0, v * 2 - 1), max(0, 1 - v * 2)
    d = {lo: mn, hi: mx}
    if mid:
        d[mid] = 1 - (mn + mx) if rem else 1 - max(mn, mx)
    return d


def macro_values(s):
    age = 0.5 + (max(25, min(90, s.get('ageYears', 27))) - 25) / 130
    old = max(0, age * 2 - 1)
    af, as_, ca = s.get('african', 1 / 3), s.get('asian', 1 / 3), s.get('caucasian', 1 / 3)
    t = af + as_ + ca
    v = {'universal': 1, 'female': 1 - s['gender'], 'male': s['gender'], 'young': 1 - old, 'old': old, 'baby': 0, 'child': 0,
         'african': af / t, 'asian': as_ / t, 'caucasian': ca / t}
    v.update(tri(s.get('muscle', .5), 'minmuscle', 'averagemuscle', 'maxmuscle'))
    v.update(tri(s.get('weight', .5), 'minweight', 'averageweight', 'maxweight'))
    v.update(tri(s.get('height', .5), 'minheight', None, 'maxheight'))
    v.update(tri(s.get('proportions', .5), 'uncommonproportions', None, 'idealproportions'))
    v.update(tri(s.get('breastSize', .5), 'mincup', 'averagecup', 'maxcup', False))
    v.update(tri(s.get('breastFirmness', .5), 'minfirmness', 'averagefirmness', 'maxfirmness', False))
    return v


def morph(s):
    v = macro_values(s)
    loc = s.get('local', {})
    P = BASE.copy()
    for name, (idx, d) in T.items():
        base = name.split('/', 1)[1] if name.startswith(('height/', 'proportions/', 'breast/', 'local/')) else name
        if name.startswith('local/') or base.startswith(('breast-', 'nipple-')):
            key, dirn = base.rsplit('-', 1)
            x = loc.get(key, 0)
            w = abs(x) if (x > 0) == (dirn in ('incr', 'up')) and x != 0 else 0
        else:
            w = 1
            for tok in base.split('-'):
                w *= v.get(tok, 0)
                if not w:
                    break
        if w > 1e-4:
            P[idx] += d * w
    P = P * 0.1
    P[:, 1] -= P[:13380, 1].min()
    return P


# --------------------------------------------------------------------------- topology for measuring
src = S['render.src'].astype(np.int64)
TRI = src[S['index.body'].astype(np.int64)].reshape(-1, 3)
DOM = S['skin.index'].reshape(N, 4)[:, 0]
BONE = {b['name']: i for i, b in enumerate(man['bones'])}
JOINT = {j['name']: np.array(j['verts']) for j in man['joints']}
bones_of = lambda *names: np.isin(DOM, [BONE[n] for n in names])
TORSO = bones_of('pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01')
HIPS = bones_of('pelvis', 'spine_01', 'thigh_l', 'thigh_r')
THIGH_L = bones_of('thigh_l')
CALF_L = bones_of('calf_l')
ARM_L = bones_of('upperarm_l')
NECK = bones_of('neck_01')


def hull_perimeter(pts):
    pts = np.unique(np.round(pts, 5), axis=0)
    if len(pts) < 3:
        return 0.0
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    h = np.array(lower[:-1] + upper[:-1])
    return float(np.linalg.norm(np.roll(h, -1, 0) - h, axis=1).sum())


def slice_tape(P, mask, origin, normal):
    """Tape measure: hull perimeter of the plane ∩ (triangles whose 3 verts are in mask)."""
    tri = TRI[mask[TRI].all(1)]
    d = (P - origin) @ normal
    dt = d[tri]
    cut = (dt.min(1) < 0) & (dt.max(1) > 0)
    pts = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        ia, ib = tri[cut, a], tri[cut, b]
        da, db = d[ia], d[ib]
        m = (da * db) < 0
        t = (da[m] / (da[m] - db[m]))[:, None]
        pts.append(P[ia[m]] + (P[ib[m]] - P[ia[m]]) * t)
    if not pts or not sum(len(p) for p in pts):
        return 0.0
    q = np.concatenate(pts)
    # 2D coordinates in the plane
    u = np.cross(normal, [0, 0, 1.0]) if abs(normal[2]) < 0.9 else np.cross(normal, [1.0, 0, 0])
    u /= np.linalg.norm(u)
    w = np.cross(normal, u)
    return hull_perimeter(np.stack([(q - origin) @ u, (q - origin) @ w], 1)) * 100


UP = np.array([0, 1.0, 0])


def measure(s):
    P = morph(s)
    J = lambda n: P[JOINT[n]].mean(0)
    H = P[:13380, 1].max() * 100
    chest_y = J('joint-spine-2')[1] + 0.35 * (J('joint-neck')[1] - J('joint-spine-2')[1])
    ys = lambda a, b, n=9: np.linspace(a, b, n)
    at = lambda y: np.array([0, y, 0])
    chest = max(slice_tape(P, TORSO, at(y), UP) for y in ys(chest_y - 0.04, chest_y + 0.04, 5))
    waist = min(slice_tape(P, TORSO, at(y), UP) for y in ys(J('joint-spine-4')[1], J('joint-spine-2')[1], 9))
    hips = max(slice_tape(P, HIPS, at(y), UP) for y in ys(J('joint-l-upper-leg')[1] - 0.1, J('joint-pelvis')[1], 9))
    crotch = P[:13380][np.abs(P[:13380, 0]) < 0.01][:, 1]
    crotch = crotch[(crotch > 0.6) & (crotch < 1.0)].min() if len(crotch) else J('joint-l-upper-leg')[1] - 0.1
    thigh = max(slice_tape(P, THIGH_L, at(y), UP) for y in ys(crotch - 0.06, crotch - 0.01, 4))
    knee = J('joint-l-knee')[1]
    calf = max(slice_tape(P, CALF_L, at(y), UP) for y in ys(knee - 0.16, knee - 0.06, 6))
    sh, el = J('joint-l-shoulder'), J('joint-l-elbow')
    ax = (el - sh) / np.linalg.norm(el - sh)
    upperarm = max(slice_tape(P, ARM_L, sh + (el - sh) * t, ax) for t in (0.45, 0.55, 0.65))
    ny = J('joint-neck')[1] + 0.3 * (J('joint-head')[1] - J('joint-neck')[1])
    neck = slice_tape(P, NECK, at(ny), UP)
    return {'height': H, 'chest': chest, 'waist': waist, 'hips': hips, 'thigh': thigh, 'calf': calf, 'upperarm': upperarm, 'neck': neck}


# --------------------------------------------------------------------------- fitting
BASES = {
    'male': {'gender': 1, 'ageYears': 27, 'proportions': 1, 'breastSize': 0.5, 'breastFirmness': 0.5},
    'female': {'gender': 0, 'ageYears': 26, 'proportions': 1, 'breastFirmness': 0.5},  # + breast-point -1 in body.js: round, not conical
}
# (key, lo, hi, cost): muscle-shaping targets are cheap, raw circumference "inflate" targets cost more
VARS = {
    'male': [
        # lean: size must come from muscle, not body fat
        ('muscle', 0.85, 1.0, 0.0), ('weight', 0.3, 0.46, 0.3), ('height', 0, 1, 0.0),
        ('L:torso-vshape', 0.3, 1, 0.05), ('L:torso-muscle-pectoral', 0.2, 1, 0.05), ('L:torso-muscle-dorsi', 0.2, 1, 0.05),
        ('L:stomach-tone', 1, 1.0001, 0.0), ('L:upperarm-muscle', 0, 1, 0.05), ('L:upperarm-shoulder-muscle', 0, 1, 0.05),
        ('L:lowerarm-muscle', 0, 1, 0.05), ('L:upperleg-muscle', 1, 1.0001, 0.0), ('L:lowerleg-muscle', 0.55, 0.5501, 0.0),
        ('L:measure-waist-circ', -1, 1, 1.2), ('L:measure-bust-circ', -1, 1, 1.2), ('L:measure-upperarm-circ', -1, 1, 1.5),
        # pinned by hand (the optimiser leaves these at 0 / the fold of the quads is a visual call): athlete's legs + neck
        ('L:measure-thigh-circ', 0.6, 0.6001, 0.0), ('L:measure-hips-circ', -0.65, -0.6499, 0.0), ('L:measure-neck-circ', 1, 1.0001, 0.0),
    ],
    'female': [
        ('muscle', 0.5, 0.9, 0.2), ('weight', 0.4, 0.8, 0.4), ('height', 0, 1, 0.0), ('breastSize', 0.4, 0.9, 0.3),
        ('L:buttocks-volume', 0, 1, 0.2), ('L:hip-scale-horiz', 0, 1, 0.4), ('L:stomach-tone', 0, 1, 0.1),
        ('L:upperleg-muscle', 0, 1, 0.3), ('L:upperleg-fat', 0, 1, 0.5), ('L:lowerleg-muscle', 0, 1, 0.4),
        ('L:upperarm-muscle', -0.5, 0.6, 0.5), ('L:measure-waist-circ', -1, 1, 0.9), ('L:measure-hips-circ', -1, 1, 1.0),
        ('L:measure-thigh-circ', -1, 1, 1.0), ('L:measure-bust-circ', -1, 1, 1.2), ('L:measure-neck-circ', -1, 1, 1.0),
    ],
}
BILATERAL = ('upperarm-muscle', 'upperarm-shoulder-muscle', 'lowerarm-muscle', 'upperleg-muscle', 'lowerleg-muscle', 'upperleg-fat')


def shape_from(sex, x):
    s = dict(BASES[sex])
    loc = {}
    for (k, *_), v in zip(VARS[sex], x):
        if k.startswith('L:'):
            k = k[2:]
            if k in BILATERAL:
                loc[f'l-{k}'] = loc[f'r-{k}'] = float(v)
            else:
                loc[k] = float(v)
        else:
            s[k] = float(v)
    s['local'] = loc
    return s


def fit(sex):
    ref = REF[sex]
    keys = list(ref)
    spec = VARS[sex]
    x0 = np.array([(lo + hi) / 2 if lo >= 0 else 0 for _, lo, hi, _ in spec])
    x0[[i for i, v in enumerate(spec) if v[0] == 'height']] = 0.5

    def resid(x):
        m = measure(shape_from(sex, x))
        r = [(m[k] - ref[k]) / (3.0 if k != 'height' else 1.0) for k in keys]
        r += [c * v for (_, _, _, c), v in zip(spec, x) if c]  # regularisation
        return np.array(r)

    res = least_squares(resid, x0, bounds=([v[1] for v in spec], [v[2] for v in spec]), diff_step=0.02, max_nfev=250)
    s = shape_from(sex, res.x)
    return s, measure(s)


if __name__ == '__main__':
    out = {}
    for sex in (sys.argv[1:] or ['male', 'female']):
        s, m = fit(sex)
        out[sex] = s
        print(f'# {sex}', file=sys.stderr)
        for k, v in REF[sex].items():
            print(f'#   {k:9s} ref {v:6.1f}  model {m[k]:6.1f}', file=sys.stderr)
    print(json.dumps(out, indent=1))
