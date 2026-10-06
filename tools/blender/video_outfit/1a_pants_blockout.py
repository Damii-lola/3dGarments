# STEP 1, PANTS: the video's blockout, on our rest-pose body
import bpy, bmesh
from mathutils import Vector
b = body(); kb = b.data.shape_keys.key_blocks['site_rest']; part = b.data.attributes['_PART'].data
P = [kb.data[i].co for i in range(len(kb.data))]
skin = [i for i in range(len(P)) if part[i].value < 0.5]
L = STATE['L']; crotch = L['groin']; bottom = L['bottom']   # the real crotch (see 0_landmarks)
def slab(z, dz, side=1):
    return [P[i] for i in skin if abs(P[i].z - z) < dz and P[i].x * side > 0.0 and abs(P[i].x) < 0.3]
def leg_at(z):                       # the +X leg's box at height z: centre x/y, half widths
    r = slab(z, 0.012)
    xs = [p.x for p in r]; ys = [p.y for p in r]
    return Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, z)), (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2
top = L['waist'][0] - 0.04                     # joggers sit a little under the natural waist
hipz = L['hip'][0]
hip_r = [P[i] for i in skin if abs(P[i].z - hipz) < 0.012 and abs(P[i].x) < 0.25]
HW = max(p.x for p in hip_r) + 0.015           # half width of the hip box (+1.5 cm)
Y0, Y1 = min(p.y for p in hip_r) - 0.015, max(p.y for p in hip_r) + 0.015
ankle = bottom + 0.075
for o in [o for o in bpy.data.collections['Garments'].objects if o.name.startswith('Pants')]:
    bpy.data.objects.remove(o)
bm = bmesh.new()
# hip box, one half (x >= 0), split at the inner edge of the leg so the crotch stays between the legs
lc, lrx, lry = leg_at(crotch - 0.04)
xin = max(0.01, lc.x - lrx - 0.012)            # leg's inner side
zb = crotch - 0.02                              # bottom of the hip box
cols = [0.0, xin, HW]
def V(x, y, z): return bm.verts.new((x, y, z))
grid = {}
for zi, z in enumerate((top, zb)):
    for xi, x in enumerate(cols):
        for yi, y in enumerate((Y0, Y1)):
            grid[zi, xi, yi] = V(x, y, z)
F = lambda *vs: bm.faces.new(vs)
for xi in range(2):                                  # front + back walls
    F(grid[0, xi, 0], grid[0, xi + 1, 0], grid[1, xi + 1, 0], grid[1, xi, 0])
    F(grid[0, xi + 1, 1], grid[0, xi, 1], grid[1, xi, 1], grid[1, xi + 1, 1])
F(grid[0, 2, 0], grid[0, 2, 1], grid[1, 2, 1], grid[1, 2, 0])          # outer side
F(grid[1, 0, 0], grid[1, 1, 0], grid[1, 1, 1], grid[1, 0, 1])          # crotch bottom (stays)
leg_top = F(grid[1, 1, 0], grid[1, 2, 0], grid[1, 2, 1], grid[1, 1, 1])  # extruded down into the leg
# EXTRUDE the leg down to the ankle in steps that follow the leg (the video: E, then move/scale to the leg)
cur = leg_top
z = zb
steps = 9
for k in range(1, steps + 1):
    z = zb - (zb - ankle) * k / steps
    c, rx, ry = leg_at(z if k < steps else ankle + 0.02)
    ex = bmesh.ops.extrude_face_region(bm, geom=[cur])
    nv = [e for e in ex['geom'] if isinstance(e, bmesh.types.BMVert)]
    nf = [e for e in ex['geom'] if isinstance(e, bmesh.types.BMFace)][0]
    pad = 0.012
    xs = sorted(nv, key=lambda v: v.co.x); ys = sorted(nv, key=lambda v: v.co.y)
    for v in nv:
        v.co.z = z
        v.co.x = c.x + (rx + pad) * (1 if v in xs[2:] else -1)
        v.co.y = c.y + (ry + pad) * (1 if v in ys[2:] else -1)
    bmesh.ops.delete(bm, geom=[cur], context='FACES_ONLY')
    cur = nf
bmesh.ops.delete(bm, geom=[cur], context='FACES_ONLY')     # open ankle
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
me = bpy.data.meshes.new('Pants'); bm.to_mesh(me); bm.free()
ob = new_garment('Pants', me, color=(0.85, 0.55, 0.25))       # the video's orange
ob.color = (0.85, 0.55, 0.25, 1)
m = ob.modifiers.new('Mirror', 'MIRROR'); m.use_clip = True; m.use_mirror_merge = True; m.merge_threshold = 0.001
print('pants blockout:', len(me.vertices), 'verts', len(me.polygons), 'faces; top', round(top, 3), 'crotch', round(crotch, 3), 'ankle', round(ankle, 3), 'hip half width', round(HW, 3))
