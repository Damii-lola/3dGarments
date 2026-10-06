ob = bpy.data.objects['Pants']; L = STATE['L']; ankle = L['bottom'] + 0.075
kz = ankle + (L['crotch'] - ankle) * 0.5
pts = [v.co for v in ob.data.vertices if abs(v.co.z - kz) < 0.01 and v.co.x > 0]
c = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), kz))
look(c, (0, -1, 0), 0.8)
print('queued', bunch(ob, c, Vector((0, 0, 1)), [-0.025, 0.03], 0.085, Vector((0, -1, 0)), ridge_r=34, valley_r=22, strength=0.45, seed=31, smooth_r=36))
