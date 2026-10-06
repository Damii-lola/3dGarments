# STEP 2 setup (video 6:45-7:05): apply the Mirror, one subdivision baked into the mesh (the folds below need ~1 cm
# vertex spacing), the PRIMARY FOLD FIELD (2a_folds.py), then Multires for the strokes, sculpt symmetry X
import bpy
object_mode()
win, area, region = view3d()
for name in ('Pants', 'Sweatshirt'):
    ob = bpy.data.objects[name]
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
        for x in bpy.context.view_layer.objects: x.select_set(x == ob)
        bpy.context.view_layer.objects.active = ob
        if ob.modifiers.get('Mirror'):
            bpy.ops.object.modifier_apply(modifier='Mirror')
        if ob.modifiers.get('Multires'): bpy.ops.object.modifier_remove(modifier='Multires')
        sd = ob.modifiers.new('Subdiv', 'SUBSURF'); sd.levels = 1; sd.subdivision_type = 'CATMULL_CLARK'
        bpy.ops.object.modifier_apply(modifier='Subdiv')
    print(name, 'base verts', len(ob.data.vertices))
