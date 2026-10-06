# the body blousing over the rib band: a deep valley just above the band, a soft ridge over it (video 7:00-7:30)
ob = bpy.data.objects['Sweatshirt']; hem = STATE['shirt']['hem']
look(Vector((0, 0, hem + 0.15)), (0, 1, 0), 1.0)
up = Vector((0, 0, 1)); vd = Vector((0, 1, 0))
q = sculpt_drag_q(ob, 'Draw', ring_points(Vector((0, 0, hem + 0.068)), up, 0.24, vd, 0.006, 26), radius=26, strength=0.9, ctrl=True)
q += sculpt_drag_q(ob, 'Draw', ring_points(Vector((0, 0, hem + 0.095)), up, 0.23, vd, 0.008, 26, 1.0), radius=40, strength=0.6)
print('queued', q)
