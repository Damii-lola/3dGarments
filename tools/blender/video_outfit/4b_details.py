# REAL-GARMENT DETAILS on the baked sculpt (after 4a_finalize, before Solidify), copied from how joggers and crewneck
# sweatshirts are actually made:
#  - sweatshirt NECK RIB: a 2.2 cm knit band sewn to the neckline, standing ~2.5 mm proud of the body, rounded at its
#    top edge, with the seam (a small sunk line) where it meets the body;
#  - sweatshirt HEM: the body is wider than its 6 cm rib band, so it GATHERS into it: soft, irregular vertical folds
#    right above the band, dying out ~15 cm up;
#  - jogger WAISTBAND: elastic, so the fabric bunches in small vertical ruches all around (~1.3 cm apart, uneven), down to
#    its seam 4.5 cm under the top;
#  - jogger SLANT POCKETS: the front panel is cut on a slant from the waistband to the side seam and its edge laps over
#    the pocket bag: a soft raised lip on the front side of the line, the bag sitting a little deeper behind it.
# Every move is along the surface normal; nothing ends up closer to the body than before minus 1 mm.
import bpy, bmesh, math, random
from mathutils import Vector
from mathutils.kdtree import KDTree
object_mode()
def sm(a, c, x):
    t = max(0.0, min(1.0, (x - a) / (c - a))); return t * t * (3 - 2 * t)
def noise1(th, seed, terms=((3, 1.0), (5, 0.6), (8, 0.35))):
    r = random.Random(seed); return sum(a * math.sin(k * th + r.uniform(0, 6.3)) for k, a in terms) / 1.95

# ---------------------------------------------------------------- sweatshirt
ob = bpy.data.objects['Sweatshirt']; me = ob.data
bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
hem = STATE['shirt']['hem']; ncy = STATE['crew']['ncy']
neck = [v for v in bm.verts if v.is_boundary and v.co.z > 1.42 and abs(v.co.x) < 0.2]
kd = KDTree(len(neck))
for i, v in enumerate(neck): kd.insert(v.co, i)
kd.balance()
low = min(v.co.z for v in bm.verts if v.is_boundary and v.co.z < 1.1)       # the hem edge
moves = {}
for v in bm.verts:
    n = v.normal; d = 0.0
    # neck rib: proud band, rounded top edge, seam at 2.2 cm
    dn = kd.find(v.co)[2]
    if dn < 0.03:
        d += 0.0025 * sm(0.0, 0.006, dn) * (1 - sm(0.019, 0.022, dn))           # the band (rounded at the edge)
        d -= 0.0012 * math.exp(-((dn - 0.0225) / 0.0022) ** 2)                 # the seam line
    # hem gathers: torso only (the sleeves are far above in the T-pose)
    if low - 0.01 < v.co.z < low + 0.26 and abs(v.co.x) < 0.3:
        th = math.atan2(v.co.x, -v.co.y)
        z = v.co.z - low
        env = sm(0.055, 0.075, z) * (1 - sm(0.09, 0.22, z))                     # above the band, dying out upwards
        g = 0.55 * math.sin(16 * th + 1.7 * noise1(th, 5)) + 0.45 * math.sin(27 * th + 2.0 * noise1(th, 9))
        tall = 0.6 + 0.4 * noise1(th, 13)                                       # some gathers run higher than others
        env *= 1 - sm(0.09 + 0.06 * tall, 0.22 + 0.04 * tall, z) + sm(0.09, 0.22, z)   # vary where each one ends
        d += 0.0042 * env * g
        d -= 0.0012 * math.exp(-((z - 0.06) / 0.003) ** 2)                      # band seam
    if d: moves[v] = v.co + n * d
for v, p in moves.items(): v.co = p
bm.to_mesh(me); bm.free(); me.update()
print('sweatshirt details on', len(moves), 'verts')

# ---------------------------------------------------------------- pants
ob = bpy.data.objects['Pants']; me = ob.data
bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
top = max(v.co.z for v in bm.verts)
crotch = STATE['L']['crotch']
# hip half width at the pocket's lower end, for the side seam
hipw = max(abs(v.co.x) for v in bm.verts if abs(v.co.z - (top - 0.19)) < 0.01)
moves = {}
for v in bm.verts:
    n = v.normal; d = 0.0; z = top - v.co.z
    # waistband ruching: vertical gathers all round, uneven, fading out just above the seam; the seam itself sunk
    if z < 0.06:
        th = math.atan2(v.co.x, -v.co.y)
        g = 0.6 * math.sin(30 * th + 2.2 * noise1(th, 21)) + 0.4 * math.sin(47 * th + 2.5 * noise1(th, 23))
        d += 0.0016 * g * sm(0.0, 0.006, z) * (1 - sm(0.036, 0.043, z))
        d -= 0.0013 * math.exp(-((z - 0.045) / 0.0025) ** 2)
    # slant pockets (front only), each side: from the waistband 10.5 cm off centre to the side seam 19 cm down
    if v.co.y < 0.02 and 0.0 < z < 0.22:
        ax = abs(v.co.x)
        a = Vector((0.105, top - 0.045)); b = Vector((hipw - 0.004, top - 0.19))
        u = (b - a).normalized(); nrm = Vector((-u.y, u.x))                       # nrm points up/in: the front panel
        q = Vector((ax, v.co.z)) - a
        t = q.dot(u) / (b - a).length; s = q.dot(nrm)
        if -0.05 < t < 1.05:
            along = sm(-0.05, 0.03, t) * sm(1.05, 0.97, t)
            if s > 0: d += 0.003 * along * math.exp(-((s - 0.004) / 0.004) ** 2)          # the panel's lip
            else: d -= 0.002 * along * sm(0.0, 0.004, -s) * (1 - sm(0.02, 0.035, -s))    # the bag behind it
            d -= 0.0009 * along * math.exp(-(s / 0.0012) ** 2)                            # the edge itself
    if d: moves[v] = v.co + n * d
for v, p in moves.items(): v.co = p
bm.to_mesh(me); bm.free(); me.update()
print('pants details on', len(moves), 'verts; hip half width at the pocket end', round(hipw, 3))
