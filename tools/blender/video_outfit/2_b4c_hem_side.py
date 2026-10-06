ob = bpy.data.objects['Sweatshirt']; hem = STATE['shirt']['hem']
look(Vector((0.18, 0.04, hem + 0.15)), (1, 0, 0), 0.9)
up = Vector((0, 0, 1)); vd = Vector((1, 0, 0))
q = sculpt_drag_q(ob, 'Draw', [Vector((0.2, y, hem + 0.068)) for y in [ -0.14 + 0.28 * k / 19 for k in range(20)]], radius=26, strength=0.9, ctrl=True)
q += sculpt_drag_q(ob, 'Draw', [Vector((0.2, y, hem + 0.095)) for y in [ -0.13 + 0.26 * k / 19 for k in range(20)]], radius=40, strength=0.6)
print('queued', q)
