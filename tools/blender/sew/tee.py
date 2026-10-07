"""
Male_Tee_Shirt template — men's plain crew-neck tee, sewn on the site's
male body (KNOWLEDGE.md §1, §3, §8.1):

  blender -b -P tools/blender/sew/tee.py -- [outdir]

Self-contained: imports web/public/body/male.glb directly, writes the body
files on-the-fly (body_rest/pose .obj/.json), then runs the full sewlib
cloth-sim pipeline — no separate export_body step needed.
Output: Male_Tee_Shirt.obj (the permanent garment template).

1. Import male.glb → measure + write body_rest.obj/json + body_pose.obj/json
2. Draft the pattern: front + back (armhole, sloped shoulder, 6.5 cm deep
   front neckline / 2.2 cm back), two set-in sleeves (biceps + ease, cap
   height solved to armhole + 2 %), rib neckband at 85 % of neckline.
3. Place every piece around the body (arc-length sections, envelope-smoothed).
4. Sew, weld, settle (soft jersey, 200 frames).
5. Finish: smooth, unpose → rest pose, write tee.obj (Blender coords).
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
D   = argv[0] if argv else os.path.expanduser('~/.3dg-sew')
SEX = 'male'
os.makedirs(D, exist_ok=True)

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
GLB  = os.path.join(REPO, 'web', 'public', 'body', f'{SEX}.glb')
print(f'[tee] importing {GLB} → {D}')

# ── STAGE 1: import male.glb, generate body_rest + body_pose files ───────────

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.gravity = (0, 0, -9.81)

bpy.ops.import_scene.gltf(filepath=GLB, merge_vertices=False)

body_ob = None
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.data.attributes.get('_PART'):
        body_ob = ob; break
if body_ob is None:
    sys.exit('[tee] body mesh not found in GLB (no _PART attribute)')

rig = body_ob.find_armature()
if rig is None:
    for ob in bpy.data.objects:
        if ob.type == 'ARMATURE': rig = ob; break
if rig is None:
    sys.exit('[tee] armature not found in GLB')

me_glb = body_ob.data
mw_glb = body_ob.matrix_world

# rest-pose evaluated vertices
if me_glb.shape_keys:
    for kb in me_glb.shape_keys.key_blocks: kb.value = 0.0
    me_glb.update()
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = body_ob.evaluated_get(dg)
V_rest = [(mw_glb @ v.co)[:] for v in ev.data.vertices]
F_body = [list(p.vertices) for p in ev.data.polygons]

part_attr = me_glb.attributes.get('_PART')
part_glb = [int(round(part_attr.data[i].value)) if part_attr else 0 for i in range(len(me_glb.vertices))]

gi_glb = {g.index: g.name for g in body_ob.vertex_groups}
dom_glb, arm_w_glb = [], []
for v in me_glb.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom_glb.append(gi_glb[best.group] if best else '')
    ARM_BONES = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
    arm_w_glb.append(sum(g.weight for g in v.groups if gi_glb.get(g.group, '').split('_')[0] in ARM_BONES))

joints_rest = {}
for bn in rig.data.bones:
    joints_rest[bn.name] = [list((mw_glb @ bn.head_local)[:]), list((mw_glb @ bn.tail_local)[:])]

# groin landmark
bvh_rest = BVHTree.FromPolygons([Vector(v) for v in V_rest], F_body)
groin = None
for zz_int in range(1000, 500, -1):
    zz  = zz_int / 1000.0
    hit = bvh_rest.ray_cast(Vector((0.0, -1.0, zz)), Vector((0, 1, 0)), 2.0)
    if hit[0] is None or hit[0].y > -0.03:
        groin = zz + 0.005; break
if groin is None:
    groin = joints_rest.get('pelvis', [[0, 0, 0.9]])[0][2] * 0.85
bottom_z = min(v[2] for v in V_rest)
L_lm = dict(top=max(v[2] for v in V_rest), bottom=bottom_z,
             groin=groin, crotch=groin,
             waist=groin + 0.30, hip=groin + 0.20, leg=bottom_z + 0.45)
print(f'[tee] groin={groin:.3f}  top={L_lm["top"]:.3f}')

with open(os.path.join(D, 'body_rest.obj'), 'w') as f:
    for v in V_rest: f.write('v %.6f %.6f %.6f\n' % v)
    for p in F_body: f.write('f ' + ' '.join(str(i + 1) for i in p) + '\n')
json.dump(dict(part=part_glb, dom=dom_glb, arm=arm_w_glb,
               joints=joints_rest, L=L_lm),
          open(os.path.join(D, 'body_rest.json'), 'w'))
print(f'[tee] wrote body_rest.obj/json ({len(V_rest)} verts)')

# A-pose: lower upper arms 15° more
LOWER = math.radians(15)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
for pb in rig.pose.bones: pb.matrix_basis = Matrix()
bpy.context.view_layer.update()
for s, sg in (('l', 1), ('r', -1)):
    pb = rig.pose.bones.get(f'upperarm_{s}')
    if pb is None: continue
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(sg * LOWER, 4, 'Y') @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
dg2  = bpy.context.evaluated_depsgraph_get()
ev2  = body_ob.evaluated_get(dg2)
V_pose = [(mw_glb @ v.co)[:] for v in ev2.data.vertices]

bpy.ops.object.mode_set(mode='POSE')
pose_joints = {pb.name: [list(pb.head[:]), list(pb.tail[:])] for pb in rig.pose.bones}
D_mats = {}
for pb in rig.pose.bones:
    mat = pb.matrix @ pb.bone.matrix_local.inverted()
    D_mats[pb.name] = [list(r) for r in mat]
W_skin = []
for v in me_glb.vertices:
    gs = sorted(((gi_glb[g.group], g.weight) for g in v.groups
                 if g.weight > 0 and gi_glb.get(g.group) in D_mats),
                key=lambda t: -t[1])[:4]
    s_ = sum(w for _, w in gs) or 1.0
    W_skin.append([[n, w / s_] for n, w in gs])
bpy.ops.object.mode_set(mode='OBJECT')

with open(os.path.join(D, 'body_pose.obj'), 'w') as f:
    for v in V_pose: f.write('v %.6f %.6f %.6f\n' % v)
    for p in F_body: f.write('f ' + ' '.join(str(i + 1) for i in p) + '\n')
json.dump(dict(D=D_mats, W=W_skin, joints=pose_joints),
          open(os.path.join(D, 'body_pose.json'), 'w'))
print('[tee] wrote body_pose.obj/json')

# ── STAGE 2: full sewlib-based tee ────────────────────────────────────────────

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sewlib as S

H = 0.015   # mesh spacing — no subdivision after (it scallops edges)

scn = bpy.context.scene
scn.frame_start = 1; scn.frame_current = 1
body_col, meta, bvh = S.load_body(D, pose=True)   # A-pose as cloth collider
V, part, dom = meta['V'], meta['part'], meta['dom']

ARM = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
armish = lambda i: dom[i].split('_')[0] in ARM

# ── 1. measurements ───────────────────────────────────────────────────────────
Sh     = S.joint(meta, 'upperarm_l')
neck0  = S.joint(meta, 'neck_01')
torso  = lambda i: part[i] in (0, 4) and not armish(i)
skin   = lambda i: part[i] == 0

def girth(z, keep=torso):
    h = S.hull2(S.body_slice(meta, z, keep)); return S.perimeter(h), h

def top_z(x, y, r=0.012, ry=0.04):
    zs = [v[2] for i, v in enumerate(V) if skin(i) and abs(v[0] - x) < r and abs(v[1] - y) < ry]
    return max(zs)

# armpit: lowest skin vertex dominated by upperarm_l that is still close to the torso
pit = min((v for i, v in enumerate(V) if skin(i) and dom[i] == 'upperarm_l' and v[0] < Sh.x + 0.07),
          key=lambda v: v[2])
# armhole depth measured on REST pose (A-pose drags armpit down)
VR = [tuple(map(float, l.split()[1:4])) for l in open(os.path.join(D, 'body_rest.obj')) if l.startswith('v ')]
pitR = min((v for i, v in enumerate(VR) if skin(i) and dom[i] == 'upperarm_l' and v[0] < Sh.x + 0.07),
           key=lambda v: v[2])
zPit = pitR[2]

Gneck, _ = girth(neck0.z + 0.035, lambda i: skin(i))
rN = Gneck * 1.18 / (2 * math.pi)  # neckline radius: × 1.18 — wider opening, skin visible above band

# high-point shoulder: last height where body width ≤ neckline width
zHPS = neck0.z + 0.06
while zHPS > Sh.z:
    xs = [abs(p[0]) for p in S.body_slice(meta, zHPS - 0.0025, lambda i: skin(i) and not armish(i))]
    if xs and max(xs) > rN + 0.015: break
    zHPS -= 0.0025

xSP = Sh.x + 0.012; zSP = top_z(xSP, Sh.y)   # shoulder tip
zU  = zPit - 0.03                              # armhole bottom = armpit + 3 cm
Gc, _ = girth(zPit - 0.04)                    # chest girth
zH  = meta['L']['groin'] - 0.025             # hem 2.5 cm below groin: clears the glutes so the back hem hangs free
Gh, _ = girth(zH + 0.02)                      # hip girth

zHold = zPit - 0.03
print(f'neck {Gneck:.3f}  chest {Gc:.3f}  hip {Gh:.3f}  armpit {zPit:.3f}  '
      f'HPS {zHPS:.3f}  SP {zSP:.3f} at x {xSP:.3f}  hem {zH:.3f}')

sC = max(Gc * 1.10, Gh * 1.08) / 4   # regular fit: chest + 10 %

# per-cm torso outline — gravity-draped: never comes in faster than 15 cm/m below chest
NA = 120
_rad, _cen = {}, {}
def _raw(zz):
    h  = S.hull2(S.body_slice(meta, zz, torso))
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
            tt = ((x1 - cx) * ey - (y1 - cy) * ex) / den
            uu = ((x1 - cx) * dy - (y1 - cy) * dx) / den
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

_c0 = dict(_cen)
for zz in zs:
    nb_ = [_c0[z2] for z2 in zs if abs(z2 - zz) <= 0.06]
    _cen[zz] = (sum(c[0] for c in nb_) / len(nb_), sum(c[1] for c in nb_) / len(nb_))

def _ease_raw(zz):
    c, r = _cen[zz], _rad[zz]
    P0 = sum(math.dist(
            (c[0] + r[k]       * math.sin(2 * math.pi * k / NA),       c[1] - r[k]       * math.cos(2 * math.pi * k / NA)),
            (c[0] + r[(k+1)%NA]* math.sin(2 * math.pi * (k+1) / NA),   c[1] - r[(k+1)%NA]* math.cos(2 * math.pi * (k+1) / NA)))
        for k in range(NA))
    return max(0.006, (4 * sC - P0) / (2 * math.pi))

_e0 = {zz: _ease_raw(zz) for zz in zs}
for zz in zs:
    if zz > zU: _e0[zz] = 0.012
_ease = {zz: sum(_e0[z2] for z2 in zs if abs(z2 - zz) <= 0.06) /
             sum(1           for z2 in zs if abs(z2 - zz) <= 0.06)
         for zz in zs}

_sec = {}
def section(z):
    zz = round(max(min(z, zHold), zs[-1]) / 0.01) * 0.01; zz = round(zz, 2)
    if zz not in _sec:
        c, r = _cen[zz], _rad[zz]
        poly = [(c[0] + r[k] * math.sin(2 * math.pi * k / NA),
                 c[1] - r[k] * math.cos(2 * math.pi * k / NA)) for k in range(NA)]
        _sec[zz] = S.Section(poly, _ease[zz])
    return _sec[zz]

def arc_to_x(sec, x, back=False):
    lo, hi = 0.0, sec.P / 2
    for _ in range(40):
        mid = (lo + hi) / 2
        if sec.point(mid, back, clamp=10)[0] < x: lo = mid
        else: hi = mid
    return lo

# ── 2. pattern ────────────────────────────────────────────────────────────────
sHPS_f = sHPS_b = rN * 1.04
sSP_f  = sSP_b  = xSP * 1.04
print(f'pattern: half width {sC:.3f}  HPS arc {sHPS_f:.3f}  shoulder arc {sSP_f:.3f}')

def bez(p0, p1, p2, p3, n=24):
    return [tuple((1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t**2*c + t**3*d
                  for a,b,c,d in zip(p0,p1,p2,p3)) for t in (k/n for k in range(n+1))]

def armhole(sSP, sgn):
    p0, p3 = (sgn * sC, zU), (sgn * sSP, zSP)
    return bez(p0, (sgn*(sSP + 0.35*(sC - sSP)), zU),
               (sgn*(sSP - 0.004), zU + 0.45*(zSP - zU)), p3)

def neckline(sHPS, drop):
    return [(sHPS * math.cos(t), zHPS - drop * math.sin(t))
            for t in (k / 24 * math.pi for k in range(25))]

def torso_piece(sHPS, sSP, drop):
    A_L = armhole(sSP,  1)
    A_R = armhole(sSP, -1)[::-1]
    return [('hem',        [(-sC, zH), (sC, zH)]),
            ('side_L',     [(sC, zH),  (sC, zU)]),
            ('arm_L',      A_L),
            ('shoulder_L', [(sSP, zSP),  (sHPS, zHPS)]),
            ('neck',       neckline(sHPS, drop)),
            ('shoulder_R', [(-sHPS, zHPS), (-sSP, zSP)]),
            ('arm_R',      A_R),
            ('side_R',     [(-sC, zU), (-sC, zH)])]

# above the armhole: pattern length measured along the body surface
def profile_k(front_):
    xm   = (rN + xSP) / 2; pts = []; z = zU
    while z < 1.70:
        o = Vector((xm, -1.0 if front_ else 1.0, z))
        d = Vector((0, 1.0 if front_ else -1.0, 0))
        hit = bvh.ray_cast(o, d, 2.0)
        if hit[0] is None: break
        pts.append((hit[0].y, z)); z += 0.005
    top = bvh.ray_cast(Vector((xm, pts[-1][0], 2.0)), Vector((0, 0, -1)), 2.0)[0] if pts else None
    if top is not None: pts.append((top.y, top.z))
    sg = -1 if front_ else 1
    h  = S.hull2([(sg * y, zz) for y, zz in pts] +
                 [(sg * pts[0][0] - 1.0, pts[0][1]), (sg * pts[-1][0] - 1.0, pts[-1][1])])
    out_ = [q for q in h if q[0] > min(sg * y for y, zz in pts) - 0.5]
    out_.sort(key=lambda q: q[1])
    arc  = sum(math.dist(out_[k], out_[k + 1]) for k in range(len(out_) - 1))
    return max(1.0, min(1.8, arc / max(0.02, pts[-1][1] - zU)))

kF, kB = profile_k(True), profile_k(False)
kF, kB = 1 + 0.5 * (kF - 1), 1 + 0.5 * (kB - 1)
print(f'along-body factor above armhole: front {kF:.2f}, back {kB:.2f}')

def stretch(edges, k):
    return [(n, [(u, v if v <= zU else zU + (v - zU) * k) for u, v in pts]) for n, pts in edges]

FE = stretch(torso_piece(sHPS_f, sSP_f, 0.065 / kF), kF)
BE = stretch(torso_piece(sHPS_b, sSP_b, 0.022 / kB), kB)
armF = S.curve_len(dict(FE)['arm_L']); armB = S.curve_len(dict(BE)['arm_L'])

# sleeve: biceps + ease, cap height solved so cap = armhole + 2 %
upper = S.joint(meta, 'upperarm_l', 1) - Sh; a_dir = upper.normalized()
bic = []
for i, v in enumerate(V):
    if not skin(i) or dom[i] != 'upperarm_l': continue
    p = Vector(v) - Sh; al = p.dot(a_dir)
    if abs(al - 0.12) < 0.006:
        q = p - a_dir * al; bic.append(q)
up0 = Vector((0, 0, 1))
upv = (up0 - a_dir * up0.dot(a_dir)).normalized()
fwv = a_dir.cross(upv).normalized()
Gb  = S.perimeter(S.hull2([(q.dot(upv), q.dot(fwv)) for q in bic]))
W_sl = Gb * 1.20 + 0.05   # boxy tee sleeve: biceps × 1.20 + 5 cm — relaxed tube, visible opening
Wh   = W_sl               # no taper: straight tube, cuff opening = full tube width

def cap_half(w, capH, sgn):
    return [(sgn * w * t, capH * math.sin(math.pi * t / 2) ** 2)
            for t in (k / 24 for k in range(25))]

def half_w(capH, target):
    lo_, hi_ = 0.0, 0.5
    for _ in range(40):
        m = (lo_ + hi_) / 2
        if S.curve_len(cap_half(m, capH, 1)) < target: lo_ = m
        else: hi_ = m
    return lo_

lo, hi = 0.01, 0.3
for _ in range(50):
    capH = (lo + hi) / 2
    if half_w(capH, armF) + half_w(capH, armB) > W_sl: lo = capH
    else: hi = capH
WF, WB = half_w(capH, armF), half_w(capH, armB)
SL = capH + 0.13   # underarm length: 13 cm below cap — enough to show the open cuff
print(f'sleeve: biceps {Gb:.3f}  width {W_sl:.3f} (front {WF:.3f}/back {WB:.3f})'
      f'  cap {capH:.3f}  len {SL:.3f}  armhole {armF:.3f}+{armB:.3f}')

def sleeve_edges():
    cf = cap_half(WF, capH,  1)
    cb = cap_half(WB, capH, -1)[::-1]
    hf, hb = WF - (W_sl - Wh) / 2, WB - (W_sl - Wh) / 2
    return [('cap_front',   cf),
            ('under_front', [(WF, capH), (hf, SL)]),
            ('hem',         [(hf, SL), (-hb, SL)]),
            ('under_back',  [(-hb, SL), (-WB, capH)]),
            ('cap_back',    cb)]

nF    = max(4, round(armF / H)); nB = max(4, round(armB / H))
nS    = max(2, round(max(S.curve_len(dict(FE)['shoulder_L']),
                         S.curve_len(dict(BE)['shoulder_L'])) / H))
nSide = max(3, round((zU - zH) / H))
nU    = max(3, round((SL - capH) / H))
common = {'shoulder_L': nS, 'shoulder_R': nS, 'side_L': nSide, 'side_R': nSide}
lNf, lNb   = S.curve_len(dict(FE)['neck']), S.curve_len(dict(BE)['neck'])
nNf, nNb   = max(6, round(lNf / H)), max(4, round(lNb / H))

front  = S.Piece('front',   FE, H, {**common, 'arm_L': nF, 'arm_R': nF, 'neck': nNf})
back   = S.Piece('back',    BE, H, {**common, 'arm_L': nB, 'arm_R': nB, 'neck': nNb})

# neckband: 3 cm rib strip cut at 85 % of neckline — visible crew-neck band sitting snug to neck
BH  = 0.018; Lb = 0.85 * (lNf + lNb); Lbf = Lb * lNf / (lNf + lNb)
band = S.Piece('band',
               [('bottom_front', [(0, 0), (Lbf, 0)]),
                ('bottom_back',  [(Lbf, 0), (Lb, 0)]),
                ('end_R',        [(Lb, 0), (Lb, BH)]),
                ('top',          [(Lb, BH), (0, BH)]),
                ('end_L',        [(0, BH), (0, 0)])],
               H * 0.7, {'bottom_front': nNf, 'bottom_back': nNb, 'end_R': 3, 'end_L': 3})

sleeveL = S.Piece('sleeve_l', sleeve_edges(), H, {'cap_front': nF, 'cap_back': nB, 'under_front': nU, 'under_back': nU})
sleeveR = S.Piece('sleeve_r', sleeve_edges(), H, {'cap_front': nF, 'cap_back': nB, 'under_front': nU, 'under_back': nU})

# ── 3. placement ──────────────────────────────────────────────────────────────
def place_torso(back_):
    k = kB if back_ else kF
    def f(s, v):
        z = v if v <= zU else zU + (v - zU) / k
        x, y = section(z).point(s, back_)
        return (x, y, z)
    return f

def place_sleeve(side):
    sg  = 1 if side == 'l' else -1
    Sj  = S.joint(meta, f'upperarm_{side}')
    a   = (S.joint(meta, f'upperarm_{side}', 1) - Sj).normalized()
    up  = (up0 - a * up0.dot(a)).normalized()
    fw  = Vector((0, -1, 0)); fw = (fw - a * fw.dot(a) - up * fw.dot(up)).normalized()
    pit_s  = Vector((sg * pit[0], pit[1], pit[2]))
    al_pit = (pit_s - Sj).dot(a)
    R0 = W_sl / (2 * math.pi)
    def f(u, t):
        al = al_pit + (t - capH) if t >= capH else al_pit - (capH - t) * 0.55
        R  = R0 + (0.02 * (1 - t / capH) if t < capH else 0.0)
        ph = (u - (WF - WB) / 2) / R0
        return tuple(Sj + a * al + (up * math.cos(ph) + fw * math.sin(ph)) * R)
    return f

G = S.Garment('Tee')
G.add(front,   place_torso(False))
G.add(back,    place_torso(True))
G.add(sleeveL, place_sleeve('l'))
G.add(sleeveR, place_sleeve('r'))

# neckband placed along the neckline ring, leaning inward as it rises
ring = ([G.co[G.vid(front, i)] for i in front.edge('neck')] +
        [G.co[G.vid(back,  i)] for i in back.edge('neck')][::-1][1:])
rl   = [0.0]
for k in range(1, len(ring)): rl.append(rl[-1] + (ring[k] - ring[k - 1]).length)
nax  = Vector((0, neck0.y, 0))
def place_band(u, v):
    t  = u / Lb * rl[-1]
    k  = max(0, min(len(ring) - 2, next((j for j in range(len(rl) - 1) if rl[j + 1] >= t), len(ring) - 2)))
    f_ = (t - rl[k]) / ((rl[k + 1] - rl[k]) or 1)
    p  = ring[k].lerp(ring[k + 1], f_)
    inward = Vector((nax.x - p.x, nax.y - p.y, 0)).normalized()
    return tuple(p + Vector((0, 0, v)) + inward * (v * 0.35))
G.add(band, place_band)

G.sew(front, 'side_L',     back,    'side_L')
G.sew(front, 'side_R',     back,    'side_R')
G.sew(front, 'shoulder_L', back,    'shoulder_L')
G.sew(front, 'shoulder_R', back,    'shoulder_R')
G.sew(sleeveL, 'cap_front', front,  'arm_L', reverse=True)
G.sew(sleeveL, 'cap_back',  back,   'arm_L')
G.sew(sleeveR, 'cap_front', front,  'arm_R')
G.sew(sleeveR, 'cap_back',  back,   'arm_R', reverse=True)
for sl in (sleeveL, sleeveR): G.sew(sl, 'under_front', sl, 'under_back', reverse=True)
G.sew(band, 'bottom_front', front, 'neck')
G.sew(band, 'bottom_back',  back,  'neck', reverse=True)
G.sew(band, 'end_R',        band,  'end_L', reverse=True)

# collar band vertex groups (above shoulder line − 1 cm)
for p, nm in ((front, 'collar_front'), (back, 'collar_back')):
    kk = kF if p is front else kB
    G.groups[nm] = {G.vid(p, i) for i, uv in enumerate(p.uv)
                    if uv[1] > zU + (zSP - 0.01 - zU) * kk}
G.groups['collar'] = G.groups['collar_front'] | G.groups['collar_back']

# sleeve TUBE (hanging portion below the cap) hangs free — cap vertices still wrap so the
# armhole seam aligns correctly; tube starts at its placed cylinder and drapes under gravity
sleeve_tube_verts = (
    {G.vid(sleeveL, i) for i, uv in enumerate(sleeveL.uv) if uv[1] >= capH * 0.95} |
    {G.vid(sleeveR, i) for i, uv in enumerate(sleeveR.uv) if uv[1] >= capH * 0.95}
)

# above armhole: shrink-wrap onto body (+ 1 cm), blend over 6 cm; sleeve tube excluded
def wrap_upper(co_list):
    for k, p in enumerate(co_list):
        if k in sleeve_tube_verts: continue
        w = max(0.0, min(1.0, (p.z - (zU - 0.04)) / 0.06)); w = w * w * (3 - 2 * w)
        if w <= 0: continue
        loc, nrm, _, d = bvh.find_nearest(p)
        if loc is None: continue
        co_list[k] = p.lerp(loc + nrm * 0.01, w)
wrap_upper(G.co)

# smooth upper area — fabric spans muscle grooves, never < 8 mm from body; sleeve tube excluded
nbr = [set() for _ in G.co]
for f_ in G.faces:
    for k in range(3): a, b = f_[k], f_[(k + 1) % 3]; nbr[a].add(b); nbr[b].add(a)
bandv = {G.vid(band, i) for i in range(len(band.uv))}
up_verts = [k for k, p in enumerate(G.co) if p.z > zU - 0.06 and nbr[k]
            and k not in bandv and k not in sleeve_tube_verts]
for it in range(30):
    new = {k: G.co[k].lerp(sum((G.co[j] for j in nbr[k]), Vector()) / len(nbr[k]), 0.5)
           for k in up_verts}
    for k, p in new.items():
        loc, nrm, _, d = bvh.find_nearest(p)
        G.co[k] = loc + nrm * 0.008 if loc is not None and (p - loc).dot(nrm) < 0.008 else p

G.presew(bvh)
G.relax_lengths(bvh)
ob = G.build(bvh)
print(f'tee: {len(ob.data.vertices)} verts  {len(ob.data.polygons)} tris  '
      f'{sum(len(s) for s in G.seams)} stitches')

# fold vertex group: Gaussian-weighted around each underarm corner (side seam × armhole bottom)
# → shrink_group in cloth() creates a real buckle there; iron(exclude_group='fold') leaves it
_SIGMA_FOLD = 0.06   # 6 cm radius
_fold_w = {}
for _p, _is_back in ((front, False), (back, True)):
    for _i, _uv in enumerate(_p.uv):
        _u, _v = _uv
        for _sg in (-1.0, 1.0):
            _du = abs(_u - _sg * sC)
            _dv = _v - zU   # positive = above armhole (cap area), negative = below
            if _dv > 0.04: continue   # well above armhole — not the drag-line zone
            _w = math.exp(-(_du**2 + max(0.0, _dv)**2) / (2 * _SIGMA_FOLD**2))
            if _w > 0.02:
                _vid = G.vid(_p, _i)
                _fold_w[_vid] = max(_fold_w.get(_vid, 0.0), _w)
_fg = ob.vertex_groups.new(name='fold')
for _vid, _w in _fold_w.items():
    _fg.add([_vid], float(_w), 'REPLACE')
print(f'  fold group: {len(_fold_w)} verts', flush=True)

S.write_obj(ob, os.path.join(D, 'Male_Tee_Shirt_placed.obj'), modifiers=False)

# ── 4. sew, weld, settle ──────────────────────────────────────────────────────
S.weld(ob, G.seams, bvh)
S.write_obj(ob, os.path.join(D, 'Male_Tee_Shirt_sewn.obj'), modifiers=False)

# weld() has a second fill_small_holes pass that runs AFTER its own gap-push, so any Steiner
# vertices it creates can sit inside the 1.5mm bodysuit. Push them outward using the body BVH
# normal as direction, but as a DELTA (only adjusts depth along the normal, does not replace
# position). Run 23 catastrophe used "v.co = _loc + nrm * 0.003" on all fill verts — that
# replaced x/y position too and tore the collar/cuffs/hem apart. This delta only nudges depth.
_bm_sp = bmesh.new(); _bm_sp.from_mesh(ob.data)
_fl_sp = _bm_sp.faces.layers.int.get('fill_tri')
if _fl_sp:
    _fill_faces_sp = [f for f in _bm_sp.faces if f.is_valid and f[_fl_sp]]
    _steiner_sp = {v for f in _fill_faces_sp for v in f.verts
                   if all(lf.is_valid and lf[_fl_sp] for lf in v.link_faces)}
    _pushed_sp = 0
    for _v in _steiner_sp:
        _loc, _nrm_b, _, _ = bvh.find_nearest(_v.co)
        if _loc is None or _nrm_b.length < 0.1: continue
        _gap = (_v.co - _loc).dot(_nrm_b)
        if _gap < 0.003:
            _v.co = _v.co + _nrm_b * (0.003 - _gap)
            _pushed_sp += 1
    if _pushed_sp:
        _bm_sp.to_mesh(ob.data); ob.data.update()
    print(f'  pushed {_pushed_sp} Steiner fill vert(s) to ≥ 3mm (body-normal delta push)', flush=True)
_bm_sp.free()

# pin CDT fill vertices during the cloth sim so they stay at weld()'s correctly-oriented,
# correctly-positioned locations — previous approach of deleting + re-filling post-sim placed
# new Steiner points on the Newell plane inside the body surface (showing the black bodysuit).
# Pinning prevents them from flying outward while keeping their geometry exactly as weld left it.
_bm = bmesh.new(); _bm.from_mesh(ob.data)
_fl = _bm.faces.layers.int.get('fill_tri')
_fill_verts_idx = list({v.index for f in _bm.faces if _fl and f[_fl] for v in f.verts})
_bm.free()
_fpg = ob.vertex_groups.new(name='fill_pins')
if _fill_verts_idx:
    _fpg.add(_fill_verts_idx, 1.0, 'REPLACE')
print(f'  pinning {len(_fill_verts_idx)} fill vertices during sim', flush=True)

# drape: soft jersey, 200 frames; fold zone shrinks 6 % → real buckle at underarm drag-lines
S.cloth(ob, 'settle', fabric=S.JERSEY, gravity=1.0, frames=200, shrink=0.06, shrink_group='fold', pin='fill_pins')
S.run(120, 'settle')
S.apply_cloth(ob)

# remove pin group — no longer needed after drape
ob.vertex_groups.remove(ob.vertex_groups.get('fill_pins') or _fpg)
S.smooth_seams(ob, bvh)
S.smooth_edges(ob)
S.write_obj(ob, os.path.join(D, 'Male_Tee_Shirt_pose.obj'), modifiers=False)

# unpose to rest pose (inverse skinning)
rest_co = S.unpose([v.co.copy() for v in ob.data.vertices], meta)
for v, c in zip(ob.data.vertices, rest_co): v.co = c
ob.data.update()
# iron against REST body: unpose introduces per-vertex noise (nearby verts land slightly
# differently after inverse skinning) that reads as thin bright creases once re-posed on site
# exclude_group='fold' keeps the armpit buckle — don't press out the deliberately sewn-in drag-line
S.iron(ob, bvh_rest, iters=12, exclude_group='fold')  # 12 iters: extra passes settle back-panel unpose noise
# hem straighten: iron() excludes all boundary verts, so the cloth-sim fold at the
# back center (glutes push the hem outward on both sides, center back falls toward
# the spine) survives unpose unchanged — push every open-edge vertex to ≥ 2 cm
# from the body surface so the hem hangs clear all the way around
S.smooth_edges(ob)
_bm_h = bmesh.new(); _bm_h.from_mesh(ob.data)
# hem ONLY: there are four open loops (hem, left cuff, right cuff, neckband top).
# The previous code applied push + tilt-fix to ALL loops → cuffs pushed 2 cm off
# the arm (white fringe spikes) and neckband Z-clamped flat (jagged collar).
# Fix: pick only the loop with the LOWEST average Z = the shirt hem.
_all_lps = [lp for lp in S.boundary_loops(_bm_h) if len(lp) > 10]
if _all_lps:
    _hem_lp = min(_all_lps, key=lambda lp: sum(v.co.z for v in lp) / len(lp))
    for _v in _hem_lp:
        _loc, _nrm, _, _ = bvh_rest.find_nearest(_v.co)
        if _loc is None or _nrm is None: continue
        # push HORIZONTALLY only — groin normal tilts downward and would spike the hem
        _nh = Vector((_nrm.x, 0.0, _nrm.z))
        if _nh.length < 0.01: continue
        _nh.normalize()
        _gap = (_v.co - _loc).dot(_nh)
        if _gap < 0.02:
            _v.co = _v.co + _nh * (0.02 - _gap)
    # hem tilt fix: clamp outliers to median Z so hem hangs flat
    _zs = sorted(v.co.z for v in _hem_lp)
    _med = _zs[len(_zs) // 2]
    for _v in _hem_lp:
        if _v.co.z > _med + 0.005:
            _v.co.z = _med + 0.005
_bm_h.to_mesh(ob.data); _bm_h.free(); ob.data.update()
S.smooth_edges(ob)

# remove armhole junction fills: in rest pose they sit at shoulder height (~1.4–1.6 m z).
# In display pose the arm hangs down, and mixed arm/torso skin weights pull these fill
# vertices into the bodysuit space → black patch. A 1–3 mm hole at the seam corner is
# invisible; leaving no fill avoids the skinning artifact entirely.
_bm_af = bmesh.new(); _bm_af.from_mesh(ob.data)
_fl_af = _bm_af.faces.layers.int.get('fill_tri')
if _fl_af:
    from collections import deque as _deque
    _fills_af = {f for f in _bm_af.faces if f.is_valid and f[_fl_af]}
    _visited_af = set(); _to_del = []
    for _seed in list(_fills_af):
        if _seed in _visited_af: continue
        _comp = []; _q = _deque([_seed])
        while _q:
            _f = _q.popleft()
            if _f in _visited_af or not _f.is_valid: continue
            _visited_af.add(_f); _comp.append(_f)
            for _e in _f.edges:
                for _lf in _e.link_faces:
                    if _lf in _fills_af and _lf not in _visited_af: _q.append(_lf)
        _ctr_z = sum(f.calc_center_median().z for f in _comp) / len(_comp)
        if len(_comp) >= 20 and 1.20 < _ctr_z < 1.55:
            _to_del.extend(_comp)
            print(f'  removing armhole fill island: {len(_comp)} faces at z={_ctr_z:.2f}m', flush=True)
    if _to_del:
        bmesh.ops.delete(_bm_af, geom=_to_del, context='FACES_ONLY')
        _bm_af.to_mesh(ob.data); ob.data.update()
_bm_af.free()

# ── 5. finish ─────────────────────────────────────────────────────────────────
bpy.context.view_layer.objects.active = ob
for p in ob.data.polygons: p.use_smooth = True
OUT = os.path.join(D, 'Male_Tee_Shirt.obj')
S.write_obj(ob, OUT)
print(f'[tee] done → {OUT}')
