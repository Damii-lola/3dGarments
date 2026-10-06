# PRIMARY FOLDS (video 6:45-8:10: the jogger stack above the ankle cuffs, the sweatshirt's forearm stack above the
# cuffs, soft rings at the elbows) as ONE fold field per limb, around the limb's own axis. The video draws them with
# the Draw brush, ring by ring, turning the model; strokes replayed from fixed views overlap at the sides and pile up
# (lumps sticking out of the outer leg), so each ring here goes evenly all the way around: rounded ridges, tight
# valleys, every ring wavy and tilted its own way, deeper at the front and sides than at the back, fading out at both
# ends. Nothing comes closer than 7 mm to the body (4a_finalize checks again).
import bpy, bmesh, math, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
object_mode()
bvh = BVHTree.FromObject(body(), bpy.context.evaluated_depsgraph_get())
def sm(a, c, x):
    t = max(0.0, min(1.0, (x - a) / (c - a))); return t * t * (3 - 2 * t)
def fold_field(bm, sel, centre, axis, front, t0, t1, rings, amp, seed, back=0.55, width=0.38):
    """rings: positions along the axis (m); amp: ridge height (m); centre(t) -> axis point at t"""
    rnd = random.Random(seed)
    R = [dict(t=t, tilt=rnd.uniform(0.004, 0.011), ph=rnd.uniform(0, 6.3), wob=rnd.uniform(0.002, 0.004),
              ph2=rnd.uniform(0, 6.3), a=amp * rnd.uniform(0.8, 1.1), br=rnd.uniform(0, 6.3)) for t in rings]
    side = axis.cross(front).normalized(); fr = side.cross(axis).normalized()
    sp = (rings[-1] - rings[0]) / max(1, len(rings) - 1) if len(rings) > 1 else 0.045
    moved = 0
    for v in sel:
        t = (v.co - centre(0.0)).dot(axis)
        if not (t0 - 0.02 < t < t1 + 0.02): continue
        c = centre(t); r = v.co - c; r -= axis * r.dot(axis)
        if r.length < 1e-6: continue
        th = math.atan2(r.dot(side), r.dot(fr))                 # 0 = front
        around = back + (1 - back) * (0.5 + 0.5 * math.cos(th))  # the back folds less
        d = 0.0
        for g in R:
            tc = g['t'] + g['tilt'] * math.sin(th + g['ph']) + g['wob'] * math.sin(2 * th + g['ph2'])
            s = (t - tc) / (sp * width)
            breakup = 0.75 + 0.25 * math.sin(3 * th + g['br'])  # a ring is higher in places, lower in others
            d += g['a'] * around * breakup * math.exp(-s * s)
        d -= amp * 0.32 * around                                  # valleys between the ridges
        d *= sm(t0 - 0.02, t0 + 0.015, t) * sm(t1 + 0.02, t1 - 0.015, t)
        n = r.normalized(); p = v.co + n * d
        hit = bvh.find_nearest(p)
        if hit[0] is not None and (p - hit[0]).dot(hit[1]) < 0.007: p = hit[0] + hit[1] * 0.007
        v.co = p; moved += 1
    return moved
def slice_centre(bm, side_sign, z, verts):
    pts = [v.co for v in verts if abs(v.co.z - z) < 0.008 and v.co.x * side_sign > 0.01]
    return Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), z)) if pts else None

# ---------------------------------------------------------------- pants: the stack above each ankle cuff
L = STATE['L']; ankle = L['bottom'] + 0.075
ob = bpy.data.objects['Pants']; bm = bmesh.new(); bm.from_mesh(ob.data)
for sgn in (1, -1):
    leg = [v for v in bm.verts if v.co.x * sgn > 0.0 and v.co.z < ankle + 0.40]
    cache = {}
    def centre(t, sgn=sgn, leg=leg):
        z = round(ankle + t, 3)
        if z not in cache: cache[z] = slice_centre(bm, sgn, z, leg) or Vector((0.1 * sgn, 0.03, z))
        return cache[z]
    centre_fixed = {}
    # the axis is vertical; the centre follows the leg slice by slice
    def ctr(t, centre=centre): return centre(round(t / 0.01) * 0.01)
    base = Vector((0, 0, ankle))
    class C:
        pass
    sel = [v for v in leg if not v.is_boundary]
    n = fold_field(bm, sel, lambda t, ctr=ctr: ctr(t) if t else Vector((ctr(0).x, ctr(0).y, ankle)),
                   Vector((0, 0, 1)), Vector((0, -1, 0)), 0.075, 0.30,
                   [0.095, 0.138, 0.183, 0.226, 0.268], 0.0105, seed=21 if sgn > 0 else 22, back=0.5)
    print('pants leg', sgn, 'fold field on', n, 'verts')
