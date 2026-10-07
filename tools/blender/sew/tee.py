"""
T-shirt: torso + short sleeves built from body cross-sections read directly
from male.glb — the same source the site uses — so Blender shows the tee
on the real mannequin with no intermediate files needed.

  blender -b -P tools/blender/sew/tee.py -- [dir]
Outputs: tee_torso.obj, tee_sleeve_l.obj, tee_sleeve_r.obj in dir.
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
D = argv[0] if argv else os.path.expanduser('~/.3dg-sew')
os.makedirs(D, exist_ok=True)

# ── import male.glb ──────────────────────────────────────────────────────────

REPO = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
GLB = os.path.join(REPO, 'web', 'public', 'body', 'male.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
vl  = bpy.context.view_layer
scn = bpy.context.scene

bpy.ops.import_scene.gltf(filepath=GLB, merge_vertices=False)

# find skin mesh — has _PART attribute
body_ob = None
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.data.attributes.get('_PART'):
        body_ob = ob
        break
if body_ob is None:
    sys.exit('[tee] body mesh not found in GLB (no _PART attribute)')
print(f'[tee] body: {body_ob.name}  verts: {len(body_ob.data.vertices)}')

mw = body_ob.matrix_world

# rest-pose world positions (armature at rest = data vertices)
V_all = [(mw @ v.co)[:] for v in body_ob.data.vertices]

# skin-only vertices (PART == 0)
part_attr = body_ob.data.attributes.get('_PART')
skin_V = []
for i, v in enumerate(body_ob.data.vertices):
    p = int(round(part_attr.data[i].value)) if part_attr else 0
    if p == 0:
        skin_V.append((mw @ v.co)[:])

# joints from the armature (rest pose, world space)
rig = body_ob.find_armature()
if rig is None:
    for ob in bpy.data.objects:
        if ob.type == 'ARMATURE':
            rig = ob; break

joints = {}
if rig:
    rmw = rig.matrix_world
    for bn in rig.data.bones:
        joints[bn.name] = [list((rmw @ bn.head_local)[:]),
                           list((rmw @ bn.tail_local)[:])]

def jv(name):
    j = joints.get(name)
    return (Vector(j[0]), Vector(j[1])) if j else (None, None)

# ── landmarks ────────────────────────────────────────────────────────────────

# try cached body_rest.json first (has groin from BVH ray-cast)
json_path = os.path.join(D, 'body_rest.json')
L_cache = {}
if os.path.exists(json_path):
    try:
        L_cache = json.load(open(json_path)).get('L', {})
    except Exception:
        pass

if L_cache.get('groin'):
    L = L_cache
else:
    # compute groin via ray cast (scan from z=1.0 down until thighs merge)
    F_all = [list(p.vertices) for p in body_ob.data.polygons]
    bvh   = BVHTree.FromPolygons([Vector(v) for v in V_all], F_all)
    groin = None
    for zz_int in range(1000, 500, -1):
        zz  = zz_int / 1000.0
        hit = bvh.ray_cast(Vector((0.0, -1.0, zz)), Vector((0, 1, 0)), 2.0)
        if hit[0] is None or hit[0].y > -0.03:
            groin = zz + 0.005; break
    if groin is None:
        groin = 0.87
    L = dict(top=max(v[2] for v in V_all), hip=groin + 0.20,
             waist=groin + 0.30, groin=groin)
    print(f'[tee] computed groin={groin:.3f}')

z_top      = L.get('top',  1.84)
z_hip      = L.get('hip',  1.06)
z_hem      = z_hip - 0.06         # hem ~6 cm below hip
z_shoulder = z_top - 0.28
z_neck     = z_top - 0.22

uarm_l_head, uarm_l_tail = jv('upperarm_l')
uarm_r_head, uarm_r_tail = jv('upperarm_r')

print(f'[tee] top={z_top:.3f} hip={z_hip:.3f} hem={z_hem:.3f} shoulder={z_shoulder:.3f}')

# ── body cross-section helpers ────────────────────────────────────────────────

TORSO_EASE = 0.025   # 2.5 cm ease per side — normal fit

def body_radius_at(z, half_band=0.03, max_r=0.22):
    """Max torso radius at height z (excludes arms beyond max_r)."""
    band = [v for v in skin_V if abs(v[2] - z) < half_band and abs(v[0]) < max_r]
    if not band:
        return 0.155
    return max(math.sqrt(v[0]**2 + v[1]**2) for v in band)

def arm_radius_at(z, cx, half_band=0.025):
    """Max radius from (cx, 0) in the arm region at height z."""
    band = [v for v in skin_V
            if abs(v[2] - z) < half_band and abs(v[0] - cx) < 0.10]
    if not band:
        return 0.055
    return max(math.sqrt((v[0] - cx)**2 + v[1]**2) for v in band)

def torso_radius_at(z):
    r = body_radius_at(z) + TORSO_EASE
    # taper slightly at the shoulder so the top edge is narrower
    if z > z_shoulder - 0.10:
        t = max(0.0, (z - (z_shoulder - 0.10)) / 0.10)
        t = t * t * (3 - 2 * t)        # smooth-step
        r = r * (1.0 - t * 0.12)
    return max(r, 0.12)

# ── helpers ───────────────────────────────────────────────────────────────────

def apply_subsurf(ob, levels=1):
    """Catmull-Clark subdivision for a smooth surface — use only on closed/interior mesh, not open tubes."""
    vl.objects.active = ob
    ob.select_set(True)
    mod = ob.modifiers.new('Subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)

def smooth_mesh(ob, iters, factor):
    """Laplacian smooth — safe on open-boundary meshes (tubes)."""
    vl.objects.active = ob
    ob.select_set(True)
    mod = ob.modifiers.new('Smooth', 'SMOOTH')
    mod.factor = factor
    mod.iterations = iters
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)

def read_obj_verts(path):
    V = []
    for line in open(path):
        if line.startswith('v '):
            V.append(tuple(map(float, line.split()[1:4])))
    return V

def export_obj(ob, path):
    me  = ob.data
    mwo = ob.matrix_world
    with open(path, 'w') as f:
        f.write(f'o {ob.name}\n')
        for v in me.vertices:
            co = mwo @ v.co
            f.write('v %.6f %.6f %.6f\n' % (co.x, co.y, co.z))
        for p in me.polygons:
            f.write('f ' + ' '.join(str(i + 1) for i in p.vertices) + '\n')
    V_out = read_obj_verts(path)
    if V_out:
        zs = [v[2] for v in V_out]
        print(f'[tee] {os.path.basename(path)}  verts={len(V_out)}'
              f'  z={min(zs):.3f}..{max(zs):.3f}')

# ── torso cylinder ────────────────────────────────────────────────────────────

SEGS  = 32
RINGS = 24

# 1. Sample radii per ring from body cross-sections
ring_z = [z_hem + (ri / RINGS) * (z_shoulder - z_hem) for ri in range(RINGS + 1)]
ring_r = [torso_radius_at(z) for z in ring_z]

# 2. Smooth the radius profile (1D Laplacian) to eliminate per-ring lumps
for _ in range(8):
    for i in range(1, RINGS):
        ring_r[i] = ring_r[i] * 0.5 + (ring_r[i - 1] + ring_r[i + 1]) * 0.25

verts = []
faces = []
for ri, (z, r) in enumerate(zip(ring_z, ring_r)):
    for si in range(SEGS):
        a = 2 * math.pi * si / SEGS
        verts.append((r * math.cos(a), r * math.sin(a), z))

for ri in range(RINGS):
    for si in range(SEGS):
        a  = ri * SEGS + si
        b  = ri * SEGS + (si + 1) % SEGS
        c  = (ri + 1) * SEGS + (si + 1) % SEGS
        d_ = (ri + 1) * SEGS + si
        faces.append((a, b, c, d_))

me_t = bpy.data.meshes.new('tee_torso')
me_t.from_pydata(verts, [], faces)
me_t.update()
ob_torso = bpy.data.objects.new('tee_torso', me_t)
scn.collection.objects.link(ob_torso)

# Catmull-Clark subdivision: produces a smooth surface without per-ring ridges
apply_subsurf(ob_torso, levels=1)

# ── sleeves ───────────────────────────────────────────────────────────────────

SLEEVE_LEN   = 0.16
SLEEVE_SEGS  = 20
SLEEVE_RINGS = 12
SLEEVE_EASE  = 0.018  # 1.8 cm ease over arm

def build_sleeve(name, head, tail):
    if head is None:
        return None
    d = (tail - head).normalized()
    up = Vector((0, 0, 1))
    ri_ax = d.cross(up)
    if ri_ax.length < 0.001:
        ri_ax = d.cross(Vector((1, 0, 0)))
    ri_ax.normalize()
    fwd_ax = d.cross(ri_ax).normalized()

    arm_r_base = arm_radius_at(head.z, head.x) + SLEEVE_EASE

    sv, sf = [], []
    for ring in range(SLEEVE_RINGS + 1):
        t   = ring / SLEEVE_RINGS
        pos = head + d * (-0.01 + t * SLEEVE_LEN)
        r   = arm_r_base + t * (-0.006)   # slight taper toward cuff
        for seg in range(SLEEVE_SEGS):
            a = 2 * math.pi * seg / SLEEVE_SEGS
            sv.append(pos + ri_ax * (r * math.cos(a)) + fwd_ax * (r * math.sin(a)))

    for ring in range(SLEEVE_RINGS):
        for seg in range(SLEEVE_SEGS):
            a  = ring * SLEEVE_SEGS + seg
            b  = ring * SLEEVE_SEGS + (seg + 1) % SLEEVE_SEGS
            c  = (ring + 1) * SLEEVE_SEGS + (seg + 1) % SLEEVE_SEGS
            d_ = (ring + 1) * SLEEVE_SEGS + seg
            sf.append((a, b, c, d_))

    me = bpy.data.meshes.new(name)
    me.from_pydata([v[:] if hasattr(v, '__len__') else v for v in sv], [], sf)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)

    smooth_mesh(ob, iters=4, factor=0.7)
    return ob

ob_sl = build_sleeve('tee_sleeve_l', uarm_l_head, uarm_l_tail)
ob_sr = build_sleeve('tee_sleeve_r', uarm_r_head, uarm_r_tail)

# ── export ────────────────────────────────────────────────────────────────────

export_obj(ob_torso, os.path.join(D, 'tee_torso.obj'))
if ob_sl: export_obj(ob_sl, os.path.join(D, 'tee_sleeve_l.obj'))
if ob_sr: export_obj(ob_sr, os.path.join(D, 'tee_sleeve_r.obj'))
print('[tee] done')
