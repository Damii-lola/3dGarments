# (live session) the body as the site has it in the rest pose (every slider) → OBJ + joints, for the headless sewing
# scripts. Blender coordinates (z up, the body faces −y), metres. Out: <dir>/body_rest.obj, <dir>/body_rest.json
import json, os
OUTDIR = STATE.get('sew_dir') or os.path.expanduser('~/.3dg-sew'); os.makedirs(OUTDIR, exist_ok=True)
b = body(); me = b.data; kb = me.shape_keys.key_blocks['site_rest']
part = me.attributes['_PART'].data
rig = [m.object for m in b.modifiers if m.type == 'ARMATURE'][0]
with open(os.path.join(OUTDIR, 'body_rest.obj'), 'w') as f:
    for i, k in enumerate(kb.data): f.write('v %.6f %.6f %.6f\n' % tuple(k.co))
    for p in me.polygons: f.write('f ' + ' '.join(str(v + 1) for v in p.vertices) + '\n')
# per vertex: its part (0 skin, 4 fabric) and its strongest bone (the torso's outline excludes the arms)
gi = {g.index: g.name for g in b.vertex_groups}
dom = []
for v in me.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(gi[best.group] if best else '')
arm = [sum(g.weight for g in v.groups if gi[g.group].split('_')[0] in ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')) for v in me.vertices]
joints = {bn.name: [list(bn.head_local), list(bn.tail_local)] for bn in rig.data.bones}
json.dump(dict(part=[int(round(part[i].value)) for i in range(len(part))], dom=dom, arm=arm, joints=joints,
               L=STATE.get('L', {})), open(os.path.join(OUTDIR, 'body_rest.json'), 'w'))
print('exported', len(kb.data), 'verts to', OUTDIR)

# ---- the SEWING POSE: arms lowered to ~45° (an A-pose: a sleeve sewn with the arm out stands out stiffly once the arm
# hangs). Exported as body_pose.obj + per-bone deform matrices and per-vertex weights, so a garment draped on it can be
# taken back to the rest pose (inverse skinning) for the site's rig
import math
from mathutils import Matrix
LOWER = math.radians(STATE.get('sew_lower', 15))
arm_mod = [m for m in b.modifiers if m.type == 'ARMATURE'][0]
was = arm_mod.show_viewport
for k in me.shape_keys.key_blocks: k.value = 1.0 if k.name == 'site_rest' else 0.0
saved = {pb.name: pb.matrix_basis.copy() for pb in rig.pose.bones}
for pb in rig.pose.bones: pb.matrix_basis = Matrix()
bpy.context.view_layer.update()
for s, sg in (('l', 1), ('r', -1)):
    pb = rig.pose.bones[f'upperarm_{s}']
    h = pb.head.copy()
    R = Matrix.Translation(h) @ Matrix.Rotation(sg * LOWER, 4, 'Y') @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()
arm_mod.show_viewport = True
dg = bpy.context.evaluated_depsgraph_get(); ev = b.evaluated_get(dg)
with open(os.path.join(OUTDIR, 'body_pose.obj'), 'w') as f:
    for v in ev.data.vertices: f.write('v %.6f %.6f %.6f\n' % tuple(v.co))
    for p in me.polygons: f.write('f ' + ' '.join(str(v + 1) for v in p.vertices) + '\n')
D = {pb.name: [list(r) for r in (pb.matrix @ pb.bone.matrix_local.inverted())] for pb in rig.pose.bones}
W = []
for v in me.vertices:
    gs = sorted(((gi[g.group], g.weight) for g in v.groups if g.weight > 0 and gi[g.group] in D), key=lambda t: -t[1])[:4]
    s_ = sum(w for _, w in gs) or 1
    W.append([[n, w / s_] for n, w in gs])
pose_joints = {pb.name: [list(pb.head), list(pb.tail)] for pb in rig.pose.bones}
json.dump(dict(D=D, W=W, joints=pose_joints), open(os.path.join(OUTDIR, 'body_pose.json'), 'w'))
for pb in rig.pose.bones: pb.matrix_basis = saved[pb.name]
arm_mod.show_viewport = was
bpy.context.view_layer.update()
print('sewing pose exported: arms lowered', round(math.degrees(LOWER)), '°')
