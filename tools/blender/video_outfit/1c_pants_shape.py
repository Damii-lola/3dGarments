# the video 2:15-3:15: waistband + cuffs tight, legs scaled out loose (joggers), nothing of the body poking through
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ob = bpy.data.objects['Pants']; b = body()
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(b, dg)
L = STATE['L']; ankle = L['bottom'] + 0.075; crotch = L['groin']   # the real crotch (see 0_landmarks)
top = max(v.co.z for v in ob.data.vertices)
def sm(a, c, x):
    t = max(0.0, min(1.0, (x - a) / (c - a))); return t * t * (3 - 2 * t)
def offset(z):
    if z > top - 0.05: return 0.008                                # waistband
    if z < ankle + 0.06: return 0.009                              # rib cuff
    hip = 0.016
    leg = 0.028 + 0.012 * sm(ankle + 0.3, ankle + 0.1, z)          # looser low on the shin (where it will bunch)
    w = sm(crotch + 0.08, crotch - 0.22, z)                        # hip → leg, gradual (no line across the thigh)
    band = sm(top - 0.05, top - 0.09, z) * sm(ankle + 0.06, ankle + 0.1, z)
    return 0.008 + (hip * (1 - w) + leg * w - 0.008) * band
me = ob.data
co = [v.co.copy() for v in me.vertices]
seam = {i for i, c in enumerate(co) if abs(c.x) < 1e-4}          # the mirror plane: these stay at x = 0
for i, v in enumerate(me.vertices):
    hit = bvh.find_nearest(co[i])
    if hit[0] is None: continue
    loc, nrm = hit[0], hit[1]
    # outward = from the body surface; where the blockout already sits further out, keep its direction
    d = co[i] - loc
    n = d.normalized() if d.length > 1e-4 and d.dot(nrm) > 0 else nrm
    v.co = loc + n * offset(co[i].z)
    if i in seam: v.co.x = 0.0
# relax: smooth the offset shell (the video's mesh is smooth after the subdivision), then push back out of the body
bm = bmesh.new(); bm.from_mesh(me)
# all three axes (z too: else the knee's and shin's bony dents stay as horizontal creases), the waist and ankle
# edges stay where they are; only a minimum distance is enforced, so the fabric bridges the body's hollows
inner = [v for v in bm.verts if not (v.is_boundary and v.index not in seam)]
# the waist edge's corners on the centre seam (front and back) stay put: smoothed, they have neighbours only below them
# and sink (a V notch at the centre of the waistband)
corner = {v for v in bm.verts if v.index in seam and v.co.z > crotch + 0.2
          and any(e.is_boundary and abs((e.other_vert(v).co - v.co).x) > abs((e.other_vert(v).co - v.co).z) for e in v.link_edges)}
inner = [v for v in inner if v not in corner]
for it in range(24):
    bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True,
                          mirror_clip_x=True, clip_dist=0.001)
    for v in bm.verts:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None: continue
        need = offset(v.co.z) * 0.85
        d = v.co - hit[0]
        if d.dot(hit[1]) < need:
            v.co = hit[0] + hit[1] * need
        if v.index in seam: v.co.x = 0.0
# the crotch band: more smoothing, so the hip box's edge and the crotch strip melt into the legs
band = [v for v in bm.verts if crotch - 0.26 < v.co.z < crotch + 0.12]
for it in range(18):
    bmesh.ops.smooth_vert(bm, verts=band, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True,
                          mirror_clip_x=True, clip_dist=0.001)
    for v in band:
        hit = bvh.find_nearest(v.co)
        if hit[0] is not None:
            need = offset(v.co.z) * 0.85
            if (v.co - hit[0]).dot(hit[1]) < need: v.co = hit[0] + hit[1] * need
        if v.index in seam: v.co.x = 0.0
