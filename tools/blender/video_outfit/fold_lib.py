# fold strokes (exec'd in the live session before each batch): rings across a limb as seen from the current view
import bpy, math
from mathutils import Vector
def sculpt_drag_q(ob, brush, points, **kw):
    stroke_queue_add(ob=ob.name, brush=brush, points=[tuple(p) for p in points], **kw)
    return len(points)
def ring_points(c, axis, half, view_dir, wave=0.005, n=24, phase=0.0):
    """points across a limb at c (axis = limb direction), spanning ±half in the view plane, slightly wavy"""
    u = axis.cross(view_dir).normalized()
    return [c + u * (half * (2 * k / (n - 1) - 1)) + axis * (wave * math.sin(phase + k * 0.7)) for k in range(n)]
def rings(ob, start, axis, ts, half, view_dir, radius, strength, valleys=True, wave=0.005):
    """ridges at ts (m along the axis from start) and valleys half way between them (Ctrl)"""
    q = 0
    for k, t in enumerate(ts):
        q += sculpt_drag_q(ob, 'Draw', ring_points(start + axis * t, axis, half, view_dir, wave, phase=k), radius=radius, strength=strength)
        if valleys and k + 1 < len(ts):
            tm = (t + ts[k + 1]) / 2
            q += sculpt_drag_q(ob, 'Draw', ring_points(start + axis * tm, axis, half, view_dir, wave, phase=k + 0.5), radius=radius, strength=strength, ctrl=True)
    return q
def reset_multires(ob, levels=2):
    """drop the sculpted displacement: a fresh Multires at `levels`"""
    object_mode()
    win, area, region = view3d()
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, object=ob, active_object=ob):
        for x in bpy.context.view_layer.objects: x.select_set(x == ob)
        bpy.context.view_layer.objects.active = ob
        if ob.modifiers.get('Multires'): bpy.ops.object.modifier_remove(modifier='Multires')
        ob.modifiers.new('Multires', 'MULTIRES')
        for k in range(levels): bpy.ops.object.multires_subdivide(modifier='Multires', mode='CATMULL_CLARK')
def tilted_ring(c, axis, half, view_dir, tilt, wave, phase, n=20):
    import mathutils
    ax = mathutils.Matrix.Rotation(tilt, 3, view_dir) @ axis
    return ring_points(c, ax, half, view_dir, wave, n, phase)
def bunch(ob, start, axis, ts, half, view_dir, ridge_r=44, valley_r=30, strength=0.55, seed=1, smooth_r=70):
    """the video's primary folds: a few big soft rings, uneven and tilted, deep valleys, then softened (Shift)"""
    import random
    rnd = random.Random(seed); q = 0
    for k, t in enumerate(ts):
        tilt = rnd.uniform(-0.25, 0.25)
        q += sculpt_drag_q(ob, 'Draw', tilted_ring(start + axis * t, axis, half, view_dir, tilt, 0.006, rnd.uniform(0, 6)), radius=ridge_r, strength=strength)
        if k + 1 < len(ts):
            tm = (t + ts[k + 1]) / 2 + rnd.uniform(-0.004, 0.004)
            q += sculpt_drag_q(ob, 'Draw', tilted_ring(start + axis * tm, axis, half * 0.9, view_dir, tilt + rnd.uniform(-0.1, 0.1), 0.005, rnd.uniform(0, 6)), radius=valley_r, strength=strength * 0.65, ctrl=True)
    a, b = start + axis * (min(ts) - 0.02), start + axis * (max(ts) + 0.02)
    q += sculpt_drag_q(ob, 'Draw', [a + (b - a) * (k / 12) for k in range(13)], radius=smooth_r, strength=0.12, shift=True)
    return q
def seam(ob, pts, radius=18, strength=0.7, ctrl=False):
    """a seam line, Crease Polish with Stabilize Stroke (video 8:30-9:40)"""
    return sculpt_drag_q(ob, 'Crease Polish', pts, radius=radius, strength=strength, ctrl=ctrl, stabilize=False)
def hline(z, x0, x1, y, n=24):
    return [Vector((x0 + (x1 - x0) * k / (n - 1), y, z)) for k in range(n)]
