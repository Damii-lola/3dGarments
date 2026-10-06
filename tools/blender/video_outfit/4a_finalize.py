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
            m.levels = 2
            bpy.ops.object.modifier_apply(modifier='Multires')
    bm = bmesh.new(); bm.from_mesh(ob.data)
    MIN = 0.007
    fixed = set()
    for v in bm.verts:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None: continue
        d = (v.co - hit[0]).dot(hit[1])
        if d < MIN:
            v.co = hit[0] + hit[1] * MIN; fixed.add(v)
    ring = set(fixed)
    for v in fixed:
        for e in v.link_edges: ring.add(e.other_vert(v))
    for it in range(3):
        bmesh.ops.smooth_vert(bm, verts=list(ring), factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in ring:
            hit = bvh.find_nearest(v.co)
            if hit[0] is not None and (v.co - hit[0]).dot(hit[1]) < MIN: v.co = hit[0] + hit[1] * MIN
    bm.to_mesh(ob.data); bm.free()
    for p in ob.data.polygons: p.use_smooth = True
    ob.data.update()
    print(name, 'baked:', len(ob.data.vertices), 'verts; pushed out to 7 mm:', len(fixed))