# THE LEGS AS CLOTH HANGS: fabric spans the leg's hollows (knee, shin, inner thigh), it doesn't follow them. Per 1 cm
# slice the +X leg's convex outline (radius by angle around its centre), upper-enveloped over ±5 cm and smoothed, and
# every leg vertex sits at that radius + its offset; blended into the shaped hip above the crotch
import math
kb = b.data.shape_keys.key_blocks['site_rest']; part = b.data.attributes['_PART'].data
RC = [kb.data[i].co for i in range(len(kb.data))]
EDG = [(e.vertices[0], e.vertices[1]) for e in b.data.edges]
def slice_pts(z):                                   # where the body's edges cross the plane (exact, any mesh density)
    out = []
    for i, j in EDG:
        a, c = RC[i], RC[j]
        if (a.z - z) * (c.z - z) <= 0 and a.z != c.z:
            t = (z - a.z) / (c.z - a.z); x = a.x + (c.x - a.x) * t
            if 0.0 < x < 0.3: out.append((x, a.y + (c.y - a.y) * t))
    return out
NA, DZ = 72, 0.01
z0 = ankle - 0.02; nz = int((crotch + 0.02 - z0) / DZ) + 1
def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0: h.pop()
            h.append(q)
        return h
    lo, hi = half(pts), half(reversed(pts)); return lo[:-1] + hi[:-1]
def ray(poly, cx, cy, a):
    dx, dy = math.cos(a), math.sin(a); best = 0.0
    for k in range(len(poly)):
        (x1, y1), (x2, y2) = poly[k], poly[(k + 1) % len(poly)]
        ex, ey = x2 - x1, y2 - y1; den = dx * ey - dy * ex
        if abs(den) < 1e-12: continue
        t = ((x1 - cx) * ey - (y1 - cy) * ex) / den; u = ((x1 - cx) * dy - (y1 - cy) * dx) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9: best = max(best, t)
    return best
C, Rt = [], []
for k in range(nz):
    z = z0 + k * DZ
    pts = slice_pts(min(z, crotch - 0.005))
    hp = hull(pts); cx = sum(p[0] for p in hp) / len(hp); cy = sum(p[1] for p in hp) / len(hp)
    C.append((cx, cy)); Rt.append([ray(hp, cx, cy, 2 * math.pi * j / NA) for j in range(NA)])
def zsmooth(rows, r):
    return [[sum(rows[max(0, min(nz - 1, k + d))][j] for d in range(-r, r + 1)) / (2 * r + 1) for j in range(len(rows[0]))] for k in range(nz)]
Rt = [[max(Rt[max(0, min(nz - 1, k + d))][j] for d in range(-3, 4)) for j in range(NA)] for k in range(nz)]   # upper envelope
for it in range(10): Rt = zsmooth(Rt, 5)   # wide: the knee's bump must not leave a ledge
Rt = [[(r[(j - 1) % NA] + 2 * r[j] + r[(j + 1) % NA]) / 4 for j in range(NA)] for r in Rt]
C = zsmooth(C, 4)
def look_up(z, a):
    f = (z - z0) / DZ; k = max(0, min(nz - 2, int(f))); t = max(0.0, min(1.0, f - k))
    cx = C[k][0] * (1 - t) + C[k + 1][0] * t; cy = C[k][1] * (1 - t) + C[k + 1][1] * t
    a %= 2 * math.pi; g = a / (2 * math.pi) * NA; j = int(g) % NA; u = g - int(g)
    r = (Rt[k][j] * (1 - u) + Rt[k][(j + 1) % NA] * u) * (1 - t) + (Rt[k + 1][j] * (1 - u) + Rt[k + 1][(j + 1) % NA] * u) * t
    return cx, cy, r
def tube_at(z, a, sx):
    cx, cy, r = look_up(z, a)
    # the inseam side sits closer than the outside (real trousers: the ease goes to the front, back and outer leg),
    # so the two legs keep a gap between them instead of pressing together
    r += offset(z) * (1 - 0.82 * max(0.0, -math.cos(a)) ** 1.5)
    return Vector((sx * (cx + r * math.cos(a)), cy + r * math.sin(a), z))
def param(co):
    cx, cy, _ = look_up(co.z, 0.0)
    return co.z, math.atan2(co.y - cy, abs(co.x) - cx)
