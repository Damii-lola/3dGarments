# STEP 1, SWEATSHIRT (video 3:50-6:40): torso box, sleeves extruded along the arm to the wrist, mirror, neck hole,
# loop cuts, shrinkwrap 0.026, subdivision, then tight cuffs/hem band/neck rib, loose body and sleeves
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
object_mode()
for o in [o for o in bpy.data.collections['Garments'].objects if o.name.startswith('Sweatshirt')]:
    bpy.data.objects.remove(o)
b = body(); kb = b.data.shape_keys.key_blocks['site_rest']; part = b.data.attributes['_PART'].data
P = [kb.data[i].co for i in range(len(kb.data))]; skin = [i for i in range(len(P)) if part[i].value < 0.5]
r = bpy.data.objects['rig_male'].data.bones
S, E, W = r['upperarm_l'].head_local.copy(), r['lowerarm_l'].head_local.copy(), r['hand_l'].head_local.copy()
L = STATE['L']
hem = L['hip'][0] - 0.03                     # the sweatshirt's rib band sits at the hip
top = 1.565; armpit = S.z - 0.115; xn = 0.03
chest = [P[i] for i in skin if abs(P[i].z - (armpit - 0.03)) < 0.012 and abs(P[i].x) < 0.2]
Wt = max(p.x for p in chest) + 0.02
Y0, Y1 = min(p.y for p in chest) - 0.03, max(p.y for p in chest) + 0.03
bm = bmesh.new()
cols, rows, ys = [0.0, xn, Wt], [hem, armpit, top], [Y0, Y1]
g = {(zi, xi, yi): bm.verts.new((x, y, z)) for zi, z in enumerate(rows) for xi, x in enumerate(cols) for yi, y in enumerate(ys)}
F = lambda *v: bm.faces.new(v)
for zi in range(2):
    for xi in range(2):
        F(g[zi, xi, 0], g[zi, xi + 1, 0], g[zi + 1, xi + 1, 0], g[zi + 1, xi, 0])     # front
        F(g[zi, xi + 1, 1], g[zi, xi, 1], g[zi + 1, xi, 1], g[zi + 1, xi + 1, 1])     # back
F(g[0, 2, 0], g[0, 2, 1], g[1, 2, 1], g[1, 2, 0])                                    # side under the arm
F(g[2, 1, 0], g[2, 2, 0], g[2, 2, 1], g[2, 1, 1])                                    # shoulder top (x 0..xn = neck hole)
root = F(g[1, 2, 0], g[1, 2, 1], g[2, 2, 1], g[2, 2, 0])                             # the sleeve's root
# EXTRUDE the sleeve along the arm, a ring every ~8 cm, sized to the arm (+ room)
def arm_r(c, d):
    near = [P[i] for i in skin if abs((P[i] - c).dot(d)) < 0.015 and (P[i] - c).length < 0.12]
    if not near: return 0.045
    return max(((p - c) - d * (p - c).dot(d)).length for p in near)
cur = root
path = [(S + (E - S) * t) for t in (0.15, 0.4, 0.7, 1.0)] + [(E + (W - E) * t) for t in (0.3, 0.6, 0.92)]
for k, c in enumerate(path):
    d = ((E - S) if k < 4 else (W - E)).normalized()
    up = Vector((0, 0, 1)); u = (up - d * up.dot(d)).normalized(); v = d.cross(u)
    rad = arm_r(c, d) + 0.02
    ex = bmesh.ops.extrude_face_region(bm, geom=[cur])
    nv = [e for e in ex['geom'] if isinstance(e, bmesh.types.BMVert)]
    nf = [e for e in ex['geom'] if isinstance(e, bmesh.types.BMFace)][0]
    bmesh.ops.delete(bm, geom=[cur], context='FACES_ONLY')
    for vv in nv:              # corners: up/down (z) × front/back (y) of the old root
        su = 1 if vv.co.z > (armpit + top) / 2 or (k > 0 and (vv.co - c).dot(u) > 0) else -1
        sv = 1 if vv.co.y > (Y0 + Y1) / 2 else -1
        vv.co = c + u * rad * su + v * rad * sv * (1 if v.y > 0 else -1)
    cur = nf
bmesh.ops.delete(bm, geom=[cur], context='FACES_ONLY')        # open cuff
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)    # LOOP CUTS
me = bpy.data.meshes.new('Sweatshirt'); bm.to_mesh(me); bm.free()
ob = new_garment('Sweatshirt', me, color=(0.85, 0.55, 0.25)); ob.color = (0.85, 0.55, 0.25, 1)
m = ob.modifiers.new('Mirror', 'MIRROR'); m.use_clip = True; m.use_mirror_merge = True; m.merge_threshold = 0.001
sw = ob.modifiers.new('Shrinkwrap', 'SHRINKWRAP'); sw.wrap_method = 'NEAREST_SURFACEPOINT'; sw.wrap_mode = 'ON_SURFACE'; sw.target = b; sw.offset = 0.026
sd = ob.modifiers.new('Subdivision', 'SUBSURF'); sd.levels = 1; sd.render_levels = 2
win, area, region = view3d()
with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
    for x in bpy.context.view_layer.objects: x.select_set(x == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier='Mirror'); bpy.ops.object.modifier_apply(modifier='Shrinkwrap'); bpy.ops.object.modifier_apply(modifier='Subdivision')
# CREW NECKLINE (the video: inset the neck, then shape it round): cut away the faces above a crew line around the
# neck — 6 cm low at the front, ~1 cm at the back — and put the new edge exactly on that line
import math
nb = 1.545
ring = [P[i] for i in skin if abs(P[i].z - nb) < 0.01 and abs(P[i].x) < 0.09]
ncy = (min(p.y for p in ring) + max(p.y for p in ring)) / 2
nrx = max(p.x for p in ring) + 0.014
nryf = ncy - min(p.y for p in ring) + 0.014; nryb = max(p.y for p in ring) - ncy + 0.014
def crew(th):
    c = math.cos(th)
    ry = nryf if c > 0 else nryb
    z = nb + 0.008 * (1 - abs(c)) - 0.062 * max(0.0, c) ** 1.6 - 0.01 * max(0.0, -c) ** 2
    return Vector((math.sin(th) * nrx, ncy - c * ry, z))
def above(p):
    th = math.atan2(p.x, -(p.y - ncy))
    q = crew(th)
    r = math.hypot(p.x / nrx, (p.y - ncy) / (nryf if p.y < ncy else nryb))
    return p.z > q.z and r < 1.6
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if above(f.calc_center_median())], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
edge = [v for v in bm.verts if v.is_boundary and v.co.z > 1.42 and abs(v.co.x) < 0.2]
for v in edge:
    v.co = crew(math.atan2(v.co.x, -(v.co.y - ncy)))
for it in range(3):                          # even out the ring just under the new edge
    bmesh.ops.smooth_vert(bm, verts=list({e.other_vert(v) for v in edge for e in v.link_edges if not e.other_vert(v).is_boundary}), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(ob.data); bm.free()
STATE['crew'] = dict(nb=nb, ncy=ncy)
STATE['shirt'] = dict(hem=hem, S=tuple(S), E=tuple(E), W=tuple(W))
print('sweatshirt blockout', len(ob.data.vertices), 'verts; hem', round(hem, 3), 'chest half width', round(Wt, 3))
look((0, 0, 1.2), (0.6, -1, 0.25), 2.4)
