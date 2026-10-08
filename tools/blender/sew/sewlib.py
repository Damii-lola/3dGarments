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
def load_body(d, pose=False):
    """the exported body as a collider — the rest pose, or the sewing pose (arms lowered); returns (object, meta, bvh)"""
    meta = json.load(open(os.path.join(d, 'body_rest.json')))
    if pose:
        pm = json.load(open(os.path.join(d, 'body_pose.json')))
        meta['joints'] = pm['joints']; meta['D'] = pm['D']; meta['W'] = pm['W']
    V, F = [], []
    for line in open(os.path.join(d, 'body_pose.obj' if pose else 'body_rest.obj')):
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
        # a row just inside the outline, one point per outline segment (each segment gets its own triangle: no slivers
        # along a straight or steep edge — they made the seams non-manifold)
        row = []
        for k in range(len(poly)):
            a, b = poly[k], poly[(k + 1) % len(poly)]
            m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); L = math.dist(a, b) or 1e-9
            nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
            off = 0.5 * min(L, h)
            for sg in (1, -1):
                q = (m[0] + sg * nx * off, m[1] + sg * ny * off)
                if inside(q) and dist_edge(q) > 0.3 * off:
                    if all(math.dist(q, r) > 0.4 * h for r in row): row.append(q)
                    break
        self.uv += row
        u = min(us) + h / 2
        while u < max(us):
            v = min(vs) + h / 2
            while v < max(vs):
                p = (u, v)
                if inside(p) and dist_edge(p) > 0.9 * h and all(math.dist(p, r) > 0.7 * h for r in row if abs(r[0] - u) < h and abs(r[1] - v) < h):
                    self.uv.append(p)
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
        # check: every outline vertex of the meshed piece must be one of ours (sewn); the triangulation adds none
        import collections
        ec = collections.Counter()
        for t in tris:
            for k in range(3): a, b = t[k], t[(k + 1) % 3]; ec[(min(a, b), max(a, b))] += 1
        rs = set(ring)
        stray = {v for e, c in ec.items() if c == 1 for v in e if v not in rs}
        over = [e for e, c in ec.items() if c > 2]
        missing = [k for k in range(len(ring)) if (min(ring[k], ring[(k + 1) % len(ring)]), max(ring[k], ring[(k + 1) % len(ring)])) not in ec]
        if stray or over or missing:
            print(f'  ! piece {name}: {len(stray)} stray outline verts, {len(over)} over-shared edges, {len(missing)} outline edges missing', flush=True)

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
        ob['face_piece'] = [pc.name for pc in self.pieces for t in pc.tris]
        vinfo = []
        for pc in self.pieces:
            for k in range(len(pc.uv)):
                en = [n for n, idx in pc.edges if k in idx]
                vinfo.append(f'{pc.name}:{k}:{"/".join(en) or "in"}')
        ob['vinfo'] = vinfo
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
# showing every muscle). Stiff enough in bending that unforced areas settle smooth (not the fine all-over ripples a
# very soft setting gives), but soft enough that the fold zones (shrink_group='fold' in tee.py) can still actually
# buckle — too stiff and the shrink just stretches the fabric taut instead of folding it
JERSEY = dict(tension=18, compression=18, shear=6, bending=2.2, mass=0.3, air=1.2)


def cloth(ob, name, fabric=SOFT, quality=10, gravity=1.0, pin=None, pin_stiff=25, sewing=False, shrink=0.0,
          shrink_group=None, frames=300, self_collision=False):
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
    # a WEIGHTED vertex group (0..1 per vertex) scales shrink_min locally: where it's 1 the rest length shrinks by the
    # full amount, fading to 0 does nothing — a soft, physically real way to put a drag-fold exactly where real tees
    # get one (the fabric is a hair too short there, so it has to buckle), rather than hand-sculpting a crease
    if shrink_group: s.vertex_group_shrink = shrink_group
    if pin: s.vertex_group_mass = pin; s.pin_stiffness = pin_stiff
    s.effector_weights.gravity = gravity
    cs.collision_quality = 6; cs.distance_min = 0.006; cs.impulse_clamp = 0.5
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


