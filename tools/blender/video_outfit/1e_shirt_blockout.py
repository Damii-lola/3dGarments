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
# base of the neck and put the new edge exactly on that line. MEASURED: the neck's own column (above the trapezius
# slope, ±6.6 cm wide) gives the centre and width; the line sits at the base of the neck, lowest at the front (the
# notch between the collarbones), highest at the back (the nape), and lies on the skin + 6 mm (the rib's offset)
import math
from mathutils.bvhtree import BVHTree
EDG = [(e.vertices[0], e.vertices[1]) for e in b.data.edges]
def body_slice(z, xmax):
    out = []
    for i, j in EDG:
        a_, c_ = P[i], P[j]
        if (a_.z - z) * (c_.z - z) <= 0 and a_.z != c_.z:
            t = (z - a_.z) / (c_.z - a_.z); x = a_.x + (c_.x - a_.x) * t
            if abs(x) < xmax: out.append((x, a_.y + (c_.y - a_.y) * t))
    return out
col = body_slice(1.60, 0.12)                        # the neck column, clear of the trapezius
ncy = (min(p[1] for p in col) + max(p[1] for p in col)) / 2
nb = 1.585                                          # side height: where the neck meets the trapezius
ZF, ZB = 1.515, 1.600                               # front (collarbone notch) and back (nape)
rest_bvh = BVHTree.FromPolygons(P, [list(f.vertices) for f in b.data.polygons])
def crew_z(th):
    c = math.cos(th)
    return nb - (nb - ZF) * max(0.0, c) ** 0.9 + (ZB - nb) * max(0.0, -c) ** 2   # round at the front (a crew, not a V)
def crew(th):
    """the point of the neckline at angle th (0 = front) around the neck's axis: on the skin + 6 mm"""
    z = crew_z(th); d = Vector((math.sin(th), -math.cos(th), 0.0))
    o = Vector((0.0, ncy, z))
    # from the neck's axis outwards, the LAST time the ray leaves the body within 10 cm: the outer skin (the mannequin's
    # head shell dips inside the neck at the back, and its surface comes first)
    last, s_ = None, 0.0
    while s_ < 0.10:
        hit = rest_bvh.ray_cast(o + d * (s_ + 1e-4), d, 0.10 - s_)
        if hit[0] is None: break
        r_ = (hit[0] - o).length
        if hit[1].dot(d) > 0: last = hit[0]
        s_ = r_ + 1e-4
    if last is None: return o + d * 0.07
    return last + d * 0.007
def angle(p): return math.atan2(p.x, -(p.y - ncy))
# seen from the front a crew neck is a U: an ellipse through the side points (half width XS at height nb) down to ZF
XS = max(abs(crew(a_).x) for a_ in (1.45, 1.57, 1.69))
def ell_z(x, front):
    u = min(1.0, abs(x) / XS); k = (1 - u ** 3) ** (1 / 3)      # superellipse: flat-bottomed U
    return nb - (nb - ZF) * k if front else nb + (ZB - nb) * k
def above(p):
    return abs(p.x) < 0.2 and p.z > crew_z(angle(p)) - 0.004 and p.z > 1.45
bm = bmesh.new(); bm.from_mesh(ob.data)
# CUT EXACTLY ALONG THE CURVE (deleting whole faces left a stair-step edge whose neighbours folded into notches): split
# every edge the crew line crosses at the crossing, join the new points across each face, then drop what's above
def f_(p): return (p.z - ell_z(p.x, p.y < ncy)) if (abs(p.x) < XS + 0.03 and p.z > 1.45) else -1.0
cross = [e for e in bm.edges if f_(e.verts[0].co) * f_(e.verts[1].co) < 0]
newv = []
for e in cross:
    a_, c_ = e.verts
    fa, fc = f_(a_.co), f_(c_.co)
    t = fa / (fa - fc)
    ne, nv = bmesh.utils.edge_split(e, a_, t)
    newv.append(nv)
# snap near-zero vertices onto the line as well (an existing vertex already on it)
nset = set(newv)
for f in list(bm.faces):
    on = [v for v in f.verts if v in nset]
    if len(on) == 2:
        bmesh.ops.connect_verts(bm, verts=on)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f_(f.calc_center_median()) > 0], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
# tiny slivers next to the cut: merge points closer than 4 mm along the new edge
bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.is_boundary and v.co.z > 1.45], dist=0.004)
# the new edge: walk its loop in order and spread its vertices EVENLY along the crew line (snapping each vertex by its
# own angle bunched them into corners)
edge = [v for v in bm.verts if v.is_boundary and v.co.z > 1.42 and abs(v.co.x) < 0.2]
eset = set(edge); loop = [min(edge, key=lambda v: abs(angle(v.co)))]
while True:
    nxt = [e.other_vert(loop[-1]) for e in loop[-1].link_edges if e.is_boundary and e.other_vert(loop[-1]) in eset]
    nxt = [v for v in nxt if v not in loop]
    if not nxt: break
    loop.append(nxt[0] if len(loop) > 1 or angle(nxt[0].co) > 0 or len(nxt) == 1 else nxt[-1])
# loop direction: make the angle increase
if len(loop) > 2 and math.sin(angle(loop[1].co) - angle(loop[0].co)) < 0: loop = [loop[0]] + loop[1:][::-1]
n = len(loop)
# the skin under it is lumpy (trapezius, nape): smooth the edge's distance from the neck's axis along the loop, but
# never inside skin + 6 mm (smoothing the points themselves pulled the tight curve at the nape into the body)
ths = [2 * math.pi * k / n for k in range(n)]
def radial(th):
    p_ = crew(th); return math.hypot(p_.x, p_.y - ncy)
need = [radial(t) for t in ths]
rad = list(need)
for it in range(6):
    rad = [max(need[k], (rad[k - 2] + rad[k - 1] * 2 + rad[k] * 3 + rad[(k + 1) % n] * 2 + rad[(k + 2) % n]) / 9) for k in range(n)]
for v, th, r_ in zip(loop, ths, rad):
    x_ = math.sin(th) * r_
    v.co = Vector((x_, ncy - math.cos(th) * r_, ell_z(x_, math.cos(th) > 0)))
for it in range(4):                          # even out the rings just under the new edge
    ring = list({e.other_vert(v) for v in loop for e in v.link_edges if not e.other_vert(v).is_boundary})
    bmesh.ops.smooth_vert(bm, verts=ring, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(ob.data); bm.free()
print('neckline:', n, 'edge vertices, half width', round(max(abs(crew(t).x) for t in (1.3, 1.57, 1.8)), 3))
STATE['crew'] = dict(nb=nb, ncy=ncy)
STATE['shirt'] = dict(hem=hem, S=tuple(S), E=tuple(E), W=tuple(W))
print('sweatshirt blockout', len(ob.data.vertices), 'verts; hem', round(hem, 3), 'chest half width', round(Wt, 3))
look((0, 0, 1.2), (0.6, -1, 0.25), 2.4)