# every leg vertex gets a place on the smooth leg surface (height, angle around the leg); the shrinkwrap left them
# bunched, so the places are RELAXED (each moves to its neighbours' mean, on the surface) before the mesh goes there
legv = [v for v in bm.verts if v.co.z < crotch + 0.02 and v.index not in seam]
lset = set(legv)
par = {v: param(v.co) for v in bm.verts if v.co.z < crotch + 0.12}
free = [v for v in legv if not v.is_boundary and v.co.z < crotch - 0.04]
for it in range(40):
    nxt = {}
    for v in free:
        ns = [e.other_vert(v) for e in v.link_edges if e.other_vert(v) in par]
        if not ns: continue
        zm = sum(par[n][0] for n in ns) / len(ns)
        cs = sum(math.cos(par[n][1]) for n in ns); sn = sum(math.sin(par[n][1]) for n in ns)
        z, a = par[v]
        nxt[v] = (z * 0.5 + zm * 0.5, math.atan2(math.sin(a) * 0.5 * len(ns) + sn * 0.5, math.cos(a) * 0.5 * len(ns) + cs * 0.5))
    par.update(nxt)
for v in legv:
    sx = 1.0 if v.co.x >= 0 else -1.0
    w = sm(crotch + 0.02, crotch - 0.10, v.co.z)
    v.co = v.co.lerp(tube_at(*par[v], sx), w)
