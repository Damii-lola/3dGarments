# STEP 4 (video 11:00-12:50): Solidify (shell/rim groups) → Smooth on rim → Shade Smooth → Smooth on shell
object_mode()
for name in ('Pants', 'Sweatshirt'):
    ob = bpy.data.objects[name]
    for g in ('shell', 'rim'):
        if not ob.vertex_groups.get(g): ob.vertex_groups.new(name=g)
    for m in [m for m in ob.modifiers if m.type in ('SOLIDIFY', 'SMOOTH')]: ob.modifiers.remove(m)
    so = ob.modifiers.new('Solidify', 'SOLIDIFY')
    so.solidify_mode = 'EXTRUDE'; so.thickness = 0.005; so.offset = -1.0; so.use_rim = True
    so.shell_vertex_group = 'shell'; so.rim_vertex_group = 'rim'
    s1 = ob.modifiers.new('Smooth', 'SMOOTH'); s1.factor = 0.5; s1.iterations = 7; s1.vertex_group = 'rim'
    s2 = ob.modifiers.new('Smooth.001', 'SMOOTH'); s2.factor = 0.5; s2.iterations = 9; s2.vertex_group = 'shell'
    for p in ob.data.polygons: p.use_smooth = True
    ob.data.update()
    print(name, [m.type for m in ob.modifiers])
look(Vector((0, 0, 1.0)), (0.5, -1, 0.12), 2.4)
