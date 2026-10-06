"""
Sewing clothes on the body in Blender, the way KNOWLEDGE.md §1 lays it out: flat pattern pieces → placed around the
body → sewn (sewing springs) → welded → settled by the cloth simulation. Headless (blender -b), Blender coordinates:
metres, z up, the body faces −y, its left is +x. The body is the site's own in the rig's rest pose (export_body.py).

A piece is an outline in its own flat (u, v) coordinates, split into NAMED edges (each a polyline). It's meshed with a
constrained Delaunay triangulation of a regular grid inside it (spacing `h`), boundary points spaced evenly along each
edge, so two edges sewn together get matching vertex counts. place(u, v) puts every vertex around the body.
"""
import bpy, bmesh, json, math, os
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt
from mathutils.bvhtree import BVHTree


# ------------------------------------------------------------------------------------------------- the body
def load_body(d):
    """the exported rest body as a collider; returns (object, meta, bvh)"""
    meta = json.load(open(os.path.join(d, 'body_rest.json')))
    V, F = [], []
    for line in open(os.path.join(d, 'body_rest.obj')):
        if line.startswith('v '): V.append(tuple(map(float, line.split()[1:4])))
        elif line.startswith('f '): F.append([int(t) - 1 for t in line.split()[1:]])
    me = bpy.data.meshes.new('body'); me.from_pydata(V, [], F); me.update()
    ob = bpy.data.objects.new('body', me); bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('collision', 'COLLISION')
    c = ob.collision
    c.thickness_outer = 0.002; c.thickness_inner = 0.02; c.cloth_friction = 15.0; c.damping = 0.3
    c.use_culling = False
    bvh = BVHTree.FromPolygons([Vector(v) for v in V], F)
    meta['V'] = V; meta['F'] = F
    return ob, meta, bvh


def joint(meta, name, end=0):
    return Vector(meta['joints'][name][end])


