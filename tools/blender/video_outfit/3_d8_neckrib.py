import math
ob = bpy.data.objects['Sweatshirt']; cr = STATE['crew']; nb, ncy = cr['nb'], cr['ncy']
q = 0
for vd, th0, th1 in (((0, -1, 0), -1.4, 1.4), ((0, 1, 0), 1.75, 4.53)):
    look(Vector((0, ncy, nb - 0.03)), vd, 0.55)
    edge = [v.co for v in ob.data.vertices if v.co.z > 1.42 and abs(v.co.x) < 0.16]
    pts = []
    for k in range(22):
        th = th0 + (th1 - th0) * k / 21
        # the neckline edge point nearest this angle, 2 cm down the garment
        e = min(edge, key=lambda p: abs(math.atan2(p.x, -(p.y - ncy)) - math.atan2(math.sin(th), math.cos(th))) + abs(p.z - (nb - 0.01)) * 3)
        pts.append(Vector((e.x * 1.05, e.y + (e.y - ncy) * 0.12, e.z - 0.02)))
    q += sculpt_drag_q(ob, 'Crease Polish', pts, radius=14, strength=0.6)
    break
print('queued', q)
