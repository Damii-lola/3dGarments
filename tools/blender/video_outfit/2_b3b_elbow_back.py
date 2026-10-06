ob = bpy.data.objects['Sweatshirt']
sh = STATE['shirt']; S, E, W = Vector(sh['S']), Vector(sh['E']), Vector(sh['W'])
ua = (E - S).normalized()
look(E, (0, 1, 0), 0.8)
print('queued', bunch(ob, S, ua, [(E - S).length - 0.03, (E - S).length + 0.03], 0.08, Vector((0, 1, 0)), ridge_r=34, valley_r=24, strength=0.55, seed=13, smooth_r=36))