def hull2(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0: h.pop()
            h.append(q)
        return h
    lo, hi = half(pts), half(list(reversed(pts)))
    return lo[:-1] + hi[:-1]


def body_slice(meta, z, keep=lambda i: True):
    """points where the body's edges cross the plane z (x, y), from vertices that pass keep(i)"""
    V = meta['V']; out = []
    for f in meta['F']:
        for k in range(len(f)):
            i, j = f[k], f[(k + 1) % len(f)]
            if i > j or not (keep(i) and keep(j)): continue
            a, b = V[i], V[j]
            if (a[2] - z) * (b[2] - z) <= 0 and a[2] != b[2]:
                t = (z - a[2]) / (b[2] - a[2]); out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def perimeter(poly):
    return sum(math.dist(poly[k], poly[(k + 1) % len(poly)]) for k in range(len(poly)))


class Section:
    """a closed convex outline (x, y) at one height, pushed out by `ease` from its centre, walked by arc length from
    its centre-front (−y) or centre-back (+y) point; + arc goes toward +x"""
    def __init__(self, hull, ease):
        cx = sum(p[0] for p in hull) / len(hull); cy = sum(p[1] for p in hull) / len(hull)
        self.c = (cx, cy)
        pts = []
        for x, y in hull:
            dx, dy = x - cx, y - cy; r = math.hypot(dx, dy) or 1
            pts.append((cx + dx * (r + ease) / r, cy + dy * (r + ease) / r))
        # densify, order by angle increasing toward +x from the front: angle = atan2(x, −y)
        dense = []
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            n = max(1, int(math.dist(a, b) / 0.004))
            for t in range(n): dense.append((a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n))
        ang = lambda p: math.atan2(p[0] - cx, -(p[1] - cy))
        dense.sort(key=ang)
        self.pts = dense
        self.ang = [ang(p) for p in dense]
        self.cum = [0.0]
        for k in range(1, len(dense) + 1): self.cum.append(self.cum[-1] + math.dist(dense[k - 1], dense[k % len(dense)]))
        self.P = self.cum[-1]

    def _at_angle(self, a):
        """index-fraction of the point at angle a (−π..π)"""
        A = self.ang
        for k in range(len(A)):
            a0, a1 = A[k], (A[(k + 1) % len(A)] + (2 * math.pi if k + 1 == len(A) else 0))
            aa = a if a >= A[0] else a + 2 * math.pi
            if a0 <= aa <= a1: return k + (aa - a0) / ((a1 - a0) or 1)
        return 0.0

    def point(self, s, back=False, clamp=math.radians(100)):
        """the point at arc length s from the centre front (or back), + toward +x; past ±clamp off the centre it
        leaves the outline along its tangent"""
        k0 = self._at_angle(math.pi if back else 0.0)
        s0 = self.cum[int(k0)] + (k0 - int(k0)) * (self.cum[int(k0) + 1] - self.cum[int(k0)])
        # + toward +x: from the front that's increasing angle; from the back it's decreasing angle
        target = s0 + (s if not back else -s)
        tw = target % self.P
        k = max(0, min(len(self.pts) - 1, next((i for i in range(len(self.cum) - 1) if self.cum[i + 1] >= tw), len(self.pts) - 1)))
        t = (tw - self.cum[k]) / ((self.cum[k + 1] - self.cum[k]) or 1)
        a, b = self.pts[k], self.pts[(k + 1) % len(self.pts)]
        p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        ang = math.atan2(p[0] - self.c[0], -(p[1] - self.c[1])) - (math.pi if back else 0.0)
        ang = (ang + math.pi) % (2 * math.pi) - math.pi
        if abs(ang) > clamp:                                     # past the clamp: go on along the tangent there
            sc = self._arc_at(clamp if ang > 0 else -clamp, back)
            pc = self.point(sc, back, clamp=10)
            pn = self.point(sc - 0.002 * (1 if sc > 0 else -1), back, clamp=10)
            d = ((pc[0] - pn[0]) / 0.002, (pc[1] - pn[1]) / 0.002)
            extra = abs(s) - abs(sc)
            return (pc[0] + d[0] * extra, pc[1] + d[1] * extra)
        return p

    def _arc_at(self, ang, back):
        """signed arc from the centre front/back to the point at angle ang off it"""
        lo, hi = 0.0, self.P / 2
        sgn = 1 if ang > 0 else -1
        for _ in range(40):
            mid = (lo + hi) / 2
            p = self.point(sgn * mid, back, clamp=10)
            a = math.atan2(p[0] - self.c[0], -(p[1] - self.c[1])) - (math.pi if back else 0.0)
            a = (a + math.pi) % (2 * math.pi) - math.pi
            if abs(a) < abs(ang): lo = mid
            else: hi = mid
        return sgn * lo


# ------------------------------------------------------------------------------------------------- pieces
def polyline(points, n=None, h=0.015):
    """resample a polyline (list of (u, v)) to n+1 evenly spaced points (n from spacing h if not given)"""
    L = [0.0]
    for k in range(1, len(points)): L.append(L[-1] + math.dist(points[k - 1], points[k]))
    n = n or max(1, round(L[-1] / h))
    out = []
    for i in range(n + 1):
        t = L[-1] * i / n
        k = max(0, min(len(points) - 2, next((j for j in range(len(L) - 1) if L[j + 1] >= t), len(points) - 2)))
        f = (t - L[k]) / ((L[k + 1] - L[k]) or 1)
        a, b = points[k], points[k + 1]
        out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    return out


def curve_len(points):
    return sum(math.dist(points[k - 1], points[k]) for k in range(1, len(points)))


class Piece:
    """edges: list of (name, polyline) going round the outline in order (each starts where the last ended)"""
    def __init__(self, name, edges, h=0.02, counts=None):
        self.name = name; self.h = h
        counts = counts or {}
        self.edges = []          # (name, [boundary vertex indices into self.uv])
        self.uv = []
        ring = []
        for ename, pts in edges:
            rs = polyline(pts, counts.get(ename), h)
            idx = []
            for k, p in enumerate(rs):
                if k == len(rs) - 1:
                    idx.append(None)                             # (the next edge's first point)
                    continue
                self.uv.append(p); idx.append(len(self.uv) - 1); ring.append(len(self.uv) - 1)
            self.edges.append([ename, idx])
        # close each edge onto the next edge's first vertex
        for k, (ename, idx) in enumerate(self.edges):
            idx[-1] = self.edges[(k + 1) % len(self.edges)][1][0]
        self.ring = ring
        # interior: a regular grid, kept ≥ 0.6 h inside the outline
        poly = [self.uv[i] for i in ring]
        us = [p[0] for p in poly]; vs = [p[1] for p in poly]
        def inside(p):
            c = False
            for k in range(len(poly)):
                (x1, y1), (x2, y2) = poly[k], poly[(k + 1) % len(poly)]
                if (y1 > p[1]) != (y2 > p[1]) and p[0] < (x2 - x1) * (p[1] - y1) / ((y2 - y1) or 1e-12) + x1: c = not c
            return c
        def dist_edge(p):
            best = 1e9
            for k in range(len(poly)):
                a, b = poly[k], poly[(k + 1) % len(poly)]
                ab = (b[0] - a[0], b[1] - a[1]); L2 = ab[0] ** 2 + ab[1] ** 2 or 1e-12
                t = max(0, min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2))
                best = min(best, math.dist(p, (a[0] + ab[0] * t, a[1] + ab[1] * t)))
            return best
        n_ring = len(self.uv)
        u = min(us) + h / 2
        while u < max(us):
            v = min(vs) + h / 2
            while v < max(vs):
                p = (u, v)
                if inside(p) and dist_edge(p) > 0.45 * h: self.uv.append(p)
                v += h
            u += h
        edges_c = [(ring[k], ring[(k + 1) % len(ring)]) for k in range(len(ring))]
        out = delaunay_2d_cdt([Vector((p[0], p[1])) for p in self.uv], edges_c, [], 0, 1e-7)
        vco, _, faces, orig_v, _, _ = out[0], out[1], out[2], out[3], out[4], out[5]
        # map output verts back to ours (they're the same points, maybe reordered)
        remap = {}
        for k, o in enumerate(orig_v):
            if o: remap[k] = o[0]
        newuv = list(self.uv)
        for k in range(len(vco)):
            if k not in remap: remap[k] = len(newuv); newuv.append((vco[k][0], vco[k][1]))
        self.uv = newuv
        tris = []
        for f in faces:
            ff = [remap[k] for k in f]
            c = (sum(self.uv[i][0] for i in ff) / 3, sum(self.uv[i][1] for i in ff) / 3)
            if inside(c): tris.append(ff)
        self.tris = tris

    def edge(self, name):
        for n, idx in self.edges:
            if n == name: return idx
        raise KeyError(name)


