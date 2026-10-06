import bpy, bmesh
ob = bpy.data.objects['Pants']; b = body()
win, area, region = view3d(); area.spaces.active.overlay.show_wireframes = False
# LOOP CUTS: a grid of roughly square quads (each face → 3×3)
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
bm.to_mesh(ob.data); bm.free()
# SHRINKWRAP onto the body, then SUBDIVISION, then apply them (the Mirror stays live)
sw = ob.modifiers.new('Shrinkwrap', 'SHRINKWRAP')
sw.wrap_method = 'NEAREST_SURFACEPOINT'; sw.wrap_mode = 'ON_SURFACE'; sw.target = b; sw.offset = 0.01
sd = ob.modifiers.new('Subdivision', 'SUBSURF'); sd.levels = 1; sd.render_levels = 2; sd.subdivision_type = 'CATMULL_CLARK'
with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
    for x in bpy.context.view_layer.objects: x.select_set(x == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier='Shrinkwrap')
    bpy.ops.object.modifier_apply(modifier='Subdivision')
# the subdivision was applied to the half mesh: its open centre edge shrank away from the mirror plane → snap it back
bm = bmesh.new(); bm.from_mesh(ob.data)
zt = max(v.co.z for v in bm.verts); zb = min(v.co.z for v in bm.verts)
snapped = 0
for v in bm.verts:
    if v.is_boundary and abs(v.co.x) < 0.04 and zb + 0.01 < v.co.z < zt - 0.005:
        v.co.x = 0.0; snapped += 1
bm.to_mesh(ob.data); bm.free()
print('centre seam vertices snapped to x = 0:', snapped)
print('pants after shrinkwrap + subdivision:', len(ob.data.vertices), 'verts', [m.name for m in ob.modifiers])
look((0, 0, 0.55), (0.6, -1, 0.25), 2.2)
