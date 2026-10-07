# (live session) load the Male_Tee_Shirt template OBJ into the Garments collection → streams to site.
# STATE['load'] = list of (name, path, colour)
import os
for o in list(bpy.data.collections['Garments'].objects):
    bpy.data.objects.remove(o)
for name, path, color in STATE.get('load', []):
    V, F = [], []
    for line in open(os.path.expanduser(path)):
        if line.startswith('v '): V.append(tuple(map(float, line.split()[1:4])))
        elif line.startswith('f '): F.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
    me = bpy.data.meshes.new(name); me.from_pydata(V, [], F); me.update()
    for p in me.polygons: p.use_smooth = True
    ob = new_garment(name, me, color=color); ob.color = (*color, 1)
    print('loaded', name, len(V), 'verts')
STATE['space'] = 'rest'
push()
