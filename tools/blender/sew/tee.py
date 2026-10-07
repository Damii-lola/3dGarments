"""
T-shirt: torso cylinder + two sleeve cylinders, all shrinkwrapped to body.
No seams, no pattern panels — clean single-mesh pieces.

  blender -b -P tools/blender/sew/tee.py -- [dir]
  dir: directory with body_rest.obj/.json (default ~/.3dg-sew)
Outputs: tee_torso.obj, tee_sleeve_l.obj, tee_sleeve_r.obj in the same dir.
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
D = argv[0] if argv else os.path.expanduser('~/.3dg-sew')

# ── body measurements ─────────────────────────────────────────────────────────

def read_obj_verts(path):
    V = []
    for line in open(path):
        if line.startswith('v '):
            V.append(tuple(map(float, line.split()[1:4])))
    return V

def torso_radius(V, z_lo, z_hi, max_x=0.20):
    band = [v for v in V if z_lo <= v[2] <= z_hi and abs(v[0]) < max_x]
    if not band:
        return 0.15
    return max(math.sqrt(v[0]**2 + v[1]**2) for v in band)

rest_path = os.path.join(D, 'body_rest.obj')
json_path  = os.path.join(D, 'body_rest.json')
if not os.path.exists(rest_path):
    sys.exit(f'body_rest.obj not found at {D}')

data = json.load(open(json_path)) if os.path.exists(json_path) else {}
L      = data.get('L', {})
joints = data.get('joints', {})

V      = read_obj_verts(rest_path)
z_top  = L.get('top', max(v[2] for v in V))
z_hip  = L.get('hip', z_top - 0.78)

z_hem      = z_hip - 0.05
z_shoulder = z_top - 0.28
z_chest    = z_top - 0.35
z_neck     = z_top - 0.22

r_chest = torso_radius(V, z_chest - 0.04, z_chest + 0.04)
r_neck  = max(torso_radius(V, z_neck - 0.02, z_neck + 0.02, max_x=0.12), 0.07)

# arm joint positions (x, y, z in Blender Z-up space)
def jv(name):
    j = joints.get(name)
    return (Vector(j[0]), Vector(j[1])) if j else (None, None)

uarm_l_head, uarm_l_tail = jv('upperarm_l')
uarm_r_head, uarm_r_tail = jv('upperarm_r')

print(f'[tee] top={z_top:.3f} hip={z_hip:.3f} hem={z_hem:.3f} shoulder={z_shoulder:.3f}')
print(f'[tee] r_chest={r_chest:.3f}  r_neck={r_neck:.3f}')

# ── scene + body import ───────────────────────────────────────────────────────

bpy.ops.wm.read_factory_settings(use_empty=True)
vl  = bpy.context.view_layer
scn = bpy.context.scene

try:
    bpy.ops.wm.obj_import(filepath=rest_path, forward_axis='NEGATIVE_Y', up_axis='Z')
except TypeError:
    bpy.ops.wm.obj_import(filepath=rest_path)
body_ob = bpy.context.selected_objects[0]
body_ob.name = 'body'
body_ob.select_set(False)

# ── cylinder builder ──────────────────────────────────────────────────────────

def build_cylinder(center, direction, r_start, r_end, length, segs, rings):
    """Open cylinder from center along direction."""
    d = direction.normalized()
    up = Vector((0, 0, 1))
    ri = d.cross(up)
    if ri.length < 0.001:
        ri = d.cross(Vector((1, 0, 0)))
    ri.normalize()
    fwd = d.cross(ri).normalized()

    verts, faces = [], []
    for ring in range(rings + 1):
        t = ring / rings
        pos = center + d * (t * length)
        r   = r_start + t * (r_end - r_start)
        for seg in range(segs):
            a = 2 * math.pi * seg / segs
            verts.append(pos + ri * (r * math.cos(a)) + fwd * (r * math.sin(a)))
    for ring in range(rings):
        for seg in range(segs):
            a = ring * segs + seg
            b = ring * segs + (seg + 1) % segs
            c = (ring + 1) * segs + (seg + 1) % segs
            d_ = (ring + 1) * segs + seg
            faces.append((a, b, c, d_))
    return verts, faces

def make_mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([v[:] if hasattr(v, '__len__') else v for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    return ob

def apply_shrinkwrap_and_smooth(ob, target, offset, smooth_iters=5, smooth_factor=0.5):
    vl.objects.active = ob
    ob.select_set(True)
    sw = ob.modifiers.new('sw', 'SHRINKWRAP')
    sw.target    = target
    sw.offset    = offset
    sw.wrap_mode = 'ON_SURFACE'
    bpy.ops.object.modifier_apply(modifier='sw')

    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(ob.data)
    for _ in range(smooth_iters):
        for v in bm.verts:
            nbrs = [e.other_vert(v) for e in v.link_edges]
            if nbrs:
                avg = sum((n.co for n in nbrs), Vector()) / len(nbrs)
                v.co = v.co.lerp(avg, smooth_factor)
    bmesh.update_edit_mesh(ob.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    # second tighter pass
    sw2 = ob.modifiers.new('sw2', 'SHRINKWRAP')
    sw2.target    = target
    sw2.offset    = offset * 0.7
    sw2.wrap_mode = 'ON_SURFACE'
    bpy.ops.object.modifier_apply(modifier='sw2')

    bpy.ops.object.mode_set(mode='EDIT')
    bm2 = bmesh.from_edit_mesh(ob.data)
    for _ in range(3):
        for v in bm2.verts:
            nbrs = [e.other_vert(v) for e in v.link_edges]
            if nbrs:
                avg = sum((n.co for n in nbrs), Vector()) / len(nbrs)
                v.co = v.co.lerp(avg, 0.3)
    bmesh.update_edit_mesh(ob.data)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)

def export_obj(ob, path):
    """Write raw Blender coords — same convention as body_rest.obj (no axis conversion)."""
    me = ob.data
    with open(path, 'w') as f:
        f.write(f'o {ob.name}\n')
        mw = ob.matrix_world
        for v in me.vertices:
            co = mw @ v.co
            f.write('v %.6f %.6f %.6f\n' % (co.x, co.y, co.z))
        for p in me.polygons:
            f.write('f ' + ' '.join(str(i + 1) for i in p.vertices) + '\n')
    V_out = read_obj_verts(path)
    if V_out:
        zs = [v[2] for v in V_out]
        print(f'[tee] {os.path.basename(path)}  verts={len(V_out)}  z={min(zs):.3f}..{max(zs):.3f}')

# ── torso ─────────────────────────────────────────────────────────────────────

SEGS  = 32
RINGS = 24

r_ease = r_chest + 0.045
r_top  = r_neck  + 0.015

# Build as a vertical cylinder (direction = +z)
torso_verts, torso_faces = build_cylinder(
    center=Vector((0, 0, z_hem)),
    direction=Vector((0, 0, 1)),
    r_start=r_ease, r_end=r_top,
    length=z_shoulder - z_hem,
    segs=SEGS, rings=RINGS,
)
ob_torso = make_mesh_object('tee_torso', torso_verts, torso_faces)

# subdivide once
vl.objects.active = ob_torso
ob_torso.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.subdivide(number_cuts=1)
bpy.ops.object.mode_set(mode='OBJECT')

apply_shrinkwrap_and_smooth(ob_torso, body_ob, offset=0.012)

# ── sleeves ───────────────────────────────────────────────────────────────────

SLEEVE_LEN  = 0.16   # short sleeve covering ~half of upper arm
SLEEVE_SEGS = 20
SLEEVE_RINGS = 10
r_arm = 0.065        # sleeve inner radius (biceps + ease)

def make_sleeve(name, head, tail, side):
    if head is None:
        return None
    direction = (tail - head).normalized()
    # start slightly inside the torso from the shoulder joint
    start = head + direction * (-0.02)
    verts, faces = build_cylinder(
        center=start,
        direction=direction,
        r_start=r_arm + 0.01, r_end=r_arm,
        length=SLEEVE_LEN,
        segs=SLEEVE_SEGS, rings=SLEEVE_RINGS,
    )
    ob = make_mesh_object(name, verts, faces)
    vl.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.subdivide(number_cuts=1)
    bpy.ops.object.mode_set(mode='OBJECT')
    apply_shrinkwrap_and_smooth(ob, body_ob, offset=0.014)
    return ob

ob_sl = make_sleeve('tee_sleeve_l', uarm_l_head, uarm_l_tail,  1)
ob_sr = make_sleeve('tee_sleeve_r', uarm_r_head, uarm_r_tail, -1)

# ── export ────────────────────────────────────────────────────────────────────

export_obj(ob_torso, os.path.join(D, 'tee_torso.obj'))
if ob_sl: export_obj(ob_sl, os.path.join(D, 'tee_sleeve_l.obj'))
if ob_sr: export_obj(ob_sr, os.path.join(D, 'tee_sleeve_r.obj'))
print('[tee] done')