# iron: smooth the legs, put every point back on the leg surface, repeat (no ring may fold over its neighbours)
deep = [v for v in free if v.co.z < crotch - 0.10]
for it in range(12):
    bmesh.ops.smooth_vert(bm, verts=deep, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in deep:
        v.co = tube_at(*param(v.co), 1.0 if v.co.x >= 0 else -1.0)
# THE CROTCH: from the waist down to the crotch the fabric spans the hollow between the thighs and the groin (per slice
# the pelvis's convex outline + the offset; only pushed OUT), so the centre seam runs down in one smooth curve instead
# of being sucked into the cleft
def hip_hull(z):
    pts = []
    for i, j in EDG:
        a, c = RC[i], RC[j]
        if (a.z - z) * (c.z - z) <= 0 and a.z != c.z:
            t = (z - a.z) / (c.z - a.z); x = a.x + (c.x - a.x) * t
            if abs(x) < 0.3: pts.append((x, a.y + (c.y - a.y) * t))
    return hull(pts)
def hull_y(hp, x, front):                     # the outline's front (or back) y at x
    ys = []
    for k in range(len(hp)):
        (x1, y1), (x2, y2) = hp[k], hp[(k + 1) % len(hp)]
        if (x1 - x) * (x2 - x) <= 0 and x1 != x2: ys.append(y1 + (y2 - y1) * (x - x1) / (x2 - x1))
    return (min(ys) if front else max(ys)) if ys else None
HH = {}
def bridge():
    for v in bm.verts:
        if not (crotch - 0.07 < v.co.z < top - 0.03) or abs(v.co.x) > 0.09: continue
        zk = round(v.co.z / 0.005) * 0.005
        if zk not in HH:
            hp = hip_hull(zk); HH[zk] = (hp, sum(p[1] for p in hp) / len(hp))
        hp, cy = HH[zk]
        front = v.co.y < cy
        hy = hull_y(hp, v.co.x, front)
        if hy is None: continue
        want = hy - offset(v.co.z) if front else hy + offset(v.co.z)
        w = sm(crotch - 0.07, crotch - 0.01, v.co.z) * sm(0.09, 0.04, abs(v.co.x))   # across the bulge and the touching thighs below it
        if (front and v.co.y > want) or (not front and v.co.y < want):
            v.co.y += (want - v.co.y) * w
bridge()
# THE CROTCH POINT goes under the slot: from the crotch up to the perineum (13 cm) the thighs leave only 1-3 cm between
# them, no room for two layers of fabric, so the legs split below it (a Grab pull: down at the centre, fading out
# 7 cm to the sides and 15 cm up and down)
low = min(v.co.z for v in bm.verts if v.index in seam)
drop = low - (crotch - 0.015)          # the seam 1.5 cm under the groin (ease)
if drop > 0:
    for v in bm.verts:
        fx = math.cos(min(1.0, abs(v.co.x) / 0.11) * math.pi / 2) ** 1.5    # a wide round arch, not a tab
        fz = sm(low + 0.20, low, v.co.z) * sm(low - 0.15, low, v.co.z)
        v.co.z -= drop * fx * fz
print('crotch point lowered by', round(drop, 3))
for it in range(6):
    bmesh.ops.smooth_vert(bm, verts=[v for v in inner if crotch - 0.25 < v.co.z < crotch + 0.06], factor=0.5,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True, mirror_clip_x=True, clip_dist=0.001)
# below it the legs go back onto their own smooth surface, gradually (a hard edge here left a ledge at the knee)
for v in free:
    wt = sm(crotch - 0.08, crotch - 0.20, v.co.z)
    if wt > 0: v.co = v.co.lerp(tube_at(*param(v.co), 1.0 if v.co.x >= 0 else -1.0), wt)
# the crotch point: the hip box's corner leaves a pole of thin quads there, which pinches the centre seam; smooth it
# out (the centre seam slides only in y/z), then the push below keeps it off the body
spot = [v for v in bm.verts if abs(v.co.x) < 0.09 and crotch - 0.06 < v.co.z < crotch + 0.16
        and not (v.is_boundary and v.index not in seam)]
for it in range(20):
    bmesh.ops.smooth_vert(bm, verts=spot, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True,
                          mirror_clip_x=True, clip_dist=0.001)
    for v in spot:
        if v.index in seam: v.co.x = 0.0
    bridge()                                      # smoothing must not pull it back into the hollow
# each leg stays on its own side of the centre: the two legs touch instead of passing into each other
def centre_clamp():
    for v in bm.verts:
        if v.co.z < crotch - 0.02 and v.index not in seam and abs(v.co.x) < 0.0012:
            v.co.x = math.copysign(0.0012, v.co.x if v.co.x else 1)
# NOTHING OF THE BODY SHOWS: every point at least 5 mm outside the skin (the inner thigh next to the crotch is only
# 1.4 cm from the centre), the points around a pushed one smoothed with it, three rounds
MIN = 0.005
def push_out(vs):
    moved = []
    for v in vs:
        hit = bvh.find_nearest(v.co)
        if hit[0] is not None and (v.co - hit[0]).dot(hit[1]) < MIN:
            v.co = hit[0] + hit[1] * MIN; moved.append(v)
            if v.index in seam: v.co.x = 0.0
    return moved
centre_clamp()
for it in range(3):
    moved = push_out(bm.verts)
    ring = {n for v in moved for e in v.link_edges for n in (e.other_vert(v),) if not (n.is_boundary and n.index not in seam)}
    if ring:
        bmesh.ops.smooth_vert(bm, verts=list(ring), factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True,
                              mirror_clip_x=True, clip_dist=0.001)
    centre_clamp()
# the centre seam: a mirrored surface is flat across x = 0, so a seam vertex never sits deeper than the vertices
# beside it (else the two halves meet in a groove that shades as a V)
for it in range(4):
    for v in bm.verts:
        if v.index not in seam or v.is_boundary or not (crotch - 0.05 < v.co.z < top - 0.03): continue
        ns = [e.other_vert(v) for e in v.link_edges if e.other_vert(v).index not in seam]
        if not ns: continue
        ny = sum(n.co.y for n in ns) / len(ns)
        if (v.co.y < 0 and ny < v.co.y) or (v.co.y > 0 and ny > v.co.y): v.co.y = ny
print('pushed out of the body in the last round:', len(push_out(bm.verts)))
# only the centre seam's own edge lies on x = 0: an interior point there (mirror clipping snaps anything within 1 mm)
# gets welded to its mirror image when the Mirror is applied, leaving a broken fin with a hole at the crotch
for v in bm.verts:
    # between the thighs, where they touch, the two legs' fabric presses together: close the slit (it showed the
    # background and the inside through it as specks)
    if v.is_boundary and abs(v.co.x) < 0.012 and v.co.z > ankle + 0.1:
        # the centre seam's open edge goes back exactly onto the mirror plane (drifted ~1 mm, the Mirror didn't weld it:
        # a split at the crotch); the waist edge's ends too
        v.co.x = 0.0; continue
    if v.co.z < crotch - 0.01 and abs(v.co.x) < 0.009: v.co.x = math.copysign(0.0012, v.co.x or 1)
    if not v.is_boundary and v.co.x < 0.0012 and v.co.x >= 0: v.co.x = 0.0012   # 2.4 mm from its mirror: > the 1 mm merge distance
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
me.update()
print('pants shaped:', len(me.vertices), 'verts')
