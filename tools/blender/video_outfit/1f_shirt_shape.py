# the video 5:00-6:40 edit: cuff + hem rib band + neck rib tight; body blousing, sleeves loose (bunching low)
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ob = bpy.data.objects['Sweatshirt']; b = body()
bvh = BVHTree.FromObject(b, bpy.context.evaluated_depsgraph_get())
sh = STATE['shirt']; S, E, W = Vector(sh['S']), Vector(sh['E']), Vector(sh['W']); hem = sh['hem']
def sm(a, c, x):
    t = max(0.0, min(1.0, (x - a) / (c - a))); return t * t * (3 - 2 * t)
def arm_t(p):                     # how far along the arm (m from the shoulder joint), the side it is on
    q = Vector((abs(p.x), p.y, p.z))
    if q.x < abs(S.x) - 0.02: return -1.0    # inside the shoulder line: torso (the arm's axis slopes, and the hem
                                             # far below it projected onto the sleeve)
    up = (E - S).length; d1 = (E - S).normalized()
    t = (q - S).dot(d1)
    if t > up: t = up + (q - E).dot((W - E).normalized())
    return t
sleeve_len = (E - S).length + (W - E).length * 0.92
# the neck rib: tight only along the neckline (6 mm), easing out to the body's ease 2-6 cm below it (a 6 mm zone over
# the whole upper back let the trapezius poke through)
import bmesh as _bm
from mathutils.kdtree import KDTree
_b = _bm.new(); _b.from_mesh(ob.data)
neck = [v.co.copy() for v in _b.verts if v.is_boundary and v.co.z > 1.42 and abs(v.co.x) < 0.2]
_b.free()
kd = KDTree(len(neck))
for i, c in enumerate(neck): kd.insert(c, i)
kd.balance()
def offset(p):
    t = arm_t(p)
    if t <= 0.03 and p.z > hem + 0.06:
        dn = kd.find(p)[2]
        return 0.007 + (body_offset(p) - 0.007) * sm(0.02, 0.06, dn)
    return body_offset(p)
def body_offset(p):
    t = arm_t(p)
    if t > 0.03:                                             # sleeve
        if t > sleeve_len - 0.06: return 0.008               # rib cuff
        return 0.022 + 0.016 * sm(sleeve_len - 0.35, sleeve_len - 0.12, t)   # roomier low on the forearm (bunch)
    # the rib band (10 mm) and the body blousing softly over it: real sweatshirts gather into the band over ~15 cm,
    # they don't stand out as a shelf
    band = sm(hem + 0.05, hem + 0.085, p.z)
    blouse = sm(hem + 0.06, hem + 0.20, p.z) * (1 - sm(1.25, 1.45, p.z))
    return 0.010 + band * (0.008 + 0.014 * blouse)
me = ob.data
for v in me.vertices:
    hit = bvh.find_nearest(v.co)
    if hit[0] is None: continue
    d = v.co - hit[0]; n = d.normalized() if d.length > 1e-4 and d.dot(hit[1]) > 0 else hit[1]
    v.co = hit[0] + n * offset(v.co)
bm = bmesh.new(); bm.from_mesh(me)
inner = [v for v in bm.verts if not v.is_boundary]      # the edges (neckline, cuffs, hem) stay where they are
for it in range(8):
    bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in inner:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None: continue
        need = offset(v.co) * (1.0 if kd.find(v.co)[2] < 0.06 else 0.85)   # full offset by the neckline
        if (v.co - hit[0]).dot(hit[1]) < need: v.co = hit[0] + hit[1] * need
# THE HEM BAND IS A TUBE: per 1 cm slice the torso's convex outline (radius by angle around its centre) + the offset —
# it spans the groin and belly instead of riding over them (bumps at the centre front); blended into the shaped body
# 25 cm up
import math
kb = b.data.shape_keys.key_blocks['site_rest']
RC = [kb.data[i].co for i in range(len(kb.data))]
EDG = [(e.vertices[0], e.vertices[1]) for e in b.data.edges]
def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0: h.pop()
            h.append(q)
        return h
    lo, hi = half(pts), half(list(reversed(pts))); return lo[:-1] + hi[:-1]
