"""
Procedurally paint face/hair detail into the body UV layout (called by build.py).

detail.png (2048², RGBA, linear masks)
  R  eyebrows (individual hair strokes)
  G  scalp: where head hair grows (soft hairline)
  B  beard/stubble region
  A  unused

Shapes are defined in 3D relative to the eye joints, rasterised through the
body's UV triangles, so they land correctly regardless of UV seams.
"""
import numpy as np
from PIL import Image, ImageFilter

S = 2048


def value_noise(p, seed=0):
    """Smooth 3D value noise, vectorised. p: (n,3)."""
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        n = (n ^ (n >> 13)) * 1274126177
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    lerp = lambda a, b, t: a + (b - a) * t
    return lerp(
        lerp(lerp(h(x, y, z), h(x + 1, y, z), fx), lerp(h(x, y + 1, z), h(x + 1, y + 1, z), fx), fy),
        lerp(lerp(h(x, y, z + 1), h(x + 1, y, z + 1), fx), lerp(h(x, y + 1, z + 1), h(x + 1, y + 1, z + 1), fx), fy),
        fz,
    )


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def rasterize(V, VT, faces, head_y, with_ids=False):
    """Yield (texel_xy (n,2) int, pos (n,3)[, tri id]) for every covered texel of body faces above head_y.
    Triangle ids follow the body index order in build.py (faces in order, fan-triangulated)."""
    tris = []
    for g, c in faces:
        if g != 'body':
            continue
        for k in range(1, len(c) - 1):
            tris.append((c[0], c[k], c[k + 1]))
    for tid, (a, b, cc) in enumerate(tris):
        if max(V[a[0]][1], V[b[0]][1], V[cc[0]][1]) < head_y:
            continue
        P = np.array([V[a[0]], V[b[0]], V[cc[0]]])
        T = np.array([VT[a[1]], VT[b[1]], VT[cc[1]]]) * [S, S]
        T[:, 1] = S - T[:, 1]  # image rows go down
        x0, y0 = np.floor(T.min(0)).astype(int) - 1
        x1, y1 = np.ceil(T.max(0)).astype(int) + 1
        xs, ys = np.meshgrid(np.arange(max(0, x0), min(S, x1)), np.arange(max(0, y0), min(S, y1)))
        q = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1)
        d = (T[1, 1] - T[2, 1]) * (T[0, 0] - T[2, 0]) + (T[2, 0] - T[1, 0]) * (T[0, 1] - T[2, 1])
        if abs(d) < 1e-12:
            continue
        w0 = ((T[1, 1] - T[2, 1]) * (q[:, 0] - T[2, 0]) + (T[2, 0] - T[1, 0]) * (q[:, 1] - T[2, 1])) / d
        w1 = ((T[2, 1] - T[0, 1]) * (q[:, 0] - T[2, 0]) + (T[0, 0] - T[2, 0]) * (q[:, 1] - T[2, 1])) / d
        w2 = 1 - w0 - w1
        m = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not m.any():
            continue
        W = np.stack([w0[m], w1[m], w2[m]], 1)
        if with_ids:
            yield q[m].astype(int), W @ P, tid
        else:
            yield q[m].astype(int), W @ P