# ------------------------------------------------------------------------------------------------- the garment
class Garment:
    def __init__(self, name):
        self.name = name; self.pieces = []; self.co = []; self.faces = []; self.base = {}
        self.seams = []         # (pieceA, edgeA, pieceB, edgeB, flip)
        self.groups = {}        # name → set of vertex indices

    def add(self, piece, place):
        self.base[piece.name] = len(self.co)
        for p in piece.uv: self.co.append(Vector(place(*p)))
        b = self.base[piece.name]
        self.faces += [[b + i for i in t] for t in piece.tris]
        self.pieces.append(piece)

    def vid(self, piece, i):
        return self.base[piece.name] + i

    def sew(self, pa, ea, pb, eb, reverse=False):
        A = [self.vid(pa, i) for i in pa.edge(ea)]
        B = [self.vid(pb, i) for i in pb.edge(eb)]
        if reverse: B = B[::-1]
        if len(A) != len(B): raise ValueError(f'seam {pa.name}.{ea} ({len(A)}) ≠ {pb.name}.{eb} ({len(B)})')
        self.seams.append(list(zip(A, B)))

    def presew(self, bvh, out_gap=0.006, reach=0.25):
        """close every seam before simulating: each stitch's two points go to their midpoint (off the body), and each
        piece's inside relaxes around them (seams held), so the sim only drapes — it never drags pieces across the
        body (that crumpled them)"""
        n = len(self.co)
        nbr = [set() for _ in range(n)]
        for f in self.faces:
            for k in range(3): a, b = f[k], f[(k + 1) % 3]; nbr[a].add(b); nbr[b].add(a)
        fixed = set()
        self.orig = [c.copy() for c in self.co]
        def out(p):
            loc, nrm, _, d = bvh.find_nearest(p)
            if loc is not None and (p - loc).dot(nrm) < out_gap: return loc + nrm * out_gap
            return p
        # (chains: a vertex in several seams — the armpit corner — goes to the mean of all its partners)
        parent = list(range(n))
        def find(a):
            while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
            return a
        for seam in self.seams:
            for a, b in seam:
                ra, rb = find(a), find(b)
                if ra != rb: parent[rb] = ra
        groups = {}
        for seam in self.seams:
            for a, b in seam: groups.setdefault(find(a), set()).update((a, b))
        moved = 0.0
        for g in groups.values():
            c = out(sum((self.co[i] for i in g), Vector()) / len(g))
            for i in g: moved = max(moved, (self.co[i] - c).length); self.co[i] = c.copy(); fixed.add(i)
        # the rest of each piece follows its seams' moves smoothly (inverse-square by distance ON THE PATTERN, fading
        # out over `reach`): the piece keeps its cut size — a Laplacian relax shrank it onto the body
        disp = {i: self.co[i] - self.orig[i] for i in fixed}
        for pc in self.pieces:
            b0 = self.base[pc.name]
            seams_here = [(i - b0, disp[i]) for i in range(b0, b0 + len(pc.uv)) if i in disp]
            if not seams_here: continue
            for k, uv in enumerate(pc.uv):
                i = b0 + k
                if i in fixed: continue
                wsum, dsum, dmin = 0.0, Vector(), 1e9
                for j, dj in seams_here:
                    d = math.dist(uv, pc.uv[j]); dmin = min(dmin, d)
                    w = 1.0 / (d * d + 1e-4); wsum += w; dsum += dj * w
                fall = math.exp(-(dmin / reach) ** 2)
                self.co[i] = out(self.orig[i] + dsum / wsum * fall)
        print(f'  pre-sewn: {len(groups)} stitch points, the farthest moved {moved * 100:.1f} cm', flush=True)
        self.welded = groups

    def relax_lengths(self, bvh, iters=300, out_gap=0.006):
        """every edge back to its length on the flat pattern (Jacobi length constraints, numpy), the seam pairs held
        together and everything kept out of the body: a 3D start whose natural lengths are the pattern's, so the
        garment can be welded first and still drape without creases baked in"""
        import numpy as np
        X = np.array([tuple(c) for c in self.co], dtype=np.float64)
        E, L0 = [], []
        for pc in self.pieces:
            b0 = self.base[pc.name]; seen = set()
            for t in pc.tris:
                for k in range(3):
                    a, b = t[k], t[(k + 1) % 3]
                    key = (min(a, b), max(a, b))
                    if key in seen: continue
                    seen.add(key); E.append((b0 + a, b0 + b)); L0.append(math.dist(pc.uv[a], pc.uv[b]))
        E = np.array(E); L0 = np.array(L0)
        pairs = np.array([p for seam in self.seams for p in seam])
        before = np.abs(np.linalg.norm(X[E[:, 0]] - X[E[:, 1]], axis=1) / L0 - 1).mean()
        for it in range(iters):
            d = X[E[:, 1]] - X[E[:, 0]]; ln = np.linalg.norm(d, axis=1) + 1e-12
            corr = (d * ((ln - L0) / ln)[:, None]) * 0.5
            acc = np.zeros_like(X); cnt = np.zeros(len(X))
            np.add.at(acc, E[:, 0], corr); np.add.at(acc, E[:, 1], -corr)
            np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
            X += acc / np.maximum(cnt, 1)[:, None] * 0.9
            mid = (X[pairs[:, 0]] + X[pairs[:, 1]]) / 2
            X[pairs[:, 0]] = mid; X[pairs[:, 1]] = mid
            if it % 10 == 9 or it == iters - 1:
                for k in range(len(X)):
                    loc, nrm, _, dd = bvh.find_nearest(Vector(X[k]))
                    if loc is not None and (Vector(X[k]) - loc).dot(nrm) < out_gap: X[k] = tuple(loc + nrm * out_gap)
        after = np.abs(np.linalg.norm(X[E[:, 0]] - X[E[:, 1]], axis=1) / L0 - 1).mean()
        self.co = [Vector(p) for p in X]
        print(f'  lengths relaxed: mean edge error {before * 100:.1f} % → {after * 100:.1f} %', flush=True)

    def build(self, bvh=None, out_gap=0.006, flat_rest=False):
        # vertices that start inside the body (or closer than out_gap) go out along the surface normal
        if bvh:
            for k, p in enumerate(self.co):
                loc, nrm, _, d = bvh.find_nearest(p)
                if loc is None: continue
                if (p - loc).dot(nrm) < out_gap: self.co[k] = loc + nrm * out_gap
        me = bpy.data.meshes.new(self.name)
        edges = [e for seam in self.seams for e in seam if e[0] != e[1]]
        me.from_pydata([tuple(c) for c in self.co], edges, self.faces); me.update()
        ob = bpy.data.objects.new(self.name, me); bpy.context.scene.collection.objects.link(ob)
        for gname, vs in self.groups.items():
            g = ob.vertex_groups.new(name=gname); g.add(list(vs), 1.0, 'REPLACE')
        # the cloth's REST shape = the flat pattern (each piece laid out in the plane y = 0, side by side): the drape
        # starts from the placed shape, but the fabric's natural lengths are the pattern's — no creases baked in
        if not flat_rest:
            self.ob = ob
            return ob
        ob.shape_key_add(name='Basis')
        flat = ob.shape_key_add(name='flat', from_mix=False)
        x0 = 0.0
        for pc in self.pieces:
            b0 = self.base[pc.name]; umin = min(u for u, v in pc.uv); umax = max(u for u, v in pc.uv)
            for k, (u, v) in enumerate(pc.uv): flat.data[b0 + k].co = (x0 + u - umin, 2.0, v)
            x0 += umax - umin + 0.1
        flat.value = 0.0
        self.ob = ob
        return ob


