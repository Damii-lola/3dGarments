# drag folds from the armpits across the chest/back (video 7:10)
ob = bpy.data.objects['Sweatshirt']
q = 0
for vd, y in (((0, -1, 0), -0.2), ((0, 1, 0), 0.3)):
    look(Vector((0.1, 0, 1.25)), vd, 0.9)
    break
for (a, b2, ctrl, r) in (((0.19, 1.37), (0.09, 1.14), True, 22), ((0.185, 1.33), (0.11, 1.08), False, 30), ((0.2, 1.31), (0.15, 1.05), True, 20)):
    pts = [Vector((a[0] + (b2[0] - a[0]) * k / 14, -0.3, a[1] + (b2[1] - a[1]) * k / 14)) for k in range(15)]
    q += sculpt_drag_q(ob, 'Draw', pts, radius=r, strength=0.55, ctrl=ctrl)
print('queued', q)
