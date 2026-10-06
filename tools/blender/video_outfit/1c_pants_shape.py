# the video 2:15-3:15: waistband + cuffs tight, legs scaled out loose (joggers), nothing of the body poking through
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ob = bpy.data.objects['Pants']; b = body()
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(b, dg)
L = STATE['L']; ankle = L['bottom'] + 0.075; crotch = L['crotch']
top = max(v.co.z for v in ob.data.vertices)
def sm(a, c, x):
    t = max(0.0, min(1.0, (x - a) / (c - a))); return t * t * (3 - 2 * t)
def offset(z):
    if z > top - 0.05: return 0.008                                # waistband
    if z < ankle + 0.06: return 0.009                              # rib cuff
    hip = 0.014
    leg = 0.03 + 0.012 * sm(ankle + 0.3, ankle + 0.1, z)           # looser low on the shin (where it will bunch)
    w = sm(crotch + 0.05, crotch - 0.12, z)                        # hip → leg
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
for it in range(8):
    bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False,
                          mirror_clip_x=True, clip_dist=0.001)
    for v in bm.verts:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None: continue
        need = offset(v.co.z) * 0.85
        d = v.co - hit[0]
        if d.dot(hit[1]) < need:
            v.co = hit[0] + hit[1] * need
        if v.index in seam: v.co.x = 0.0
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
me.update()
print('pants shaped:', len(me.vertices), 'verts')
