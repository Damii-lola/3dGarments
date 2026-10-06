import bpy, json
from mathutils import Vector
b = body(); kb = b.data.shape_keys.key_blocks['site_rest']
part = b.data.attributes['_PART'].data
P = [kb.data[i].co.copy() for i in range(len(kb.data))]
skin = [i for i in range(len(P)) if part[i].value < 0.5]
zs = sorted(P[i].z for i in skin); top, bottom = zs[-1], zs[0]
def ring(z, dz=0.01, cond=lambda p: True):
    return [P[i] for i in skin if abs(P[i].z - z) < dz and cond(P[i])]
# crotch: lowest skin point near x=0 between the legs
crotch = min(P[i].z for i in skin if abs(P[i].x) < 0.015 and 0.5 < P[i].z < 1.1)
# torso width per height between crotch and armpit, |x| < 0.2 (arms are out, T-pose)
prof = []
z = crotch + 0.05
while z < crotch + 0.6:
    r = ring(z, 0.006, lambda p: abs(p.x) < 0.25)
    if r: prof.append((round(z, 3), round(max(p.x for p in r) - min(p.x for p in r), 3), round(max(p.y for p in r) - min(p.y for p in r), 3)))
    z += 0.02
waist = min(prof[3:], key=lambda t: t[1])
hip = max([t for t in prof if t[0] < waist[0]], key=lambda t: t[1])
# a leg: x > 0 side, ring centres down to the ankle
leg = []
z = crotch - 0.03
while z > bottom + 0.06:
    r = ring(z, 0.006, lambda p: p.x > 0.0)
    if r:
        cx = sum(p.x for p in r) / len(r); cy = sum(p.y for p in r) / len(r)
        leg.append((round(z, 3), round(cx, 3), round(cy, 3), round(max(p.x for p in r) - min(p.x for p in r), 3), round(max(p.y for p in r) - min(p.y for p in r), 3)))
    z -= 0.04
# GROIN (the real crotch, where the trousers' crotch seam goes): on this body the thighs touch each other from the
# groin down ~15 cm, so the lowest skin between the legs (above) is inner thigh. The groin is the lowest height at
# which a ray along the centre line still meets the front of the body ahead of the back (front and back meet there)
from mathutils.bvhtree import BVHTree
from mathutils import Vector
_bvh = BVHTree.FromPolygons(P, [list(f.vertices) for f in b.data.polygons])
groin = None; zz = 1.0
while zz > crotch:
    h = _bvh.ray_cast(Vector((0.0, -1.0, zz)), Vector((0.0, 1.0, 0.0)))
    if h[0] is None or h[0].y > -0.03: groin = zz + 0.005; break
    zz -= 0.0025
groin = groin or crotch
STATE['L'] = dict(top=top, bottom=bottom, crotch=crotch, groin=groin, waist=waist, hip=hip, leg=leg)
print('groin (real crotch)', round(groin, 3), 'thighs part at', round(crotch, 3))
print(json.dumps(dict(height=round(top - bottom, 3), crotch=round(crotch, 3), waist=waist, hip=hip)))
for l in leg: print(l)
win, area, region = view3d(); sp = area.spaces.active
sp.shading.light = 'MATCAP'; sp.shading.color_type = 'OBJECT'; sp.overlay.show_floor = True
for o in bpy.data.objects:
    if o.type == 'ARMATURE': o.hide_set(True)
for n in ('st_x',):
    o = bpy.data.objects.get(n); o and bpy.data.objects.remove(o)
look((0, 0, (top + bottom) / 2), (0, -1, 0), 3.2)
