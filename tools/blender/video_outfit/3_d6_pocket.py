ob = bpy.data.objects['Pants']
look(Vector((0.08, 0, 0.8)), (0, -1, 0), 0.8)
path = [Vector((0.075 + 0.05 * (k / 13) ** 0.8, -0.4, 0.84 - 0.115 * (k / 13))) for k in range(14)]
q = seam(ob, path, radius=20, strength=0.9)
q += seam(ob, path, radius=11, strength=0.4, ctrl=True)
print('queued', q)
