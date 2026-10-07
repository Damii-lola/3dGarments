"""
post_fix.py — headless cleanup pass on Male_Tee_Shirt.obj:
  1. Remove disconnected fragments (cloth-sim debris)
  2. Dissolve degenerate edges/faces
  3. Recalculate normals outward (away from mesh centroid)
  4. Iron: light Laplacian over non-boundary verts to kill fine noise
  5. Smooth boundary loops (hem, sleeve ends, neckband)
  6. Overwrite Male_Tee_Shirt.obj

  blender -b -P tools/blender/sew/post_fix.py
"""
import bpy, bmesh, os
from mathutils import Vector

D   = os.path.expanduser('~/.3dg-sew')
SRC = os.path.join(D, 'Male_Tee_Shirt.obj')
OUT = SRC  # overwrite in place

print(f'[fix] loading {SRC}')
Verts, Faces = [], []
with open(SRC) as f:
    for line in f:
        if line.startswith('v '):
            Verts.append(tuple(map(float, line.split()[1:4])))
        elif line.startswith('f '):
            Faces.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])

print(f'[fix] loaded {len(Verts)} verts  {len(Faces)} faces')

bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('tee')
me.from_pydata(Verts, [], Faces)
me.update()

bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
bm.edges.ensure_lookup_table()
bm.faces.ensure_lookup_table()

# ── 1. remove disconnected components ─────────────────────────────────────────
def connected(bm, start):
    seen = {start}; q = [start]
    while q:
        v = q.pop()
        for e in v.link_edges:
            o = e.other_vert(v)
            if o not in seen:
                seen.add(o); q.append(o)
    return seen

visited = set()
components = []
for v in bm.verts:
    if v not in visited:
        c = connected(bm, v)
        components.append(c)
        visited.update(c)

components.sort(key=len, reverse=True)
if len(components) > 1:
    junk_count = sum(len(c) for c in components[1:])
    junk_verts = [v for c in components[1:] for v in c]
    print(f'[fix] removing {len(components)-1} stray component(s) ({junk_count} verts)')
    bmesh.ops.delete(bm, geom=junk_verts, context='VERTS')
else:
    print('[fix] mesh is already one component')

bm.verts.ensure_lookup_table()

# ── 2. dissolve degenerate ─────────────────────────────────────────────────────
before = len(bm.faces)
bmesh.ops.dissolve_degenerate(bm, dist=0.0002, edges=list(bm.edges))
print(f'[fix] dissolve degenerate: {before - len(bm.faces)} faces removed')

# ── 3. recalculate normals outward ─────────────────────────────────────────────
# enforce consistency
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
# check orientation: most face normals should point AWAY from the mesh centroid
centroid = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
sample = list(bm.faces)[:min(200, len(bm.faces))]
outward = sum(1 for f in sample if f.normal.dot(f.calc_center_median() - centroid) > 0)
if outward < len(sample) / 2:
    print('[fix] normals were flipped inward — reversing all')
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
else:
    print(f'[fix] normals OK ({outward}/{len(sample)} outward)')

# ── 4. iron: light Laplacian over non-boundary verts ──────────────────────────
bm.edges.ensure_lookup_table()
boundary_verts = {v for e in bm.edges if e.is_boundary for v in e.verts}
inner = [v for v in bm.verts if v not in boundary_verts]
print(f'[fix] ironing {len(inner)} inner verts (8 passes, factor 0.25)')
for _ in range(8):
    bmesh.ops.smooth_vert(bm, verts=inner, factor=0.25,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)

# ── 5. smooth boundary loops ───────────────────────────────────────────────────
adj = {}
for e in bm.edges:
    if e.is_boundary:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
seen, loops = set(), []
for v in list(adj):
    if v in seen: continue
    loop = [v]; seen.add(v); prev, cur = None, v
    while True:
        nxt = [u for u in adj.get(cur, []) if u is not prev and u not in seen]
        if not nxt: break
        prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
    loops.append(loop)

long_loops = [l for l in loops if len(l) > 8]
print(f'[fix] smoothing {len(long_loops)} boundary loop(s)')
for _ in range(10):
    for loop in long_loops:
        m = len(loop)
        P = [v.co.copy() for v in loop]
        for k in range(m):
            loop[k].co = P[k] * 0.5 + (P[k-1] + P[(k+1)%m]) * 0.25

# 2 inner rings next to boundaries follow
inner_band = set()
for loop in long_loops:
    cur = set(loop)
    for _ in range(2):
        nxt = {e.other_vert(v) for v in cur for e in v.link_edges} - cur
        inner_band |= {v for v in nxt if not v.is_boundary}
        cur |= nxt
if inner_band:
    bmesh.ops.smooth_vert(bm, verts=list(inner_band), factor=0.4,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)

# ── 6. recalc once more after smoothing ───────────────────────────────────────
for f in bm.faces: f.smooth = True
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
if outward < len(sample) / 2:
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))

bm.to_mesh(me)
bm.free()
me.update()

# ── 7. write OBJ ──────────────────────────────────────────────────────────────
with open(OUT, 'w') as f:
    for v in me.vertices:
        f.write('v %.6f %.6f %.6f\n' % tuple(v.co))
    for p in me.polygons:
        f.write('f ' + ' '.join(str(i + 1) for i in p.vertices) + '\n')

print(f'[fix] done → {OUT}  ({len(me.vertices)} verts  {len(me.polygons)} faces)')
