VD = Vector((1, 0, 0))
# the jogger bunch stacking above the ankle cuff (video 7:55-8:10): deep, many rings
ob = bpy.data.objects['Pants']
L = STATE['L']; ankle = L['bottom'] + 0.075
import bmesh
def leg_centre(z):
    me = ob.data
    pts = [v.co for v in me.vertices if abs(v.co.z - z) < 0.01 and v.co.x > 0]
    return Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), z))
c0 = leg_centre(ankle + 0.06)
up = Vector((0, 0, 1))
VD = globals().get('VD', Vector((0, -1, 0)))
look(c0 + Vector((0, 0, 0.14)), tuple(VD), 0.75)
ts = [0.05 + k * 0.043 for k in range(5)]
print('queued', bunch(ob, c0 + Vector((0, 0, -0.06)) + Vector((0, 0, 0)), up, [t + 0.02 for t in ts], 0.07, VD, ridge_r=40, valley_r=26, strength=0.85, seed=23, smooth_r=40))
