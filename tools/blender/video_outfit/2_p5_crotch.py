# soft drag folds from the crotch down the inner thigh (front)
ob = bpy.data.objects['Pants']; L = STATE['L']; cz = L['crotch']
look(Vector((0.08, 0, cz)), (0, -1, 0), 0.8)
q = 0
for (a, b2, ctrl, r) in (((0.02, cz + 0.02), (0.11, cz - 0.14), True, 20), ((0.04, cz + 0.05), (0.14, cz - 0.1), False, 28)):
    pts = [Vector((a[0] + (b2[0] - a[0]) * k / 14, -0.3, a[1] + (b2[1] - a[1]) * k / 14)) for k in range(15)]
    q += sculpt_drag_q(ob, 'Draw', pts, radius=r, strength=0.45, ctrl=ctrl)
print('queued', q)