bm.to_mesh(ob.data); bm.free(); ob.data.update()

# ---------------------------------------------------------------- sweatshirt: forearm stack + elbow rings
sh = STATE['shirt']; S, E, W = Vector(sh['S']), Vector(sh['E']), Vector(sh['W'])
ob = bpy.data.objects['Sweatshirt']; bm = bmesh.new(); bm.from_mesh(ob.data)
for sgn in (1, -1):
    m = Vector((sgn, 1, 1))
    s_, e_, w_ = S * 1, E * 1, W * 1
    s_.x, e_.x, w_.x = abs(S.x) * sgn, abs(E.x) * sgn, abs(W.x) * sgn
    arm = [v for v in bm.verts if v.co.x * sgn > abs(S.x) - 0.02 and not v.is_boundary]
    # forearm: E → W; the axis line is the bone line, the sleeve's own centre per slice along it
    fa = (w_ - e_).normalized(); flen = (w_ - e_).length
    def fcentre(t, e_=e_, fa=fa, arm=arm):
        p = e_ + fa * t
        pts = [v.co for v in arm if abs((v.co - p).dot(fa)) < 0.008]
        if not pts: return p
        c = Vector((0, 0, 0))
        for q in pts: c += q
        return c / len(pts)
    fc = {}
    def fcen(t, fcentre=fcentre, fc=fc):
        k = round(t / 0.01) * 0.01
        if k not in fc: fc[k] = fcentre(k)
        return fc[k]
    front = Vector((0, -1, 0))
    n = fold_field(bm, arm, lambda t, fcen=fcen, e_=e_: fcen(t) if t else e_, fa, front,
                   flen * 0.34, flen - 0.07, [flen * 0.42, flen * 0.53, flen * 0.64, flen * 0.75, flen * 0.85], 0.012,
                   seed=3 if sgn > 0 else 4, back=0.6)
    # elbow: two soft rings over the joint
    ua = (e_ - s_).normalized(); ulen = (e_ - s_).length
    def ucentre(t, s_=s_, ua=ua, arm=arm):
        p = s_ + ua * t
        pts = [v.co for v in arm if abs((v.co - p).dot(ua)) < 0.008]
        if not pts: return p
        c = Vector((0, 0, 0))
        for q in pts: c += q
        return c / len(pts)
    uc = {}
    def ucen(t, ucentre=ucentre, uc=uc):
        k = round(t / 0.01) * 0.01
        if k not in uc: uc[k] = ucentre(k)
        return uc[k]
    n2 = fold_field(bm, arm, lambda t, ucen=ucen, s_=s_: ucen(t) if t else s_, ua, front,
                    ulen - 0.07, ulen + 0.06, [ulen - 0.03, ulen + 0.025], 0.008, seed=11 if sgn > 0 else 12, back=0.7)
    print('sleeve', sgn, 'forearm', n, 'elbow', n2)
bm.to_mesh(ob.data); bm.free(); ob.data.update()

# ---------------------------------------------------------------- Multires for the strokes that follow
win, area, region = view3d()
for name in ('Pants', 'Sweatshirt'):
    ob = bpy.data.objects[name]
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
        for x in bpy.context.view_layer.objects: x.select_set(x == ob)
        bpy.context.view_layer.objects.active = ob
        mr = ob.modifiers.new('Multires', 'MULTIRES')
        bpy.ops.object.multires_subdivide(modifier='Multires', mode='CATMULL_CLARK')
        mr.sculpt_levels = mr.levels = mr.render_levels = 1
    for p in ob.data.polygons: p.use_smooth = True
    ob.data.use_mirror_x = True
    print(name, 'verts', len(ob.data.vertices), 'multires', ob.modifiers['Multires'].total_levels)
