# STEP 2 setup (video 6:45-7:05): apply the Mirror, Multires + Subdivide ×2, sculpt symmetry X
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
        mr = ob.modifiers.get('Multires') or ob.modifiers.new('Multires', 'MULTIRES')
        for k in range(2):
            bpy.ops.object.multires_subdivide(modifier='Multires', mode='CATMULL_CLARK')
        mr.sculpt_levels = mr.levels = mr.render_levels = 2
    ob.data.use_mirror_x = True               # sculpt symmetry X (the video sculpts both sides at once)
    print(name, 'base verts', len(ob.data.vertices), 'multires levels', ob.modifiers['Multires'].total_levels)
