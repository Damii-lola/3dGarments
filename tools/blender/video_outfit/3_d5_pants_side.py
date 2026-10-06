ob = bpy.data.objects['Pants']; L = STATE['L']; ankle = L['bottom'] + 0.075
top = max(v.co.z for v in ob.data.vertices)
look(Vector((0.15, 0.0, 0.55)), (1, 0, 0), 1.6)
q = seam(ob, [Vector((0.5, 0.01, top - 0.05 - (top - 0.05 - ankle - 0.07) * k / 29)) for k in range(30)])   # outer side seam
q += seam(ob, [Vector((0.5, y, top - 0.045)) for y in [-0.13 + 0.26 * k / 15 for k in range(16)]])                       # waistband seam (side)
print('queued', q)