# ------------------------------------------------------------------------------------------------- simulation
SOFT = dict(tension=15, compression=15, shear=5, bending=0.5, mass=0.3, air=1.0)
# a men's tee: 160–190 g/m² cotton jersey — a little more body than opensew's SOFT (it falls off the chest instead of
# showing every muscle)
JERSEY = dict(tension=15, compression=15, shear=5, bending=1.5, mass=0.3, air=1.0)


def cloth(ob, name, fabric=SOFT, quality=10, gravity=1.0, pin=None, pin_stiff=25, sewing=False, shrink=0.0,
          frames=300, self_collision=False):
    for m in list(ob.modifiers):
        if m.type == 'CLOTH': ob.modifiers.remove(m)
    cl = ob.modifiers.new(name, 'CLOTH'); s = cl.settings; cs = cl.collision_settings
    s.quality = quality; s.mass = fabric['mass']; s.air_damping = fabric['air']
    s.bending_model = 'ANGULAR'
    s.tension_stiffness = fabric['tension']; s.compression_stiffness = fabric['compression']
    s.shear_stiffness = fabric['shear']; s.bending_stiffness = fabric['bending']
    s.tension_damping = 15; s.compression_damping = 15; s.shear_damping = 5; s.bending_damping = 0.5
    s.use_sewing_springs = sewing; s.sewing_force_max = 0
    if ob.data.shape_keys and 'flat' in ob.data.shape_keys.key_blocks: s.rest_shape_key = ob.data.shape_keys.key_blocks['flat']
    s.shrink_min = shrink
    if pin: s.vertex_group_mass = pin; s.pin_stiffness = pin_stiff
    s.effector_weights.gravity = gravity
    cs.collision_quality = 6; cs.distance_min = 0.004; cs.impulse_clamp = 0.5
    cs.use_self_collision = self_collision; cs.self_distance_min = 0.002; cs.self_friction = 2
    scn = bpy.context.scene
    cl.point_cache.frame_start = scn.frame_current; cl.point_cache.frame_end = scn.frame_current + frames
    scn.frame_set(scn.frame_current)
    return cl


