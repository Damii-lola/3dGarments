# the neck rib's seam (video 9:40): a Crease Polish line 2.2 cm under the neckline, front half from the front, back
# half from the back
import math, bmesh
ob = bpy.data.objects['Sweatshirt']; cr = STATE['crew']; nb, ncy = cr['nb'], cr['ncy']
bm = bmesh.new(); bm.from_mesh(ob.data)
edge = [v.co.copy() for v in bm.verts if v.is_boundary and v.co.z > 1.45 and abs(v.co.x) < 0.17]
bm.free()
def ang(p): return math.atan2(p.x, -(p.y - ncy))
q = 0
for vd, th0, th1 in (((0, -1, 0), -1.35, 1.35), ((0, 1, 0), 1.8, 4.48)):
    look(Vector((0, ncy, nb - 0.03)), vd, 0.55)
    pts = []
    for k in range(24):
        th = th0 + (th1 - th0) * k / 23
        e = min(edge, key=lambda p: abs(math.atan2(math.sin(ang(p) - th), math.cos(ang(p) - th))))
        out = Vector((e.x, e.y - ncy, 0)).normalized()
        pts.append(Vector((e.x, e.y, e.z - 0.022)) + out * 0.004)
    q += sculpt_drag_q(ob, 'Crease Polish', pts, radius=10, strength=0.4)
print('queued', q)