def paint(V, VT, faces, eye_l, eye_r, ears_mask):
    out = np.zeros((4, S, S), np.float32)
    eye_y = (eye_l[1] + eye_r[1]) / 2
    eye_x = abs(eye_l[0])
    eye_z = eye_l[2]
    head = V[V[:, 1] > eye_y + 0.3]
    head = head[np.abs(head[:, 0]) < 0.3]
    cz = (head[:, 2].max() + head[:, 2].min()) / 2  # head centre depth
    ear = np.asarray(ears_mask.resize((S, S)), np.float32) / 255.0

    for px, P in rasterize(V, VT, faces, eye_y - 1.6):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        side = np.sign(x) + (x == 0)
        lx = np.abs(x) - eye_x          # + toward the temple
        ly = y - eye_y                   # + up
        front = smoothstep(eye_z - 0.55, eye_z - 0.25, z)

        # ---------------- eyebrows ----------------
        t = np.clip((lx + 0.2) / 0.52, 0, 1)                      # 0 medial … 1 tail
        centre = 0.160 + 0.04 * np.sin(np.clip(t * 1.2, 0, 1) * np.pi) - 0.045 * smoothstep(0.72, 1.0, t)
        half = 0.042 * (1 - t) + 0.016 * t + 0.01 * (t < 0.12) * (1 - t / 0.12)
        dist = np.abs(ly - centre) / half
        shape = (1 - smoothstep(0.55, 1.15, dist)) * smoothstep(-0.02, 0.06, t) * (1 - smoothstep(0.93, 1.0, t))
        shape *= front * (np.abs(x) > 0.07)
        # hair strokes: medial hairs point up, the rest sweep toward the tail
        ang = np.where(t < 0.2, np.pi / 2 - 0.35, 0.18 - 0.35 * t)
        ca, sa = np.cos(ang), np.sin(ang)
        u = (lx * ca + ly * sa)            # along the hair
        v = (-lx * sa + ly * ca)           # across hairs
        n = value_noise(np.stack([u * 9, v * 260, side * 3.7], 1), 1)
        n2 = value_noise(np.stack([u * 14, v * 420, side * 5.1 + 9], 1), 2)
        strands = np.clip((np.maximum(n, n2 * 0.9) - 0.45) * 3.2, 0, 1)
        brow = shape * (0.5 + 0.5 * strands) * (0.8 + 0.2 * value_noise(np.stack([lx * 30, ly * 30, side], 1), 3))
        # ---------------- scalp ----------------
        phi = np.abs(np.arctan2(x, z - cz))                     # 0 front … pi back
        hx = np.array([0, 0.45, 0.8, 1.1, 1.35, 1.75, 2.3, 3.2])
        hy = np.array([0.66, 0.6, 0.5, 0.2, 0.06, 0.0, -0.42, -0.78])
        line = np.interp(phi, hx, hy)
        # widow's peak dip in the centre of the forehead
        line -= 0.04 * np.exp(-(x / 0.12) ** 2) * (phi < 0.3)
        wob = (value_noise(np.stack([x * 14, y * 14, z * 14], 1), 4) - 0.5) * 0.05
        scalp = smoothstep(line - 0.02 + wob, line + 0.1 + wob, ly)
        scalp *= 1 - ear[px[:, 1], px[:, 0]]
        # ---------------- beard ----------------
        # upper beard line: under the nose in the centre, dipping over the cheeks, rising to the sideburn
        ax = np.abs(x)
        top = np.interp(ax, [0, 0.2, 0.32, 0.5, 0.62, 0.75], [-0.47, -0.49, -0.6, -0.5, -0.3, -0.05])
        upper = 1 - smoothstep(top - 0.06, top + 0.02, ly)
        lower = smoothstep(-1.45, -1.25, ly)                 # fades out down the throat
        behind = 1 - smoothstep(0.78, 0.9, ax)               # stop at the ear
        lips = np.exp(-((ly + 0.7) / 0.075) ** 2) * np.exp(-(x / 0.26) ** 4)
        facing = smoothstep(cz - 0.1, cz + 0.2, z)          # front half of the head only
        beard = np.clip(upper * lower * behind * facing - lips * 1.6, 0, 1)

        for ch, val in ((0, brow), (1, scalp), (2, beard)):
            np.maximum.at(out[ch], (px[:, 1], px[:, 0]), val.astype(np.float32))

    # grow a few texels past UV seams so bilinear/mip sampling never pulls in black
    imgs = []
    for ch in range(4):
        im = Image.fromarray((np.clip(out[ch], 0, 1) * 255).astype(np.uint8))
        grown = im.filter(ImageFilter.MaxFilter(5))
        im = Image.fromarray(np.where(np.asarray(im) > 0, np.asarray(im), np.asarray(grown)).astype(np.uint8))
        imgs.append(im)
    return Image.merge('RGBA', imgs)


def paint_underwear(V, VT, faces, lm):
    """
    underwear.png (2048², RGB): R briefs  G boxer briefs  B bra.
    Values ramp from 0.5 at the garment edge to 1.0 about 1 cm inside, so the
    shader can alpha-cut a smooth outline and draw an elastic band along it.
    Returns (image, {channel: sorted triangle ids that carry any coverage}).
    lm: landmarks in base-mesh space (decimetres): crotch, waist, apex (xyz), ub
    """
    out = np.zeros((3, S, S), np.float32)
    tris = [set(), set(), set()]
    ramp = lambda d: np.clip(0.5 + d / 0.2, 0, 1)   # 0.1 dm (1 cm) from edge to full
    for px, P, tid in rasterize(V, VT, faces, -99, with_ids=True):
        x, y, z = np.abs(P[:, 0]), P[:, 1], P[:, 2]
        front = smoothstep(-0.2, 0.4, z)
        # briefs: waistband + high-cut leg openings (fuller at the back)
        cut = lm['crotch'] - 0.05 + np.maximum(0, x - 0.22) * (0.5 + 0.42 * front)
        briefs = np.minimum(lm['waist'] - y, (y - cut) * 0.7)
        # boxer briefs: waistband + a hem around the upper thigh
        boxers = np.minimum(lm['waist'] + 0.12 - y, y - (lm['crotch'] - 1.3))
        # bra: band with a scooped neckline in front, narrower band at the back, plus straps
        neck = lm['apex'][1] + 0.5 - 0.32 * np.exp(-(P[:, 0] / 0.38) ** 2)
        top = neck * front + (lm['ub'] + 0.55) * (1 - front)
        band = np.minimum.reduce([y - lm['ub'], top - y, 1.75 - x])
        strap = np.minimum.reduce([x - 0.52, 0.84 - x, y - lm['ub'], lm['apex'][1] + 2.6 - y])
        bra = np.maximum(band, strap)
        for ch, d in enumerate((briefs, boxers, bra)):
            v = ramp(d).astype(np.float32)
            v[d < -0.02] = 0
            if (v > 0).any():
                tris[ch].add(tid)
                np.maximum.at(out[ch], (px[:, 1], px[:, 0]), v)
    imgs = []
    for ch in range(3):
        im = Image.fromarray((out[ch] * 255).astype(np.uint8))
        grown = im.filter(ImageFilter.MaxFilter(5))
        imgs.append(Image.fromarray(np.where(np.asarray(im) > 0, np.asarray(im), np.asarray(grown)).astype(np.uint8)))
    return Image.merge('RGB', imgs), [sorted(t) for t in tris]
