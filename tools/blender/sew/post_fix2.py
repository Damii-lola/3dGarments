"""
post_fix2.py — targeted removal of CDT fill triangles stretched by cloth sim.

Strategy: any shirt face whose centroid is either
  (a) more than HEM_MARGIN below the hem line (z < groin + 0.01 - HEM_MARGIN), or
  (b) farther than MAX_BODY_DIST from any body skin vertex in the shirt zone,
is a "wing" face — deleted.  Everything else stays.

After deletion:
  • isolated face patches < SMALL_PATCH verts are removed
  • normals recalculated with per-face body-axis outward check (then majority vote)
  • 8-pass iron, 10-pass boundary smooth
  • saved back to Male_Tee_Shirt.obj

  blender -b -P tools/blender/sew/post_fix2.py
"""
import bpy, bmesh, os, json, math
from mathutils import Vector

D   = os.path.expanduser('~/.3dg-sew')
SRC = os.path.join(D, 'Male_Tee_Shirt.obj')

MAX_BODY_DIST = 0.15   # 15 cm — shirt faces should never be farther than this from skin
HEM_MARGIN    = 0.045  # 4.5 cm below hem z is always wrong
SMALL_PATCH   = 60     # face-count; isolated patches smaller than this are debris

# ── load body reference ────────────────────────────────────────────────────────
meta  = json.load(open(os.path.join(D, 'body_rest.json')))
L, part, joints = meta['L'], meta['part'], meta['joints']
hem_z = L['groin'] + 0.01
sh_z  = float(Vector(joints['upperarm_l'][0]).z) + 0.08  # rough shoulder top
print(f'[fix2] hem_z={hem_z:.3f}  sh_z={sh_z:.3f}')

raw_body = []
with open(os.path.join(D, 'body_rest.obj')) as f:
    for line in f:
        if line.startswith('v '):
            raw_body.append(tuple(map(float, line.split()[1:4])))

# keep only skin vertices that are in the shirt zone
skin = []
EXCL = ('hand_','thumb','index','middle','ring','pinky','thigh','calf_','foot_','ball_','head')
for i, (x, y, z) in enumerate(raw_body):
    if i >= len(part) or part[i] != 0:
        continue
    b = meta['dom'][i] if i < len(meta['dom']) else ''
    if any(e in b for e in EXCL):
        continue
    skin.append(Vector((x, y, z)))

print(f'[fix2] {len(skin)} body skin reference verts in shirt zone')

# grid-based nearest-vert lookup
CELL = 0.05
grid = {}
for v in skin:
    k = (int(v.x / CELL), int(v.y / CELL), int(v.z / CELL))
    grid.setdefault(k, []).append(v)

REACH = 4  # search ±4 cells = ±20 cm

def nearest_body(co):
    gx, gy, gz = int(co.x / CELL), int(co.y / CELL), int(co.z / CELL)
    best = MAX_BODY_DIST + 0.001
    for dx in range(-REACH, REACH + 1):
        for dy in range(-REACH, REACH + 1):
            for dz in range(-REACH, REACH + 1):
                bucket = grid.get((gx+dx, gy+dy, gz+dz))
                if bucket:
                    for sv in bucket:
                        d = (co - sv).length
                        if d < best:
                            best = d
    return best

# ── load shirt ─────────────────────────────────────────────────────────────────
Verts, Faces = [], []
with open(SRC) as f:
    for line in f:
        if line.startswith('v '):
            Verts.append(tuple(map(float, line.split()[1:4])))
        elif line.startswith('f '):
            Faces.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])

print(f'[fix2] shirt {len(Verts)} verts  {len(Faces)} faces')

bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('tee')
me.from_pydata(Verts, [], Faces)
me.update()

bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()

# ── 1. delete wing faces ───────────────────────────────────────────────────────
wings = []
for f in bm.faces:
    c = f.calc_center_median()
    if c.z < hem_z - HEM_MARGIN:
        wings.append(f); continue
    if nearest_body(c) > MAX_BODY_DIST:
        wings.append(f)

print(f'[fix2] {len(wings)} wing faces to remove (of {len(bm.faces)} total)')
bmesh.ops.delete(bm, geom=wings, context='FACES')
bm.faces.ensure_lookup_table()
bm.verts.ensure_lookup_table()

# ── 2. remove isolated face patches ───────────────────────────────────────────
def cf(bm, start):
    seen = {start}; q = [start]
    while q:
        ff = q.pop()
        for e in ff.edges:
            for lf in e.link_faces:
                if lf not in seen:
                    seen.add(lf); q.append(lf)
    return seen