def weld(ob, gseams, bvh=None, max_gap=0.045, out_gap=0.003, keep_open=None):
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
    # captured HERE, as live BMVert references, before any merge/delete below renumbers bm.verts (weld_verts and
    # the non-manifold cleanup both compact the array — grabbing these by index later picked up whatever vertices
    # had since slid into those slots instead, so hem/neckline/cuffs went unprotected without any sign of it).
    # ALSO written into a custom vertex layer, not just held as object references: a later bm.to_mesh()/from_mesh()
    # round-trip (done below so a hole-fill pass that leaves the mesh a vertex short of manifold can retry on a
    # clean bmesh) invalidates every object reference, but custom-data layers are copied through that round-trip,
    # so the marker survives it and tells the next bmesh which vertices are protected
    ptag = bm.verts.layers.int.new('_protected')          # adding a layer can itself invalidate existing refs,
    protected = {bm.verts[i] for i in (keep_open or set()) if i < len(bm.verts)}   # so capture verts AFTER this
    for v in protected: v[ptag] = 1
    groups = {}
    for i in range(len(bm.verts)): groups.setdefault(find(i), []).append(i)
    targetmap = {}
    for r, members in groups.items():
        if len(members) < 2: continue
        c = sum((bm.verts[i].co for i in members), Vector()) / len(members)
        for i in members: bm.verts[i].co = c
        for i in members:
            if i != r: targetmap[bm.verts[i]] = bm.verts[r]
    roots = [bm.verts[r] for r, m in groups.items() if len(m) > 1]
    bm.normal_update()   # (the merged stitch points survive the weld)
    bm.faces.ensure_lookup_table()
    for k, f in enumerate(bm.faces): f.material_index = 0
    fp = ob.get('face_piece')
    bmesh.ops.weld_verts(bm, targetmap=targetmap)
    if fp:
        import collections
        cnt = collections.Counter()
        for e in bm.edges:
            if len(e.link_faces) > 2: cnt[tuple(sorted(fp[f.index] if f.index < len(fp) else '?' for f in e.link_faces))] += 1
        if cnt: print('  ! non-manifold after weld, faces from:', dict(cnt), flush=True)
        vinfo = ob.get('vinfo')
        for e in [e for e in bm.edges if len(e.link_faces) > 2][:3]:
            print('    edge', [[vinfo[m] for m in groups.get(find(v.index), [v.index])] for v in e.verts], flush=True)
    # manifold: an edge with > 2 faces keeps the two that agree best (a duplicate or folded third face goes)
    removed = 0
    for it in range(5):
        bad = [e for e in bm.edges if len(e.link_faces) > 2]
        if not bad: break
        kill = set()
        for e in bad:
            fs = list(e.link_faces)
            seen = {}
            for f in fs:
                key = frozenset(v.index for v in f.verts)
                if key in seen: kill.add(f)
                else: seen[key] = f
            rest = [f for f in fs if f not in kill]
            while len(rest) > 2:
                # the face whose normal agrees least with its edge-neighbours (away from this edge)
                def score(f):
                    ns = [g.normal for ed in f.edges if ed is not e for g in ed.link_faces if g is not f]
                    return sum(f.normal.dot(n) for n in ns) / (len(ns) or 1)
                worst = min(rest, key=score); kill.add(worst); rest.remove(worst)
        bm.normal_update()
        bmesh.ops.delete(bm, geom=list(kill), context='FACES_ONLY'); removed += len(kill)
    loose = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='EDGES')
    lv = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=lv, context='VERTS')
    if removed:
        # keep_open names the garment's REAL open edges (hem, neckline, cuffs) by their original vertex ids, which
        # weld never merges (they're never in a seam) so they keep those ids here. Any other hole left by the
        # face-removal above is an accident (a small overlap where front/back/sleeve meet at a corner) and gets
        # closed outright — no size cap, since the real openings are excluded by name rather than by being "too
        # big to be a mistake", which a size cap can't tell apart from an unusually large accidental hole
        filled = fill_small_holes(bm, protect=protected)
        # a hole whose boundary isn't a single simple loop (a Y-junction corner where 3 pieces meet) is one
        # holes_fill rightly declines rather than risk a bad fill — but it's usually just two boundary edges left
        # a hair apart (the vertices on either side never got a seam pair of their own, only their neighbours
        # did). Snap any (non-protected) boundary vertices still within a cm of each other
        bedges = [e for e in bm.edges if e.is_boundary]
        bverts = [v for v in {v for e in bedges for v in e.verts} if v not in protected]
        snapped = 0
        if bverts:
            nv0 = len(bm.verts)
            bmesh.ops.remove_doubles(bm, verts=bverts, dist=0.012)
            snapped = nv0 - len(bm.verts)
            if snapped:
                filled += fill_small_holes(bm, protect=protected)
        print(f'  weld: {removed} extra faces removed (non-manifold edges), {filled} small holes filled, {snapped} stray boundary verts snapped', flush=True)
    # a seam joins pieces that were each wound correctly on their own, but not always in agreement with each other —
    # a face wound backward right at the join reads as a bright crack (its vertex normals, averaged with its
    # correctly-wound neighbours, nearly cancel). Make every face agree with its neighbours, then check the whole
    # garment still faces OUT of the body (recalc only enforces agreement, not which way is "out")
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bvh:
        sample = bm.faces[:40] if len(bm.faces) > 40 else list(bm.faces)
        agree = sum(1 for f in sample if (lambda h: h[0] is not None and f.normal.dot(f.calc_center_median() - h[0]) > 0)(bvh.find_nearest(f.calc_center_median())))
        if agree < len(sample) / 2: bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
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
    bm.verts.index_update()
    ob['seam_verts'] = [v.index for v in seam_v if v.is_valid]
    if bvh:
        for v in bm.verts:
            loc, nrm, _, d = bvh.find_nearest(v.co)
            if loc is not None and (v.co - loc).dot(nrm) < 0.002: v.co = loc + nrm * out_gap
    bm.to_mesh(me); bm.free(); me.update()
    # a second, independent pass on a fresh bmesh: closing one small stray hole can leave the mesh right next to
    # it a vertex short of manifold again (the CDT fill's own new triangle doesn't always agree edge-for-edge with
    # its real neighbour), and that only ever showed up against a bmesh carried through many prior edits, never
    # against one rebuilt clean from the mesh as it now stands
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    ptag = bm.verts.layers.int.get('_protected')
    protected = {v for v in bm.verts if ptag and v[ptag]} if ptag else set()
    fill_small_holes(bm, protect=protected)
    # recalc normals on second pass too — CDT fill on the fresh bmesh may add faces
    # whose winding wasn't harmonised against the weld-pass recalc
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bvh:
        sample2 = bm.faces[:40] if len(bm.faces) > 40 else list(bm.faces)
        ctr2 = sum((f.calc_center_median() for f in sample2), Vector()) / len(sample2)
        test2 = bm.faces[0]; n2 = test2.normal; c2 = test2.calc_center_median()
        if (c2 - ctr2).dot(n2) < 0: bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
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


