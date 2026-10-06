"""
Men's plain crew-neck tee, SEWN on the site's body (KNOWLEDGE.md §1, §3, §8.1):

  blender -b -P tools/blender/sew/tee.py -- [dir]        (dir: export_body.py's output, default ~/.3dg-sew)

1. measure the rest body: neck girth, high shoulder point, shoulder tip, armpit, chest and hip girths, biceps;
2. draft the pattern the way a tailor does: front + back (straight side seams, armhole, sloped shoulder, crew
   neckline 6.5 cm deep at the front / 2.2 cm at the back), two set-in sleeves (width = biceps + ease, cap height
   solved so the cap measures the armhole + 2 %);
3. place every piece around the body (torso panels wrapped by arc length round its cross-sections, held at the
   shoulder's size above the shoulder joint; sleeves wrapped round the arm, underarm line at the armpit);
4. sew (sewing springs, gravity ×0.15, collar pinned like the tailor's hands → back collar only), weld the seams,
   settle under full gravity (soft jersey);
5. finish (subdivided, 1.5 mm thick) and write tee.obj (Blender coordinates, the rest pose).
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
import sewlib as S

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
D = argv[0] if argv else os.path.expanduser('~/.3dg-sew')
H = 0.015                                                    # mesh spacing (no subdivision after: it scallops edges)

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.gravity = (0, 0, -9.81); scn.frame_start = 1; scn.frame_current = 1
body, meta, bvh = S.load_body(D)
V, part, dom = meta['V'], meta['part'], meta['dom']
ARM = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
armish = lambda i: dom[i].split('_')[0] in ARM                # (by the strongest bone: the weights are split)

# ------------------------------------------------------------------ 1. measurements
Sh = S.joint(meta, 'upperarm_l')                             # shoulder joint (left)
neck0 = S.joint(meta, 'neck_01')
torso = lambda i: part[i] in (0, 4) and not armish(i)
skin = lambda i: part[i] == 0
def girth(z, keep=torso):
    h = S.hull2(S.body_slice(meta, z, keep)); return S.perimeter(h), h
def top_z(x, y, r=0.012, ry=0.04):
    zs = [v[2] for i, v in enumerate(V) if skin(i) and abs(v[0] - x) < r and abs(v[1] - y) < ry]
    return max(zs)
# the armpit: the lowest skin the upper arm owns, next to the torso
pit = min((v for i, v in enumerate(V) if skin(i) and dom[i] == 'upperarm_l' and v[0] < Sh.x + 0.07), key=lambda v: v[2]); zPit = pit[2]
Gneck, _ = girth(neck0.z + 0.035, lambda i: skin(i))
rN = Gneck * 1.12 / (2 * math.pi)                            # the neckline's radius: neck girth × 1.12
# high point shoulder: going down the neck, the last height where the body is still no wider than the neckline
zHPS = neck0.z + 0.06
while zHPS > Sh.z:
    xs = [abs(p[0]) for p in S.body_slice(meta, zHPS - 0.0025, lambda i: skin(i) and not armish(i))]
    if xs and max(xs) > rN + 0.015: break                     # (where the trapezius has clearly left the neck)
    zHPS -= 0.0025
xSP = Sh.x + 0.012; zSP = top_z(xSP, Sh.y)                   # shoulder tip (over the joint, a little out)
zU = zPit - 0.03                                             # the armhole's bottom: armpit + 3 cm
Gc, _ = girth(zPit - 0.04)                                   # chest
zH = meta['L']['groin'] + 0.005                              # hem (cut a little long: sewing hoists it)
Gh, _ = girth(zH + 0.02)                                     # hips at the hem
zHold = zPit - 0.03                                          # above the armhole's bottom: shrink-wrapped (below)
print(f'neck {Gneck:.3f}  chest {Gc:.3f}  hip {Gh:.3f}  armpit {zPit:.3f}  HPS {zHPS:.3f}  SP {zSP:.3f} at x {xSP:.3f}  hem {zH:.3f}')

sC = max(Gc * 1.10, Gh * 1.08) / 4                           # regular fit: chest + 10 %, straight side seams
# where the cloth starts: per cm the torso's outline (radius by angle round a smoothed centre) — draped, not traced:
# going down from the chest it never comes in faster than 15 cm/m (the fabric falls off the pecs and the shoulder
# blades, it doesn't follow the abs or the small of the back) — and pushed out evenly all round until the pattern's
# front + back exactly close round it (the side seams land on the sides, no wings)
NA = 120
_rad, _cen = {}, {}
def _raw(zz):
    h = S.hull2(S.body_slice(meta, zz, torso))
    cx = sum(p[0] for p in h) / len(h); cy = sum(p[1] for p in h) / len(h)
    sec = S.Section(h, 0.0)
    r = []
    for k in range(NA):
        t = 2 * math.pi * k / NA; dx, dy = math.sin(t), -math.cos(t)
        best = 0.0
        for j in range(len(h)):
            (x1, y1), (x2, y2) = h[j], h[(j + 1) % len(h)]
            ex, ey = x2 - x1, y2 - y1; den = dx * ey - dy * ex
            if abs(den) < 1e-12: continue
            tt = ((x1 - cx) * ey - (y1 - cy) * ex) / den; uu = ((x1 - cx) * dy - (y1 - cy) * dx) / den
            if tt > 0 and -1e-9 <= uu <= 1 + 1e-9: best = max(best, tt)
        r.append(best)
    return (cx, cy), r
zs = [round(zHold - 0.01 * k, 2) for k in range(int((zHold - zH) / 0.01) + 4)]
prev = None
for zz in zs:
    c, r = _raw(zz)
    if prev is not None and zz < zPit - 0.02:
        r = [max(r[k], prev[1][k] - 0.15 * 0.01) for k in range(NA)]
    _rad[zz] = r; _cen[zz] = c; prev = (c, r)
# (the centres and, below, the ease smoothed over ±6 cm: a step in either is a ledge the cloth keeps)
_c0 = dict(_cen)
for zz in zs:
    nb_ = [_c0[z2] for z2 in zs if abs(z2 - zz) <= 0.06]
    _cen[zz] = (sum(c[0] for c in nb_) / len(nb_), sum(c[1] for c in nb_) / len(nb_))
def _ease_raw(zz):
    c, r = _cen[zz], _rad[zz]
    P0 = sum(math.dist((c[0] + r[k] * math.sin(2 * math.pi * k / NA), c[1] - r[k] * math.cos(2 * math.pi * k / NA)),
                       (c[0] + r[(k + 1) % NA] * math.sin(2 * math.pi * (k + 1) / NA), c[1] - r[(k + 1) % NA] * math.cos(2 * math.pi * (k + 1) / NA))) for k in range(NA))
    return max(0.006, (4 * sC - P0) / (2 * math.pi))
_e0 = {zz: _ease_raw(zz) for zz in zs}
zUr = round(zU, 2)
for zz in zs:                                                 # above the armhole's bottom: 1.2 cm (the ±6 cm smoothing blends it)
    if zz > zU: _e0[zz] = 0.012
_ease = {zz: sum(_e0[z2] for z2 in zs if abs(z2 - zz) <= 0.06) / sum(1 for z2 in zs if abs(z2 - zz) <= 0.06) for zz in zs}
_sec = {}
def section(z):
    zz = round(max(min(z, zHold), zs[-1]) / 0.01) * 0.01
    zz = round(zz, 2)
    if zz not in _sec:
        c, r = _cen[zz], _rad[zz]
        poly = [(c[0] + r[k] * math.sin(2 * math.pi * k / NA), c[1] - r[k] * math.cos(2 * math.pi * k / NA)) for k in range(NA)]
        _sec[zz] = S.Section(poly, _ease[zz])
    return _sec[zz]
def arc_to_x(sec, x, back=False):
    lo, hi = 0.0, sec.P / 2
    for _ in range(40):
        mid = (lo + hi) / 2
        if sec.point(mid, back, clamp=10)[0] < x: lo = mid
        else: hi = mid
    return lo

# ------------------------------------------------------------------ 2. the pattern (u = arc length, v = height)
# the neck and shoulder points from the measurements (pattern units are lengths over the body: the shoulders' slight
# curve front to back adds ~4 %)
sHPS_f = sHPS_b = rN * 1.04
sSP_f = sSP_b = xSP * 1.04
print(f'pattern: half width {sC:.3f}, HPS arc {sHPS_f:.3f}/{sHPS_b:.3f}, shoulder arc {sSP_f:.3f}/{sSP_b:.3f}')

def bez(p0, p1, p2, p3, n=24):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (k / n for k in range(n + 1))]
def armhole(sSP, sgn):
    p0, p3 = (sgn * sC, zU), (sgn * sSP, zSP)
    return bez(p0, (sgn * (sSP + 0.35 * (sC - sSP)), zU), (sgn * (sSP - 0.004), zU + 0.45 * (zSP - zU)), p3)
def neckline(sHPS, drop):
    zc = zHPS - drop
    return [(sHPS * math.cos(t), zc + drop * (1 - math.sin(t)) if False else zHPS - drop * math.sin(t)) for t in (k / 24 * math.pi for k in range(25))]
def torso_piece(name, sHPS, sSP, drop):
    A_L, A_R = armhole(sSP, 1), [p for p in armhole(sSP, -1)][::-1]
    return [('hem', [(-sC, zH), (sC, zH)]), ('side_L', [(sC, zH), (sC, zU)]), ('arm_L', A_L),
            ('shoulder_L', [(sSP, zSP), (sHPS, zHPS)]), ('neck', neckline(sHPS, drop)),
            ('shoulder_R', [(-sHPS, zHPS), (-sSP, zSP)]), ('arm_R', A_R), ('side_R', [(-sC, zU), (-sC, zH)])]
FE = torso_piece('front', sHPS_f, sSP_f, 0.065)
BE = torso_piece('back', sHPS_b, sSP_b, 0.022)
armF = S.curve_len(dict(FE)['arm_L']); armB = S.curve_len(dict(BE)['arm_L'])

# sleeve: width = biceps + ease, cap height solved so the cap measures the armhole + 2 %
upper = S.joint(meta, 'upperarm_l', 1) - Sh; a_dir = upper.normalized()
bic = []
for i, v in enumerate(V):
    if not skin(i) or dom[i] != 'upperarm_l': continue
    p = Vector(v) - Sh; al = p.dot(a_dir)
    if abs(al - 0.12) < 0.006:
        q = p - a_dir * al; bic.append(q)
up0 = Vector((0, 0, 1)); upv = (up0 - a_dir * up0.dot(a_dir)).normalized(); fwv = a_dir.cross(upv).normalized()
Gb = S.perimeter(S.hull2([(q.dot(upv), q.dot(fwv)) for q in bic]))
W = Gb * 1.06 + 0.05                                          # a tee's sleeve is easy: biceps × 1.06 + 5 cm
SL = 0.23                                                     # shoulder seam to sleeve hem
Wh = W * 0.94
def cap(capH, sgn):
    return [(sgn * W / 2 * t, capH * (1 - math.cos(math.pi * t)) / 2 if False else capH * math.sin(math.pi * t / 2) ** 2) for t in (k / 24 for k in range(25))]
lo, hi = 0.01, 0.2
for _ in range(50):
    capH = (lo + hi) / 2
    if S.curve_len(cap(capH, 1)) * 2 < (armF + armB) * 1.02: lo = capH
    else: hi = capH
print(f'sleeve: biceps {Gb:.3f}, width {W:.3f}, cap height {capH:.3f} (armhole {armF + armB:.3f})')
def sleeve_edges():
    cf = cap(capH, 1); cb = [p for p in cap(capH, -1)][::-1]
    return [('cap_front', cf), ('under_front', [(W / 2, capH), (Wh / 2, SL)]), ('hem', [(Wh / 2, SL), (-Wh / 2, SL)]),
            ('under_back', [(-Wh / 2, SL), (-W / 2, capH)]), ('cap_back', cb)]
# vertex counts shared across each seam
nF, nB = max(4, round(armF / H)), max(4, round(armB / H))
nS = max(2, round(max(S.curve_len(dict(FE)['shoulder_L']), S.curve_len(dict(BE)['shoulder_L'])) / H))
nSide = max(3, round((zU - zH) / H))
common = {'shoulder_L': nS, 'shoulder_R': nS, 'side_L': nSide, 'side_R': nSide}
front = S.Piece('front', FE, H, {**common, 'arm_L': nF, 'arm_R': nF})
back = S.Piece('back', BE, H, {**common, 'arm_L': nB, 'arm_R': nB})
nU = max(3, round((SL - capH) / H))
sleeveL = S.Piece('sleeve_l', sleeve_edges(), H, {'cap_front': nF, 'cap_back': nB, 'under_front': nU, 'under_back': nU})
sleeveR = S.Piece('sleeve_r', sleeve_edges(), H, {'cap_front': nF, 'cap_back': nB, 'under_front': nU, 'under_back': nU})

# ------------------------------------------------------------------ 3. placement
def place_torso(back_):
    def f(s, z):
        x, y = section(z).point(s, back_)
        return (x, y, z)
    return f
def place_sleeve(side):
    sg = 1 if side == 'l' else -1
    Sj = S.joint(meta, f'upperarm_{side}'); a = (S.joint(meta, f'upperarm_{side}', 1) - Sj).normalized()
    up = (up0 - a * up0.dot(a)).normalized(); fw = Vector((0, -1, 0)); fw = (fw - a * fw.dot(a) - up * fw.dot(up)).normalized()
    pit_s = Vector((sg * pit[0], pit[1], pit[2])); al_pit = (pit_s - Sj).dot(a)
    R0 = W / (2 * math.pi)
    def f(u, t):
        al = al_pit + (t - capH) if t >= capH else al_pit - (capH - t) * 0.55
        R = R0 + (0.02 * (1 - t / capH) if t < capH else 0.0)
        ph = u / R0
        return tuple(Sj + a * al + (up * math.cos(ph) + fw * math.sin(ph)) * R)
    return f
G = S.Garment('Tee')
G.add(front, place_torso(False)); G.add(back, place_torso(True))
G.add(sleeveL, place_sleeve('l')); G.add(sleeveR, place_sleeve('r'))
G.sew(front, 'side_L', back, 'side_L'); G.sew(front, 'side_R', back, 'side_R')
G.sew(front, 'shoulder_L', back, 'shoulder_L'); G.sew(front, 'shoulder_R', back, 'shoulder_R')
G.sew(sleeveL, 'cap_front', front, 'arm_L', reverse=True); G.sew(sleeveL, 'cap_back', back, 'arm_L')
G.sew(sleeveR, 'cap_front', front, 'arm_R'); G.sew(sleeveR, 'cap_back', back, 'arm_R', reverse=True)
for sl in (sleeveL, sleeveR): G.sew(sl, 'under_front', sl, 'under_back', reverse=True)
# the collar band (the tailor's hands): torso above the shoulder line − 1 cm
for p, nm in ((front, 'collar_front'), (back, 'collar_back')):
    G.groups[nm] = {G.vid(p, i) for i, uv in enumerate(p.uv) if uv[1] > zSP - 0.01}
G.groups['collar'] = G.groups['collar_front'] | G.groups['collar_back']
# above the armhole: shrink-wrapped onto the body (+ 1 cm), blended in over 6 cm — the shoulders slope, no slice
# holds them; the drape restores the pattern's own lengths (it rests as the flat pattern)
def wrap_upper(co_list):
    for k, p in enumerate(co_list):
        w = max(0.0, min(1.0, (p.z - (zU - 0.04)) / 0.06)); w = w * w * (3 - 2 * w)
        if w <= 0: continue
        loc, nrm, _, d = bvh.find_nearest(p)
        if loc is None: continue
        co_list[k] = p.lerp(loc + nrm * 0.01, w)
wrap_upper(G.co)
# smoothed as fabric (a wrap traces every muscle and the spine's groove), never closer than 8 mm to the body
nbr = [set() for _ in G.co]
for f in G.faces:
    for k in range(3): a, b = f[k], f[(k + 1) % 3]; nbr[a].add(b); nbr[b].add(a)
up = [k for k, p in enumerate(G.co) if p.z > zU - 0.06 and nbr[k]]
for it in range(30):
    new = {k: G.co[k].lerp(sum((G.co[j] for j in nbr[k]), Vector()) / len(nbr[k]), 0.5) for k in up}
    for k, p in new.items():
        loc, nrm, _, d = bvh.find_nearest(p)
        G.co[k] = loc + nrm * 0.008 if loc is not None and (p - loc).dot(nrm) < 0.008 else p
G.presew(bvh)
G.relax_lengths(bvh)
ob = G.build(bvh)
print(f'tee: {len(ob.data.vertices)} verts, {len(ob.data.polygons)} tris, {sum(len(s) for s in G.seams)} stitches')
S.write_obj(ob, os.path.join(D, 'tee_placed.obj'), modifiers=False)

# ------------------------------------------------------------------ 4. sew, weld, settle
S.weld(ob, G.seams, bvh)                                  # one garment from here on
S.write_obj(ob, os.path.join(D, 'tee_sewn.obj'), modifiers=False)
# drape: the soft jersey settles onto the shoulders and hangs
S.cloth(ob, 'settle', fabric=S.JERSEY, gravity=1.0, frames=200); S.run(120, 'settle')
S.apply_cloth(ob)

# ------------------------------------------------------------------ 5. finish
bpy.context.view_layer.objects.active = ob
so = ob.modifiers.new('thick', 'SOLIDIFY'); so.thickness = 0.0015; so.offset = -1.0
for p in ob.data.polygons: p.use_smooth = True
S.write_obj(ob, os.path.join(D, 'tee.obj'))
print('written', os.path.join(D, 'tee.obj'))
