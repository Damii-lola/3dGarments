#!/usr/bin/env python3
"""
Build the studio's male body FROM SCRATCH out of the reference photos.

    python3 tools/body/ref/extract.py      # (once) masks from the reference photos
    python3 tools/body/build.py            # → web/public/body/male.glb (+ preview PNGs in tools/body/out)

Nothing comes from a base mesh. Every horizontal slice of the body is read off the photos:

  front photo  →  where the head / torso / each arm / each leg is across the slice (x, width)
  side photo   →  where the front and back of the body are at that height (z, depth)

Each part becomes a rounded cross-section (superellipse) at that height; the slices are stacked
into one smooth solid (smooth union → marching cubes → Taubin smoothing), so the outline of the
result IS the outline of the photos. Then the muscle relief is copied from the photos' shading
(dark grooves between muscles → shallow grooves on the surface, front photo on the front, back
photo on the back, side photo on the side), and the body is rigged with a skeleton placed on
the reference's joints and exported as a skinned glTF.

Units while building: centimetres, y up from the floor, body faces +z, its right side is −x.
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd
from skimage import measure

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, 'ref')
OUT = os.path.join(HERE, 'out')
PUB = os.path.join(HERE, '..', '..', 'web', 'public', 'body')

H = 185.0          # crown → sole (cm)
ANKLE_H = 10.6     # height of the narrowest point above the ankle bones (the photos' scale anchor)
VOX = 0.35         # voxel (cm)

# rows in the photos: crown, and the narrowest ankle row (front: per-leg width min; side: depth min)
PHOTO = {
    'front': {'crown': 128, 'ankle': 1880},
    'side': {'crown': 133, 'ankle': 1790},
    'back': {'crown': 148, 'ankle': 1760},
}


def load(view):
    m = np.asarray(Image.open(os.path.join(REF, f'{view}_mask.png'))) > 0
    img = np.asarray(Image.open(os.path.join(REF, f'{view}.png')).convert('RGB')).astype(np.float32) / 255
    p = PHOTO[view]
    s = (H - ANKLE_H) / (p['ankle'] - p['crown'])   # cm per pixel
    return m, img, s


def runs(row, min_len=2):
    xs = np.nonzero(row)[0]
    if not len(xs):
        return []
    cut = np.nonzero(np.diff(xs) > 1)[0] + 1
    return [(a[0], a[-1] + 1) for a in np.split(xs, cut) if a[-1] + 1 - a[0] >= min_len]


class View:
    def __init__(self, name):
        self.name = name
        self.mask, self.img, self.s = load(name)
        self.crown = PHOTO[name]['crown']

    def row(self, y):
        """image row of height y (cm)"""
        return int(round(self.crown + (H - y) / self.s))


FRONT, SIDE, BACK = View('front'), View('side'), View('back')

# horizontal origins: body midline in the front photo, torso middle in the side photo
_ank = runs(FRONT.mask[FRONT.row(ANKLE_H)])
FRONT.cx = (_ank[0][0] + _ank[-1][1]) / 2
_ch = runs(SIDE.mask[SIDE.row(120)])
SIDE.cx = (_ch[0][0] + _ch[-1][1]) / 2
fx = lambda col: (col - FRONT.cx) * FRONT.s          # image-left is the body's right side → −x
sz = lambda col: (col - SIDE.cx) * SIDE.s          # side photo shows the right side, face to the right → +z


# --------------------------------------------------------------------------- landmarks from the photos
def front_runs(y):
    return [(fx(a), fx(b)) for a, b in runs(FRONT.mask[FRONT.row(y)])]


def side_extent(y):
    rs = runs(SIDE.mask[SIDE.row(y)], 3)
    if not rs:
        return None
    a, b = max(rs, key=lambda r: r[1] - r[0])
    return sz(a), sz(b)


def find_armpit():
    """highest height (going down) at which the arms separate from the trunk"""
    for y in np.arange(150, 100, -0.2):
        if len(front_runs(y)) >= 3:
            return y
    raise RuntimeError('no armpit')


def find_crotch():
    for y in np.arange(110, 60, -0.2):
        rs = [r for r in front_runs(y) if abs((r[0] + r[1]) / 2) < 25]
        if len(rs) >= 2 and rs[1][0] - rs[0][1] > 0.8:
            return y
    raise RuntimeError('no crotch')


ARMPIT = find_armpit()
CROTCH = find_crotch()
print(f'armpit {ARMPIT:.1f} cm, crotch {CROTCH:.1f} cm')


def width_of(y, pick):
    rs = front_runs(y)
    return pick(rs) if rs else None


def arm_run(y, side):
    """the outermost run on one side (side −1 = body right / −x, +1 = left), below the armpit"""
    rs = front_runs(y)
    if len(rs) < 3:
        return None
    return rs[0] if side < 0 else rs[-1]


# arm landmarks: wrist = narrowest forearm between 70 and 100 cm, elbow = narrowest between forearm and biceps
_aw = {y: np.mean([r[1] - r[0] for r in (arm_run(y, -1), arm_run(y, 1)) if r]) for y in np.arange(70, ARMPIT, 0.5)
       if arm_run(y, -1) and arm_run(y, 1)}
_ys = np.array(sorted(_aw))
_w = np.array([_aw[y] for y in _ys])
WRIST = _ys[(_ys > 80) & (_ys < 100)][np.argmin(_w[(_ys > 80) & (_ys < 100)])]
ELBOW = _ys[(_ys > 104) & (_ys < 120)][np.argmin(_w[(_ys > 104) & (_ys < 120)])]
# the shoulder band: from the armpit up to where the outline stops being wider than the chest (deltoid tops)
_shw = [(y, front_runs(y)[-1][1] - front_runs(y)[0][0]) for y in np.arange(ARMPIT, 165, 0.25) if front_runs(y)]
_wmax = max(w for _, w in _shw)
DELT_TOP = max(y for y, w in _shw if w > 0.86 * _wmax)
ARM_W = np.mean([r[1] - r[0] for r in (arm_run(ARMPIT - 1.5, -1), arm_run(ARMPIT - 1.5, 1))])
NECK_Y = min(y for y, w in _shw if w < 0.3 * _wmax + 1e9 and y > DELT_TOP and w < 16)
print(f'wrist {WRIST:.1f}, elbow {ELBOW:.1f}, deltoid top {DELT_TOP:.1f}, neck {NECK_Y:.1f}, arm width at armpit {ARM_W:.1f}')


def _torso_below_armpit():
    rs = front_runs(ARMPIT - 0.5)
    t = [r for r in rs if abs((r[0] + r[1]) / 2) < 12]
    return t[0][0], t[-1][1]


TORSO_AP = _torso_below_armpit()
ARM_AP = {s_: arm_run(ARMPIT - 0.5, s_) for s_ in (-1, 1)}


def _leg_runs(y):
    rs = [r for r in front_runs(y) if abs((r[0] + r[1]) / 2) < 16]
    return sorted(rs, key=lambda r: abs((r[0] + r[1]) / 2))[:2]


LEGS_CR = _leg_runs(CROTCH - 1.0)

# face: the side photo's front edge on the head has the nose, lips and chin in it. The skull takes a
# smoothed front edge; the real profile is added back as a narrow ridge down the middle of the face.
_HEAD_YS = np.arange(NECK_Y - 12, H + 0.5, 0.25)
_zf = np.array([side_extent(y)[1] if side_extent(y) else np.nan for y in _HEAD_YS])
_zf_base = nd.grey_opening(np.nan_to_num(_zf, nan=-99), size=int(6 / 0.25))  # removes bumps narrower than ~6 cm
_zf_base = nd.gaussian_filter1d(_zf_base, 4)
face_base = lambda y: float(np.interp(y, _HEAD_YS, _zf_base))
FACE_W = lambda y: np.interp(y, [NECK_Y - 12, NECK_Y, NECK_Y + 4, NECK_Y + 9, NECK_Y + 14, NECK_Y + 18, H],
                             [1.6, 2.4, 2.6, 1.9, 1.6, 3.2, 3.2])  # adam's apple, chin, lips, nose, brow


# --------------------------------------------------------------------------- part tracks
# Every part's position and size is sampled from the photos at each height, then smoothed along the
# height (pixel steps and the odd stray pixel would otherwise show as rings around the body).
TY = np.arange(0.0, H + 0.5, 0.25)


def _raw_tracks():
    T = {k: np.full((len(TY), 4), np.nan) for k in
         ('trunk', 'head', 'armL', 'armR', 'legL', 'legR', 'depth', 'web', 'hip')}
    for i, y in enumerate(TY):
        ext = side_extent(y)
        rs = front_runs(y)
        if ext is None or not rs:
            continue
        zb, zf = ext
        T['depth'][i] = (zb, zf, 0, 0)
        if y >= ARMPIT:
            big = max(rs, key=lambda r: r[1] - r[0])
            x0, x1 = big
            if y >= NECK_Y - 6:
                T['head'][i] = (x0, x1, 0, 0)
            if y <= DELT_TOP + 6:
                t = np.clip((y - ARMPIT) / max(DELT_TOP - ARMPIT, 1), 0, 1)
                fade = np.clip((DELT_TOP + 6 - y) / 6, 0, 1)
                wa = ARM_W * (1.0 + 0.15 * t)
                tw0 = (TORSO_AP[1] - TORSO_AP[0]) / 2
                half = (x1 - x0) / 2
                chest = tw0 + (half - wa * 0.9 - tw0) * t ** 0.7
                chest = chest * fade + half * (1 - fade)
                T['trunk'][i] = ((x0 + x1) / 2 - chest, (x0 + x1) / 2 + chest, 0, 0)
                if fade > 0:
                    T['armL'][i] = (x1 - wa * fade, x1, 0, 0)
                    T['armR'][i] = (x0, x0 + wa * fade, 0, 0)
                    web = 0.45 + 0.55 * min(1, (y - ARMPIT) / 8)
                    T['web'][i] = (x0 + wa * 0.25, x1 - wa * 0.25, web * fade, 0)
            elif y < NECK_Y - 6:
                T['trunk'][i] = (x0, x1, 0, 0)
            continue
        if y >= CROTCH:
            torso = [r for r in rs if abs((r[0] + r[1]) / 2) < 12]
            arms = [r for r in rs if abs((r[0] + r[1]) / 2) >= 12]
            if torso:
                T['trunk'][i] = (torso[0][0], torso[-1][1], 0, 0)
            if y < CROTCH + 9:
                T['hip'][i] = (1 - (y - CROTCH) / 9, 0, 0, 0)
        else:
            legs = _leg_runs(y)
            arms = [r for r in rs if r not in legs]
            for x0, x1 in legs:
                T['legL' if x0 + x1 > 0 else 'legR'][i] = (x0, x1, 0, 0)
        for x0, x1 in arms:
            k = 'armL' if x0 + x1 > 0 else 'armR'
            if np.isnan(T[k][i, 0]):
                T[k][i] = (x0, x1, 0, 0)
            else:  # fingers: several runs on one side → cover them all
                T[k][i, 0] = min(T[k][i, 0], x0)
                T[k][i, 1] = max(T[k][i, 1], x1)
    return T


def _smooth(track, sigma_cm):
    out = track.copy()
    ok = ~np.isnan(track[:, 0])
    if ok.sum() < 3:
        return out
    sig = sigma_cm / 0.25
    for c in range(track.shape[1]):
        v = np.where(ok, track[:, c], 0.0)
        w = nd.gaussian_filter1d(ok.astype(float), sig)
        sv = nd.gaussian_filter1d(v, sig)
        out[:, c] = np.where(ok, sv / np.maximum(w, 1e-6), np.nan)
    return out


RAW = _raw_tracks()
# skull width without the ears: the ears are a short bump on the head width → morphological opening
_hw = RAW['head'][:, 1] - RAW['head'][:, 0]
_okh = ~np.isnan(_hw)
_skull = _hw.copy()
_skull[_okh] = nd.grey_opening(_hw[_okh], size=int(9 / 0.25))
EARS = np.where(_okh, np.clip(_hw - _skull, 0, None), 0) / 2  # per-side ear protrusion
_hc = (RAW['head'][:, 1] + RAW['head'][:, 0]) / 2
RAW['head'][:, 0], RAW['head'][:, 1] = _hc - _skull / 2, _hc + _skull / 2
TR = {k: _smooth(v, 0.9 if k not in ('depth',) else 1.2) for k, v in RAW.items()}
TR['head'] = _smooth(RAW['head'], 0.7)
EARS = nd.gaussian_filter1d(EARS, 2)


def tr(k, y):
    i = int(round(y / 0.25))
    return TR[k][min(max(i, 0), len(TY) - 1)]


def sections(y):
    """[(cx, cz, a, c, p)] cross-sections of every part cut at height y (cm), from the smoothed tracks."""
    out = []
    zb, zf = tr('depth', y)[:2]
    if np.isnan(zb):
        return out
    zc, zd = (zf + zb) / 2, (zf - zb) / 2
    h = tr('head', y)
    if not np.isnan(h[0]):
        zfb = min(face_base(y), zf)
        zc2, zd2 = (zfb + zb) / 2, (zfb - zb) / 2
        out.append(((h[0] + h[1]) / 2, zc2, (h[1] - h[0]) / 2, zd2, 2.2 if y > NECK_Y else 2.3))
        if zf > zfb + 0.15:
            out.append((0.0, (zf + zc2) / 2, FACE_W(y), (zf - zc2) / 2, 2.0))
        e = EARS[int(round(y / 0.25))]
        if e > 0.25:
            for sg in (-1, 1):
                out.append((sg * ((h[1] - h[0]) / 2 + e * 0.5), zc2 - 0.15 * zd2, e * 0.9, 1.3, 2.0))
    t = tr('trunk', y)
    if not np.isnan(t[0]):
        out.append(((t[0] + t[1]) / 2, zc, (t[1] - t[0]) / 2, zd, 2.35))
    w = tr('web', y)
    if not np.isnan(w[0]) and w[2] > 0.02:
        out.append(((w[0] + w[1]) / 2, zc - 0.05 * zd, (w[1] - w[0]) / 2, zd * w[2], 2.6))
    hip = tr('hip', y)[0]
    if not np.isnan(hip):
        for l0, l1 in LEGS_CR:
            out.append(((l0 + l1) / 2, zc, (l1 - l0) / 2 * (0.7 + 0.3 * hip), zd * (0.75 + 0.25 * hip), 2.1))
    for k in ('legL', 'legR'):
        l = tr(k, y)
        if not np.isnan(l[0]):
            out.append(((l[0] + l[1]) / 2, zc, (l[1] - l[0]) / 2, zd, 2.1))
    for k in ('armL', 'armR'):
        a = tr(k, y)
        if not np.isnan(a[0]):
            wd = a[1] - a[0]
            kk = 1.05 if y > ELBOW else 0.9 if y > WRIST else 1.0
            zz = zc - 0.08 * zd if y > ARMPIT else zc
            out.append(((a[0] + a[1]) / 2, zz, wd / 2, max(min(wd * kk / 2, zd), 0.5), 2.0))
    return out


# --------------------------------------------------------------------------- the solid
XS = np.arange(-40, 40, VOX)
ZS = np.arange(-22, 30, VOX)
YS = np.arange(0.2, H + 0.6, VOX)


def smax(a, b, k=1.2):
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.maximum(a, b) + h * h * k / 4


def slice_field(secs):
    Xg, Zg = np.meshgrid(XS, ZS, indexing='xy')  # (z, x)
    F = np.full(Xg.shape, -10.0)
    for cx, cz, a, c, p in secs:
        a, c = max(a, 0.3), max(c, 0.3)
        r = (np.abs(Xg - cx) / a) ** p + (np.abs(Zg - cz) / c) ** p
        f = (1 - r ** (1 / p)) * min(a, c)
        F = smax(F, f)
    return F


def build_field():
    F = np.stack([slice_field(sections(y)) for y in YS])  # (y, z, x)
    # stacked slices: soften the steps between neighbouring slices (≈1 cm vertically)
    return nd.gaussian_filter(F, (1.6, 0.6, 0.6))


def preview(F, path, scale=2):
    """orthographic render of the field: sub-voxel hit depth + field-gradient normals (front, right side, back)"""
    G = np.stack(np.gradient(F), -1)  # d/dy, d/dz, d/dx
    tiles = []
    for view in ('front', 'side', 'back'):
        if view == 'front':
            A, g = F[:, ::-1, :], G[:, ::-1, :]          # rays go −z, from the front; (y, ray, x)
            nrm = lambda g: np.stack([-g[..., 2], g[..., 0], g[..., 1]], -1)  # screen x, y, toward viewer
        elif view == 'back':
            A, g = F[:, :, ::-1], G[:, :, ::-1]          # rays go +z; screen x = −x
            A, g = A, g
            nrm = lambda g: np.stack([-g[..., 2], g[..., 0], -g[..., 1]], -1)
        else:                                          # from the body's right (−x), looking +x; screen x = +z
            A, g = F.transpose(0, 2, 1), G.transpose(0, 2, 1, 3)
            nrm = lambda g: np.stack([g[..., 1] * -1, g[..., 0], g[..., 2]], -1)
        ins = A > 0
        hit = ins.any(1)
        k = np.argmax(ins, 1)
        k0 = np.clip(k - 1, 0, None)
        yy, xx = np.indices(k.shape)
        gh = g[yy, k, xx]
        n = -nrm(gh)
        n[..., 2] = np.abs(n[..., 2])
        n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
        L = np.array([-0.45, 0.55, 0.7]); L /= np.linalg.norm(L)
        diff = np.clip(n @ L, 0, 1)
        img = np.where(hit, 0.18 + 0.72 * diff + 0.1 * n[..., 2], 0.08)[::-1]
        if view == 'back':
            img = img
        t = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
        tiles.append(t.resize((t.width * scale, t.height * scale), Image.BILINEAR))
    out = Image.new('L', (sum(t.width for t in tiles), tiles[0].height))
    x = 0
    for t in tiles:
        out.paste(t, (x, 0))
        x += t.width
    out.save(path)


def surface(F, faces=140000):
    import trimesh
    v, f, _, _ = measure.marching_cubes(F, 0.0, spacing=(VOX, VOX, VOX))
    V = np.stack([v[:, 2] + XS[0], v[:, 0] + YS[0], v[:, 1] + ZS[0]], 1)  # (y, z, x) index → x, y, z cm
    m = trimesh.Trimesh(V, f, process=True)
    m.update_faces(m.nondegenerate_faces())
    m.remove_unreferenced_vertices()
    # keep the body (drop any stray islands)
    parts = m.split(only_watertight=False)
    m = max(parts, key=lambda p: len(p.faces))
    trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=12)
    if len(m.faces) > faces:
        m = m.simplify_quadric_decimation(face_count=faces)
    trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=4)
    if m.volume < 0:
        m.invert()
    return m


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    F = build_field()
    preview(F, os.path.join(OUT, 'preview.png'))
    M = surface(F)
    M.export(os.path.join(OUT, 'body.ply'))
    print('mesh', len(M.vertices), 'verts', len(M.faces), 'faces', 'watertight', M.is_watertight, 'volume L', M.volume / 1000)