visited, comps = set(), []
for f in bm.faces:
    if f not in visited:
        c = cf(bm, f); comps.append(c); visited.update(c)

comps.sort(key=len, reverse=True)
junk = [f for c in comps[1:] for f in c if len(c) < SMALL_PATCH]
if junk:
    print(f'[fix2] removing {len(junk)} faces in {sum(1 for c in comps[1:] if len(c)<SMALL_PATCH)} small patches')
    bmesh.ops.delete(bm, geom=junk, context='FACES')

bm.faces.ensure_lookup_table()
bm.verts.ensure_lookup_table()

# remove loose verts left behind
lone = [v for v in bm.verts if not v.link_faces]
if lone:
    bmesh.ops.delete(bm, geom=lone, context='VERTS')
bm.verts.ensure_lookup_table()

# ── 3. recalculate normals with body-axis outward check ───────────────────────
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
# vote: does the majority of faces point away from (0, 0, face_z)?
sample = list(bm.faces)[:min(400, len(bm.faces))]
outward = sum(1 for f in sample
              if f.normal.dot(f.calc_center_median() - Vector((0, 0, f.calc_center_median().z))) > 0)
if outward < len(sample) / 2:
    print(f'[fix2] normals were inward ({outward}/{len(sample)}) — reversing all')
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
else:
    print(f'[fix2] normals OK ({outward}/{len(sample)} outward)')

# per-face check: flip individual faces that still point inward
# do a second pass of recalc_face_normals after the global flip, then re-check per face
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

# find per-face inliers vs outliers by local neighbourhood:
# build edge-face adjacency for connected patches
face_normal_ok = {}
for f in bm.faces:
    c = f.calc_center_median()
    outdir = c - Vector((0.0, 0.0, c.z))
    face_normal_ok[f] = f.normal.dot(outdir) >= 0

# flip consistent wrong-facing patches
visited2 = set()
for f in bm.faces:
    if f in visited2 or face_normal_ok.get(f, True):
        continue
    # BFS wrong-facing connected region
    patch = {f}; q = [f]
    while q:
        cur = q.pop()
        for e in cur.edges:
            for lf in e.link_faces:
                if lf not in patch and not face_normal_ok.get(lf, True):
                    patch.add(lf); q.append(lf)
    visited2.update(patch)
    print(f'[fix2] flipping inward patch of {len(patch)} faces')
    bmesh.ops.reverse_faces(bm, faces=list(patch))

# ── 4. iron: Laplacian over non-boundary verts ────────────────────────────────
bm.edges.ensure_lookup_table()
boundary_v = {v for e in bm.edges if e.is_boundary for v in e.verts}
inner = [v for v in bm.verts if v not in boundary_v]
print(f'[fix2] ironing {len(inner)} inner verts + {len(boundary_v)} boundary verts')
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
    if len(loop) > 4:
        loops.append(loop)

print(f'[fix2] smoothing {len(loops)} boundary loops')
for _ in range(12):
    for lp in loops:
        m = len(lp)
        P = [v.co.copy() for v in lp]
        for k in range(m):
            lp[k].co = P[k] * 0.5 + (P[k-1] + P[(k+1)%m]) * 0.25

# 2-ring inner band next to boundaries
inner_band = set()
for lp in loops:
    cur = set(lp)
    for _ in range(2):
        nxt = {e.other_vert(v) for v in cur for e in v.link_edges} - cur
        inner_band |= {v for v in nxt if v not in boundary_v}
        cur |= nxt
if inner_band:
    bmesh.ops.smooth_vert(bm, verts=list(inner_band), factor=0.4,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)

# final normal recalc
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
sample2 = list(bm.faces)[:min(400, len(bm.faces))]
ow2 = sum(1 for f in sample2
          if f.normal.dot(f.calc_center_median() - Vector((0,0,f.calc_center_median().z))) > 0)
if ow2 < len(sample2) / 2:
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))

bm.to_mesh(me)
bm.free()
me.update()

# ── write ──────────────────────────────────────────────────────────────────────
with open(SRC, 'w') as f:
    for v in me.vertices:
        f.write('v %.6f %.6f %.6f\n' % tuple(v.co))
    for p in me.polygons:
        f.write('f ' + ' '.join(str(i + 1) for i in p.vertices) + '\n')

print(f'[fix2] done → {SRC}  ({len(me.vertices)} verts  {len(me.polygons)} faces)')
