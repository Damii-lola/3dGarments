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