def ray(poly, cx, cy, a):
    dx, dy = math.cos(a), math.sin(a); best = 0.0
    for k in range(len(poly)):
        (x1, y1), (x2, y2) = poly[k], poly[(k + 1) % len(poly)]
        ex, ey = x2 - x1, y2 - y1; den = dx * ey - dy * ex
        if abs(den) < 1e-12: continue
        t = ((x1 - cx) * ey - (y1 - cy) * ex) / den; u = ((x1 - cx) * dy - (y1 - cy) * dx) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9: best = max(best, t)
    return best
HS = {}
def torso_hull(z):
    k = round(z / 0.01)
    if k not in HS:
        zz = k * 0.01; pts = []
        for i, j in EDG:
            a_, c_ = RC[i], RC[j]
            if (a_.z - zz) * (c_.z - zz) <= 0 and a_.z != c_.z:
                t = (zz - a_.z) / (c_.z - a_.z); x = a_.x + (c_.x - a_.x) * t
                if abs(x) < 0.3: pts.append((x, a_.y + (c_.y - a_.y) * t))
        hp = hull(pts); HS[k] = (hp, sum(p[0] for p in hp) / len(hp), sum(p[1] for p in hp) / len(hp))
    return HS[k]
# the outline is smoothed over ±3 cm (upper envelope) so the band doesn't copy the hips' bumps either
def tube_point(v):
    best = None
    for dz in (-0.03, -0.02, -0.01, 0.0, 0.01, 0.02, 0.03):
        hp, cx, cy = torso_hull(v.co.z + dz)
        a = math.atan2(v.co.y - cy, v.co.x - cx); r = ray(hp, cx, cy, a)
        if best is None or r > best[0]: best = (r, cx, cy, a)
    r, cx, cy, a = best; r += offset(v.co)
    return Vector((cx + r * math.cos(a), cy + r * math.sin(a), v.co.z))
# a real hem is level: the edge (and the row above it, eased) at one height
hv = [v for v in bm.verts if v.is_boundary and v.co.z < hem + 0.05 and arm_t(v.co) <= 0.03]
hz = sorted(v.co.z for v in hv)[len(hv) // 2]
for v in hv: v.co.z = hz
for v in {e.other_vert(v) for v in hv for e in v.link_edges if not e.other_vert(v).is_boundary}:
    v.co.z = (v.co.z + hz + 0.012) / 2 if v.co.z < hz + 0.03 else v.co.z
for v in bm.verts:
    if arm_t(v.co) > 0.03 or v.co.z > hem + 0.25: continue
    w = 1 - sm(hem + 0.08, hem + 0.25, v.co.z)
    v.co = v.co.lerp(tube_point(v), w)
# LAYERING: the sweatshirt goes OVER the trousers — where they overlap, at least 6 mm outside the pants' surface (both
# were fitted to the body alone, and the waistband poked through the band as a ragged edge)
pants = bpy.data.objects.get('Pants')
if pants:
    pb = BVHTree.FromObject(pants, bpy.context.evaluated_depsgraph_get())
    ptop = max((pants.matrix_world @ v.co).z for v in pants.data.vertices)
    for v in bm.verts:
        if v.co.z > ptop + 0.03 or arm_t(v.co) > 0.03: continue
        hit = pb.find_nearest(v.co)
        if hit[0] is None: continue
        dd = (v.co - hit[0]).dot(hit[1])
        if dd < 0.006: v.co = hit[0] + hit[1] * 0.006
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
me.update()
print('sweatshirt shaped')
look((0, 0, 1.15), (0.6, -1, 0.2), 2.4)