def unpose(co, meta, bvh_unused=None, k=6, smooth_rounds=12, faces=None):
    """garment vertices draped on the sewing-pose body → the rest pose (inverse skinning): each vertex takes the
    weights of the k nearest posed body vertices (inverse-square), the body weights first smoothed over the body's
    surface; the blended deform matrix is inverted"""
    import numpy as np
    from mathutils import Matrix
    from mathutils.kdtree import KDTree
    V, F, W, D = meta['V'], meta['F'], meta['W'], {n: Matrix(m) for n, m in meta['D'].items()}
    n = len(V)
    # body weights smoothed over its surface (the skin's own changes from torso to arm within a few cm)
    nb = [set() for _ in range(n)]
    for f in F:
        for a in range(len(f)): nb[f[a]].add(f[(a + 1) % len(f)]); nb[f[(a + 1) % len(f)]].add(f[a])
    cur = [dict((name, w) for name, w in W[i]) for i in range(n)]
    for it in range(smooth_rounds):
        nxt = []
        for i in range(n):
            o = {b: w * 0.5 for b, w in cur[i].items()}
            if nb[i]:
                f = 0.5 / len(nb[i])
                for j in nb[i]:
                    for b, w in cur[j].items(): o[b] = o.get(b, 0) + w * f
            nxt.append(o)
        cur = nxt
    kd = KDTree(n)
    for i, v in enumerate(V): kd.insert(v, i)
    kd.balance()
    out = []
    for p in co:
        acc = {}
        for (q, i, d) in kd.find_n(p, k):
            f = 1.0 / (d * d + 1e-6)
            for b, w in cur[i].items(): acc[b] = acc.get(b, 0) + w * f
        top = sorted(acc.items(), key=lambda t: -t[1])[:4]; s_ = sum(w for _, w in top) or 1
        M = Matrix(((0, 0, 0, 0),) * 4)
        for b, w in top: M = M + D[b] * (w / s_)
        out.append(M.inverted_safe() @ Vector(p))
    return out