def run(frames, log=''):
    import time
    scn = bpy.context.scene; t0 = time.time()
    for f in range(frames):
        scn.frame_set(scn.frame_current + 1)
        if (f + 1) % 5 == 0: print(f'  {log} frame {f + 1}/{frames}  {time.time() - t0:.0f} s', flush=True)


def apply_cloth(ob):
    """the cloth's current shape becomes the mesh (and the modifier goes)"""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    co = [v.co.copy() for v in ev.data.vertices]
    for m in list(ob.modifiers):
        if m.type == 'CLOTH': ob.modifiers.remove(m)
    if ob.data.shape_keys:
        ob.active_shape_key_index = 0
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shape_key_remove(all=True)
    for v, c in zip(ob.data.vertices, co): v.co = c
    ob.data.update()


def weld(ob, gseams, bvh=None, max_gap=0.045, out_gap=0.003):
    """merge each seam's paired vertices at their midpoint (union-find over the seam pairs), drop the sewing edges"""
    me = ob.data
    parent = list(range(len(me.vertices)))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    open_ = 0
    for seam in gseams:
        for a, b in seam:
            if (me.vertices[a].co - me.vertices[b].co).length > max_gap: open_ += 1
            ra, rb = find(a), find(b)
            if ra != rb: parent[rb] = ra
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    groups = {}
    for i in range(len(bm.verts)): groups.setdefault(find(i), []).append(i)
    targetmap = {}
    for r, members in groups.items():
        if len(members) < 2: continue
        c = sum((bm.verts[i].co for i in members), Vector()) / len(members)
        for i in members: bm.verts[i].co = c
        for i in members:
            if i != r: targetmap[bm.verts[i]] = bm.verts[r]
    roots = [bm.verts[r] for r, m in groups.items() if len(m) > 1]   # (the merged stitch points survive the weld)
    bmesh.ops.weld_verts(bm, targetmap=targetmap)
    loose = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='EDGES')
    # the seams smoothed: a merged stitch line zig-zags (each side's spacing differs a little); its vertices and their
    # neighbours relax along the surface a few times
    seam_v = {v for v in roots if v.is_valid}
    # (a band 3 rings each side: the drape keeps the start's bend as its rest — a crease left at a seam stays a groove)
    ring = set(seam_v)
    for r in range(3):
        for v in list(ring):
            for e in v.link_edges: ring.add(e.other_vert(v))
    ring = [v for v in ring if v.is_valid and not v.is_boundary]
    for it in range(10):
        bmesh.ops.smooth_vert(bm, verts=ring, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    if bvh:
        for v in bm.verts:
            loc, nrm, _, d = bvh.find_nearest(v.co)
            if loc is not None and (v.co - loc).dot(nrm) < 0.002: v.co = loc + nrm * out_gap
    bm.to_mesh(me); bm.free(); me.update()
    print(f'  welded: {sum(len(s) for s in gseams)} pairs, {open_} were wider than {max_gap * 100:.1f} cm', flush=True)


def write_obj(ob, path, modifiers=True):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg) if modifiers else ob
    me = ev.to_mesh()
    with open(path, 'w') as f:
        for v in me.vertices: f.write('v %.6f %.6f %.6f\n' % tuple(v.co))
        for p in me.polygons: f.write('f ' + ' '.join(str(i + 1) for i in p.vertices) + '\n')
    ev.to_mesh_clear()
