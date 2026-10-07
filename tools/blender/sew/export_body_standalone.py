"""
Standalone body exporter (no live.py needed) — imports web/public/body/male.glb directly,
exports the files tee.py needs to ~/.3dg-sew/:
  body_rest.obj / body_rest.json  — default rest-pose body
  body_pose.obj / body_pose.json  — A-pose body (arms lowered 15° more, ~47° total)

Run: blender -b -P tools/blender/sew/export_body_standalone.py -- [male|female] [outdir]
"""
import bpy, json, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SEX  = argv[0] if len(argv) > 0 else 'male'
D    = argv[1] if len(argv) > 1 else os.path.expanduser('~/.3dg-sew')
os.makedirs(D, exist_ok=True)

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
GLB  = os.path.join(REPO, 'web', 'public', 'body', f'{SEX}.glb')
print(f'[export_body] importing {GLB} → {D}')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.gravity = (0, 0, -9.81)

# import the GLB — Blender's GLTF importer converts y-up glTF to z-up Blender space automatically
bpy.ops.import_scene.gltf(filepath=GLB, merge_vertices=False)

# find body mesh: the one with a _PART attribute
body_ob = None
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.data.attributes.get('_PART'):
        body_ob = ob
        break
if body_ob is None:
    raise RuntimeError('body mesh not found in GLB (no _PART attribute)')
print(f'[export_body] body: {body_ob.name}  verts: {len(body_ob.data.vertices)}')

# find armature
rig = body_ob.find_armature()
if rig is None:
    for ob in bpy.data.objects:
        if ob.type == 'ARMATURE':
            rig = ob; break
if rig is None:
    raise RuntimeError('armature not found')
print(f'[export_body] rig: {rig.name}')

me = body_ob.data
mw = body_ob.matrix_world

# ---- rest pose vertices (Blender space, z-up)
# Apply all shape keys at weight 0 (Basis only) = default body
if me.shape_keys:
    for kb in me.shape_keys.key_blocks:
        kb.value = 0.0
    me.update()

# get evaluated mesh (applies armature in rest pose)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = body_ob.evaluated_get(dg)
V_rest = [(mw @ v.co)[:] for v in ev.data.vertices]
F = [list(p.vertices) for p in ev.data.polygons]

# part per vertex (0=skin, 4=fabric, etc.)
part_attr = me.attributes.get('_PART')
part = []
for i in range(len(me.vertices)):
    part.append(int(round(part_attr.data[i].value)) if part_attr else 0)

# dominant bone per vertex
gi = {g.index: g.name for g in body_ob.vertex_groups}
dom, arm_weight = [], []
for v in me.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(gi[best.group] if best else '')
    arm_bones = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
    a = sum(g.weight for g in v.groups if gi.get(g.group, '').split('_')[0] in arm_bones)
    arm_weight.append(a)

# joints (head and tail of each bone, world space → Blender space)
joints = {}
for bn in rig.data.bones:
    joints[bn.name] = [list((mw @ bn.head_local)[:]), list((mw @ bn.tail_local)[:])]

# compute groin landmark (like 0_landmarks.py): lowest z where the body's skin is still one piece
from mathutils.bvhtree import BVHTree
bvh = BVHTree.FromPolygons([Vector(v) for v in V_rest], F)
skin_idx = {i for i, p in enumerate(part) if p == 0}
# scan from z=1.0 down until the body's two halves close together (thighs meet)
groin = None
for zz_int in range(1000, 500, -1):
    zz = zz_int / 1000.0
    # cast a ray from outside on the midline, pointing -y (from front toward back)
    hit = bvh.ray_cast(Vector((0.0, -1.0, zz)), Vector((0, 1, 0)), 2.0)
    if hit[0] is None or hit[0].y > -0.03:
        groin = zz + 0.005
        break
if groin is None:
    # fallback: use the crotch joint if available
    groin = joints.get('pelvis', [[0, 0, 0.9]])[0][2] * 0.85

# bottom of feet
bottom_z = min(v[2] for v in V_rest)

L = dict(top=max(v[2] for v in V_rest), bottom=bottom_z,
         groin=groin, crotch=groin,
         waist=groin + 0.30, hip=groin + 0.20,
         leg=bottom_z + 0.45)
print(f'[export_body] groin={groin:.3f}  bottom={bottom_z:.3f}  top={L["top"]:.3f}')

# write body_rest.obj
with open(os.path.join(D, 'body_rest.obj'), 'w') as f:
    for v in V_rest: f.write('v %.6f %.6f %.6f\n' % v)
    for p in F: f.write('f ' + ' '.join(str(i + 1) for i in p) + '\n')
json.dump(dict(part=part, dom=dom, arm=arm_weight, joints=joints, L=L),
          open(os.path.join(D, 'body_rest.json'), 'w'))
print(f'[export_body] wrote body_rest.obj/json ({len(V_rest)} verts)')

# ---- sewing pose: lower upper arms by LOWER degrees more (A-pose)
LOWER = math.radians(15)  # matches export_body.py's default STATE.get('sew_lower', 15)

# reset to rest pose, then apply the arm rotation
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
for pb in rig.pose.bones:
    pb.matrix_basis = Matrix()
bpy.context.view_layer.update()

for s, sg in (('l', 1), ('r', -1)):
    pb = rig.pose.bones.get(f'upperarm_{s}')
    if pb is None:
        print(f'[export_body] WARNING: upperarm_{s} not found — skipping arm rotation')
        continue
    h = pb.head.copy()
    R = Matrix.Translation(h) @ Matrix.Rotation(sg * LOWER, 4, 'Y') @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()

bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
dg2 = bpy.context.evaluated_depsgraph_get()
ev2 = body_ob.evaluated_get(dg2)
V_pose = [(mw @ v.co)[:] for v in ev2.data.vertices]
print(f'[export_body] A-pose: {len(V_pose)} verts')

# pose_joints (head/tail in the pose, world space)
bpy.ops.object.mode_set(mode='POSE')
pose_joints = {}
for pb in rig.pose.bones:
    pose_joints[pb.name] = [list(pb.head[:]), list(pb.tail[:])]
# deform matrices: pose_bone_world @ bone_rest_world_inv
D_mats = {}
for pb in rig.pose.bones:
    mat = (pb.matrix @ pb.bone.matrix_local.inverted())
    D_mats[pb.name] = [list(r) for r in mat]
# per-vertex skinning weights (up to 4, normalised)
W = []
for v in me.vertices:
    gs = sorted(((gi[g.group], g.weight) for g in v.groups if g.weight > 0 and gi.get(g.group) in D_mats),
                key=lambda t: -t[1])[:4]
    s_ = sum(w for _, w in gs) or 1.0
    W.append([[n, w / s_] for n, w in gs])

bpy.ops.object.mode_set(mode='OBJECT')

with open(os.path.join(D, 'body_pose.obj'), 'w') as f:
    for v in V_pose: f.write('v %.6f %.6f %.6f\n' % v)
    for p in F: f.write('f ' + ' '.join(str(i + 1) for i in p) + '\n')
json.dump(dict(D=D_mats, W=W, joints=pose_joints),
          open(os.path.join(D, 'body_pose.json'), 'w'))
print(f'[export_body] wrote body_pose.obj/json')
print(f'[export_body] done → {D}')
