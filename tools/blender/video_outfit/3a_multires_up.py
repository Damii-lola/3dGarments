# STEP 3 setup: Multires one level up for detail (video 8:15: level 4-5 on a lighter mesh; ours is denser)
object_mode()
win, area, region = view3d()
for name in ('Pants', 'Sweatshirt'):
    ob = bpy.data.objects[name]
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
        for x in bpy.context.view_layer.objects: x.select_set(x == ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.multires_subdivide(modifier='Multires', mode='CATMULL_CLARK')
    m = ob.modifiers['Multires']; m.sculpt_levels = m.levels = m.total_levels
    print(name, 'multires', m.total_levels)