def smooth_seams(ob, bvh, rings=2, iters=4, out_gap=0.004):
    """after the drape: the seams (weld's ob['seam_verts']) and 2 rings round them relaxed again, kept off the body"""
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    band = {bm.verts[i] for i in ob.get('seam_verts', []) if i < len(bm.verts)}
    for r in range(rings):
        for v in list(band):
            for e in v.link_edges: band.add(e.other_vert(v))
    band = [v for v in band if not v.is_boundary]
    for it in range(iters):
        bmesh.ops.smooth_vert(bm, verts=band, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in band:
            loc, nrm, _, d = bvh.find_nearest(v.co)
            if loc is not None and (v.co - loc).dot(nrm) < out_gap: v.co = loc + nrm * out_gap
    bm.to_mesh(me); bm.free(); me.update()


def boundary_loops(bm):
    adj = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts; adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    seen, loops = set(), []
    for v in adj:
        if v in seen: continue
        loop = [v]; seen.add(v); prev, cur = None, v
        while True:
            nxt = [u for u in adj[cur] if u is not prev and u not in seen]
            if not nxt: break
            prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
        loops.append(loop)
    return loops


def _cdt_fill_loop(bm, loop):
    """Triangulate one closed boundary loop (BMVerts, in order) with the same constrained-Delaunay routine the
    pattern pieces themselves are built with (Piece.__init__), instead of a Blender hole-fill operator: both
    holes_fill (one flat n-gon, and silently refuses a loop it decides isn't simple enough — on this garment's own
    non-convex, barely-planar corner holes it left some of them untouched at any size) and triangle_fill (filled
    most of one hole but splintered the rest into several more small holes) turned out unreliable on this shape.
    Newell's method gives a plane to project onto even though the loop isn't exactly flat (it sits on a curved
    corner of the body) — the usual way to triangulate a near-planar 3D polygon; any new (Steiner) point CDT adds
    is placed on that plane and pulled onto the body surface by weld()'s own final surface-snap, like every other
    fill vertex."""
    n = len(loop)
    if n < 3: return []
    pts = [v.co for v in loop]
    centroid = sum(pts, Vector()) / n
    normal = Vector()
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        normal += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    if normal.length < 1e-12: return []
    normal.normalize()
    helper = Vector((1, 0, 0)) if abs(normal.x) < 0.9 else Vector((0, 1, 0))
    u = (helper - normal * helper.dot(normal)).normalized(); v = normal.cross(u)
    pts2d = [Vector(((p - centroid).dot(u), (p - centroid).dot(v))) for p in pts]
    edges_c = [(i, (i + 1) % n) for i in range(n)]
    vco, _, faces, orig_v, _, _ = delaunay_2d_cdt(pts2d, edges_c, [], 0, 1e-7)
    remap = {}
    for k, o in enumerate(orig_v):
        if o: remap[k] = loop[o[0]]
    for k in range(len(vco)):
        if k not in remap:                            # a Steiner point CDT added: place it on the fitted plane
            p3 = centroid + u * vco[k][0] + v * vco[k][1]
            remap[k] = bm.verts.new(p3)
    new_faces = []
    for f in faces:
        try: new_faces.append(bm.faces.new([remap[k] for k in f]))
        except ValueError: pass
    return new_faces


def _close_branch_vertices(bm, pv):
    """A boundary "vertex" here isn't always simple edges forming disjoint loops: the corner where three pattern
    pieces meet (front, back, sleeve-cap at the armhole/shoulder point; hem, under_front and under_back at a
    sleeve cuff's corner) can pinch to a single vertex shared by two separate missing wedges of fabric, four
    boundary edges radiating from the one point instead of two — an hourglass, not a loop. boundary_loops()'s walk
    picks an arbitrary branch at a vertex like that and splinters the hole into fragments instead of one or two
    clean loops, which is what every hole-fill tried here (both Blender's own holes_fill/triangle_fill and this
    file's own CDT fill) kept running into on this corner. A vertex ON one of the garment's real openings
    (`pv`) can be a branch point too — the cuff corner is exactly this: 2 of its edges are the real hem curve
    (protected) and should stay open, but the seam that was supposed to close the other 2 (under_front to
    under_back) didn't fully weld right at that shared point. So a branch is handled by spoke, not wholesale: an
    edge whose OTHER end is also protected is the real opening, left alone; every other edge at the vertex is the
    accidental part, fan-triangulated away in true angular order (using the vertex's own normal as the fan's
    axis) so only the genuine gap closes."""
    bm.normal_update()
    deg = {}
    for e in bm.edges:
        if e.is_boundary:
            for v in e.verts: deg[v] = deg.get(v, 0) + 1
    # a degree-1 vertex (one dangling boundary edge, not two) is the same kind of accident at the other extreme —
    # a sliver face whose far corner never got a second neighbour — and reads as a thin crack against whatever is
    # behind the garment. Collapse it onto its one boundary neighbour (never a protected one: a real opening's own
    # ends are themselves degree-2, continuing the curve, never a whisker) and let the normal weld/cleanup above
    # it in the pipeline absorb the now-degenerate sliver
    for v in [v for v, d in deg.items() if d == 1 and v not in pv]:
        if not v.is_valid: continue
        other = next((e.other_vert(v) for e in v.link_edges if e.is_boundary), None)
        if other is not None and other not in pv:
            bmesh.ops.pointmerge(bm, verts=[v, other], merge_co=other.co)
    for v in [v for v, d in deg.items() if d > 2]:
        if not v.is_valid: continue
        all_nbrs = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        nbrs = all_nbrs if v not in pv else [n for n in all_nbrs if n not in pv]
        if len(nbrs) < 2: continue
        n = v.normal if v.normal.length > 1e-6 else Vector((0, 0, 1))
        helper = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
        u = (helper - n * helper.dot(n)).normalized(); w = n.cross(u)
        nbrs.sort(key=lambda p: math.atan2((p.co - v.co).dot(w), (p.co - v.co).dot(u)))
        for i in range(len(nbrs) - (1 if len(nbrs) < len(all_nbrs) else 0)):
            a, b = nbrs[i], nbrs[(i + 1) % len(nbrs)]
            # skip ONLY if a face covering this wedge already exists — an existing a-b edge alone is not
            # proof the gap is intentional: at the armhole junction the non-manifold cleanup removes faces
            # whose a-b edge is part of the garment, leaving a hole that still needs this spoke
            ab_edge = next((ed for ed in a.link_edges if ed.other_vert(a) is b), None)
            if ab_edge is not None and any(v in f.verts for f in ab_edge.link_faces): continue
            try: bm.faces.new([v, a, b])
            except ValueError: pass


def fill_small_holes(bm, protect=None):
    """Close every remaining open boundary loop that isn't one of the garment's real openings (`protect`),
    then subdivide the fill down toward the surrounding mesh density — without fine fill triangles the cloth
    sim crumples the corners badly. Fill faces are tagged fill_tri=1 so tee.py can delete them after the
    cloth sim (displacement into protrusions/holes is removed cleanly from the final mesh).
    The _orig_mark layer approach is used instead of a Python set because any bmesh op (including
    bm.faces.layers.int.new itself) can regenerate the Python wrappers, making 'f not in before' always
    True even for original faces."""
    n_before = len(bm.faces)
    pv = protect or set()
    # mark all CURRENT faces as original before any additions — layer values survive wrapper regeneration
    orig_layer = bm.faces.layers.int.new('_orig_mark')
    for f in bm.faces:
        f[orig_layer] = 1
    _close_branch_vertices(bm, pv)
    bad_loops = [l for l in boundary_loops(bm) if not all(v in pv for v in l)]
    if not bad_loops:
        bm.faces.layers.int.remove(orig_layer)
        return 0
    import statistics
    sample = [f.calc_area() for f in bm.faces if f.is_valid and f[orig_layer]] or [1e-4]
    target = statistics.median(sample) * 2.5
    for loop in bad_loops: _cdt_fill_loop(bm, loop)
    # fill region: all faces whose _orig_mark is 0 (added by CDT fill and branch vertex fans so far)
    fill_set = {f for f in bm.faces if f.is_valid and f[orig_layer] == 0}
    # subdivide fill faces to match surrounding density, but ONLY on fill-interior edges — edges
    # shared with a garment face must not be subdivided: that splits the garment face, whose new
    # fragments get orig_mark=0 and are incorrectly tagged as fill; also distorts garment topology
    for _ in range(5):
        big = [f for f in fill_set if f.is_valid and f.calc_area() > target]
        if not big: break
        edges = list({e for f in big for e in f.edges
                      if e.verts[0] not in pv and e.verts[1] not in pv
                      and all(lf[orig_layer] == 0 for lf in e.link_faces)})
        if not edges: break
        res = bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True)
        new_fill = {el for el in res['geom'] if isinstance(el, bmesh.types.BMFace) and el.is_valid}
        for nf in new_fill:
            nf[orig_layer] = 0
        fill_set = {f for f in fill_set if f.is_valid} | new_fill
    _close_branch_vertices(bm, pv)
    bm.normal_update()
    # tag all fill faces via _orig_mark (catches faces the second _close_branch_vertices may have added)
    fill_layer = bm.faces.layers.int.get('fill_tri') or bm.faces.layers.int.new('fill_tri')
    for f in bm.faces:
        if f.is_valid and f[orig_layer] == 0:
            f[fill_layer] = 1
    bm.faces.layers.int.remove(orig_layer)
    return len(bm.faces) - n_before


