ob = bpy.data.objects['Sweatshirt']; hem = STATE['shirt']['hem']
look(Vector((0.2, 0.03, 1.1)), (1, 0, 0), 1.0)
q = seam(ob, [Vector((0.4, 0.035, hem + 0.065 + (1.36 - hem - 0.065) * k / 19)) for k in range(20)])   # side seam
q += seam(ob, [Vector((0.4, y, hem + 0.06)) for y in [-0.14 + 0.3 * k / 19 for k in range(20)]])      # hem band seam
print('queued', q)
