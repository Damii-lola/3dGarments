# FINALIZE (after the sculpt, before Solidify): bake the sculpt at the streamed level, and keep every point of the
# fabric's outside at least 7 mm off the body — a deep valley must never push it behind its own 5 mm inside layer
import bpy, bmesh
from mathutils.bvhtree import BVHTree
object_mode()
b = body(); bvh = BVHTree.FromObject(b, bpy.context.evaluated_depsgraph_get())
win, area, region = view3d()
for name in ('Pants', 'Sweatshirt'):
    ob = bpy.data.objects[name]
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
        for x in bpy.context.view_layer.objects: x.select_set(x == ob)
        bpy.context.view_layer.objects.active = ob
        m = ob.modifiers.get('Multires')
        if m:
            m.levels = max(1, m.total_levels - 1)          # stream about 50 k vertices a garment
            bpy.ops.object.modifier_apply(modifier='Multires')
    bm = bmesh.new(); bm.from_mesh(ob.data)
    # 7 mm, except on the tight bands within 3 cm of an edge (neck rib, cuffs, hem band, waistband): they are built
    # 6-9 mm off the body on purpose, and shoving them out jags the edge
    from mathutils.kdtree import KDTree
    edge = [v for v in bm.verts if v.is_boundary]
    kd = KDTree(len(edge))
    for i, v in enumerate(edge): kd.insert(v.co, i)
    kd.balance()
    groin = STATE['L'].get('groin', 0)
    def need(v):
        if name == 'Pants' and abs(v.co.x) < 0.012 and v.co.z < groin - 0.01: return -1.0   # legs pressed together
        return 0.0045 if edge and kd.find(v.co)[2] < 0.03 else 0.007
    fixed = set()
    for v in bm.verts:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None: continue
        d = (v.co - hit[0]).dot(hit[1]); MIN = need(v)
        if d < MIN:
            v.co = hit[0] + hit[1] * MIN; fixed.add(v)
    ring = set(fixed)
    for v in fixed:
        for e in v.link_edges: ring.add(e.other_vert(v))
    for it in range(3):
        bmesh.ops.smooth_vert(bm, verts=[v for v in ring if not v.is_boundary], factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in ring:
            hit = bvh.find_nearest(v.co)
            if hit[0] is not None and (v.co - hit[0]).dot(hit[1]) < need(v): v.co = hit[0] + hit[1] * need(v)
    if name == 'Sweatshirt':          # over the trousers (after both sculpts): >= 5 mm outside the pants
        pants = bpy.data.objects['Pants']
        pb = BVHTree.FromObject(pants, bpy.context.evaluated_depsgraph_get())
        over = 0
        for v in bm.verts:
            if v.co.z > 1.06: continue
            hit = pb.find_nearest(v.co)
            if hit[0] is not None and (v.co - hit[0]).dot(hit[1]) < 0.005:
                v.co = hit[0] + hit[1] * 0.005; over += 1
        print('sweatshirt pushed over the pants:', over)
    bm.to_mesh(ob.data); bm.free()
    for p in ob.data.polygons: p.use_smooth = True
    ob.data.update()
    print(name, 'baked:', len(ob.data.vertices), 'verts; pushed out to 7 mm:', len(fixed))
