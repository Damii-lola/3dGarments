ob = bpy.data.objects['Pants']; L = STATE['L']; ankle = L['bottom'] + 0.075
top = max(v.co.z for v in ob.data.vertices)
look(Vector((0.08, 0, 0.75)), (0, -1, 0), 1.0)
q = seam(ob, hline(top - 0.045, -0.2, 0.2, -0.4))                                    # waistband seam
q += seam(ob, [Vector((0.135 + 0.045 * k / 13, -0.4, 0.835 - 0.12 * (k / 13) ** 1.3)) for k in range(14)], radius=20, strength=0.8)   # pocket slash
q += seam(ob, [Vector((0.135 + 0.045 * k / 13, -0.4, 0.835 - 0.12 * (k / 13) ** 1.3)) for k in range(14)], radius=12, strength=0.6, ctrl=True)  # deepened (Ctrl)
look(Vector((0.08, 0, ankle + 0.1)), (0, -1, 0), 0.8)
q += seam(ob, hline(ankle + 0.062, 0.02, 0.16, -0.4, 16))                # cuff seam
print('queued', q)
