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
    up = (E - S).length; d1 = (E - S).normalized()
    t = (q - S).dot(d1)
    if t > up: t = up + (q - E).dot((W - E).normalized())
    return t
sleeve_len = (E - S).length + (W - E).length * 0.92
def offset(p):
    t = arm_t(p)
    if t > 0.03:                                             # sleeve
        if t > sleeve_len - 0.06: return 0.008               # rib cuff
        return 0.022 + 0.016 * sm(sleeve_len - 0.35, sleeve_len - 0.12, t)   # roomier low on the forearm (bunch)
    if p.z < hem + 0.06: return 0.010                        # hem rib band
    if p.z > 1.5 and abs(p.x) < 0.11: return 0.006           # neck rib
    blouse = sm(hem + 0.06, hem + 0.12, p.z) * (1 - sm(1.25, 1.45, p.z))
    return 0.018 + 0.022 * blouse                           # the body balloons over the band
me = ob.data
for v in me.vertices:
    hit = bvh.find_nearest(v.co)
    if hit[0] is None: continue
    d = v.co - hit[0]; n = d.normalized() if d.length > 1e-4 and d.dot(hit[1]) > 0 else hit[1]
    v.co = hit[0] + n * offset(v.co)
bm = bmesh.new(); bm.from_mesh(me)
for it in range(8):
    bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in bm.verts:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None: continue
        need = offset(v.co) * 0.85
        if (v.co - hit[0]).dot(hit[1]) < need: v.co = hit[0] + hit[1] * need
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
me.update()
print('sweatshirt shaped')
look((0, 0, 1.15), (0.6, -1, 0.2), 2.4)
