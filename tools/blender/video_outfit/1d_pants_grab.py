# the video 2:45-3:50: Grab brush (big radius, strength ~0.4) shaping the blockout
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ob = bpy.data.objects['Pants']
L = STATE['L']; ankle = L['bottom'] + 0.075
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(ob, dg)
def surf(x, z, side=-1):                    # the point on the pants seen from the front (side=-1) / back (+1) at (x, z)
    hit = bvh.ray_cast(Vector((x, side * 2.0, z)), Vector((0, -side, 0)))
    return hit[0]
STATE['strokes'] = 0
look((0.1, 0, 0.35), (0, -1, 0), 1.3)
n = 0
# pull the shin fabric down over the cuff (the bunch), at the leg's front
for x in (0.07, 0.1, 0.13):
    p = surf(x, ankle + 0.17)
    if p: n += sculpt_drag(ob, 'Grab', [p, p + Vector((0, 0, -0.035))], radius=110, strength=0.4)
# push the calf silhouette out a little (loose joggers)
p = surf(0.15, ankle + 0.3)
if p: n += sculpt_drag(ob, 'Grab', [p, p + Vector((0.018, 0, -0.01))], radius=140, strength=0.4)
print('queued grab strokes, points:', n)
