ob = bpy.data.objects['Sweatshirt']
sh = STATE['shirt']; S, E, W = Vector(sh['S']), Vector(sh['E']), Vector(sh['W'])
fa = (W - E).normalized(); flen = (W - E).length
look(E + fa * (flen * 0.6), (0, 1, 0), 0.75)
ts = [flen * 0.92 - 0.085 - k * 0.046 for k in range(4)]
print('queued', bunch(ob, E, fa, ts, 0.08, Vector((0, 1, 0)), ridge_r=38, valley_r=26, strength=0.85, seed=7, smooth_r=40))
