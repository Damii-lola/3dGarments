ob = bpy.data.objects['Sweatshirt']; sh = STATE['shirt']; hem = sh['hem']
S, E, W = Vector(sh['S']), Vector(sh['E']), Vector(sh['W'])
look(Vector((0, 0, 1.1)), (0, -1, 0), 1.25)
q = seam(ob, hline(hem + 0.06, -0.24, 0.24, -0.4))                    # hem band seam
ua = (E - S).normalized(); fa = (W - E).normalized()
q += seam(ob, ring_points(S + ua * 0.03, ua, 0.09, Vector((0, -1, 0)), 0.0, 20))     # dropped shoulder seam
cuff = E + fa * ((W - E).length * 0.92 - 0.06)
q += seam(ob, ring_points(cuff, fa, 0.06, Vector((0, -1, 0)), 0.0, 16))  # cuff seam
print('queued', q)