def iron(ob, bvh, iters=6, factor=0.25, out_gap=0.006, exclude_group=None, exclude_weight=0.15):
    """a light whole-garment Laplacian pass after the drape: a few fine wrinkles the sim left (not the big folds —
    those span many vertices and barely move under a small-factor average) smoothed flat, like pressing the fabric;
    never pulled in past out_gap from the body, and the open edges (hem, sleeve ends, neckband) held still so the
    silhouette doesn't shrink. `exclude_group`: a vertex group name (weight > exclude_weight) left untouched — a
    real, deliberately-sewn-in drag fold stays exactly as the sim made it; only its neighbours, pulled by the
    general smooth, are allowed to move. A vertex GROUP survives weld()'s reindexing (a raw index set wouldn't)."""
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    edge_v = {v for loop in boundary_loops(bm) for v in loop}
    ex = set()
    if exclude_group and exclude_group in ob.vertex_groups:
        gi = ob.vertex_groups[exclude_group].index
        dl = bm.verts.layers.deform.active
        if dl is not None:
            ex = {v for v in bm.verts if v[dl].get(gi, 0.0) > exclude_weight}
    inner = [v for v in bm.verts if v not in edge_v and v not in ex]
    for it in range(iters):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in inner:
            loc, nrm, _, d = bvh.find_nearest(v.co)
            if loc is not None and (v.co - loc).dot(nrm) < out_gap: v.co = loc + nrm * out_gap
    bm.to_mesh(me); bm.free(); me.update()


def smooth_edges(ob, iters=12, rings=2):
    """the open edges (hems, sleeve ends, neckband top) relaxed ALONG themselves — a cut edge reads as one clean line —
    and the rows just inside follow"""
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me)
    loops = [l for l in boundary_loops(bm) if len(l) > 10]
    for it in range(iters):
        for loop in loops:
            m = len(loop); P = [v.co.copy() for v in loop]
            for k in range(m):
                loop[k].co = P[k] * 0.5 + (P[k - 1] + P[(k + 1) % m]) * 0.25
    inner = set()
    for loop in loops:
        cur = set(loop)
        for r in range(rings):
            nxt = {e.other_vert(v) for v in cur for e in v.link_edges} - cur
            inner |= {v for v in nxt if not v.is_boundary}; cur |= nxt
    bmesh.ops.smooth_vert(bm, verts=list(inner), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(me); bm.free(); me.update()
