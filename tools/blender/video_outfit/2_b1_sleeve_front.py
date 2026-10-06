ob = bpy.data.objects['Sweatshirt']
reset_multires(ob)
sh = STATE['shirt']; S, E, W = Vector(sh['S']), Vector(sh['E']), Vector(sh['W'])
fa = (W - E).normalized(); flen = (W - E).length
look(E + fa * (flen * 0.6), (0, -1, 0), 0.75)
ts = [flen * 0.92 - 0.08 - k * 0.047 for k in range(4)]          # 4 big rings stacked above the cuff
n = bunch(ob, E, fa, ts, 0.08, Vector((0, -1, 0)), ridge_r=38, valley_r=26, strength=0.85, seed=3, smooth_r=40)
print('queued forearm bunch:', n, 'points')
