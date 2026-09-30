/**
 * A GarmentCode sewing pattern (from the API: NGL garment words → pattern, sized to this body) made into
 * the garment on the model:
 *
 *   mesh     every panel meshed flat (its outline sampled as GarmentCode's own mesher reads it, the inside
 *            filled at ~1.5 cm), placed in 3D where GarmentCode puts it around the body
 *   sew      stitched edges pulled together (every point to the matching point on the other edge; a longer
 *            edge gathers onto a shorter one as a ruffle would), the arms held out along the sleeves
 *   drape    gravity + collisions with the skin (and anything worn under it) — cloth.js
 *   pose     the arms brought down to the pose shown, the cloth carried by the skin under it, then settled
 *   texture  the garment's photos projected on: the front photo on the front panels, the back photo (or the
 *            front's plain fabric) on the back ones, aligned to the garment as sewn (sleeves out, as laid flat)
 *
 * Then fit.js `finish` makes it a skinned, morphing mesh with the fabric material.
 */
import * as THREE from 'three';
import Delaunator from 'delaunator';
import { Cloth, makeCollider } from './cloth.js';
import { bakeGarment } from './bake.js';
import {
  posedBody, skinBody, snapPose, setPose, lerpPose, armsAlong, legsApart, affineOf, applyA, inv3, finish, fabricOf, smooth,
} from './fit.js';

const H = 1.5; // cm, mesh spacing (matches the pattern's edge sampling)

/* ================================================================ meshing a panel */

function insidePoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToPoly(poly, x, y) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
    d = Math.min(d, Math.hypot(ax + t * ex - x, ay + t * ey - y));
  }
  return d;
}

/** → { pts: [[x, y]] (cm, panel plane), tris, edgeVerts: [[local index…] per edge, start → end] } */
function meshPanel(panel) {
  const pts = [], edgeVerts = [];
  panel.edges.forEach((e, k) => {
    const idx = [];
    e.pts.forEach((p, i) => {
      if (i === 0 && k > 0) { idx.push(pts.length - 1); return; }            // shared with the previous edge's end
      if (k === panel.edges.length - 1 && i === e.pts.length - 1) { idx.push(0); return; }   // closes the loop
      idx.push(pts.length); pts.push([p[0], p[1]]);
    });
    edgeVerts.push(idx);
  });
  const poly = pts.slice();
  const nb = pts.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const hv = H * 0.866;
  for (let j = 0, y = y0 + hv / 2; y < y1; j++, y += hv) {
    for (let x = x0 + (j % 2 ? H / 2 : 0); x < x1; x += H) {
      if (insidePoly(poly, x, y) && distToPoly(poly, x, y) > 0.6 * H) pts.push([x, y]);
    }
  }
  const d = Delaunator.from(pts);
  const tris = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t], b = d.triangles[t + 1], c = d.triangles[t + 2];
    const [ax, ay] = pts[a], [bx, by] = pts[b], [cx, cy] = pts[c];
    if (!insidePoly(poly, (ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < 1e-6) continue;
    if (Math.max(Math.hypot(ax - bx, ay - by), Math.hypot(bx - cx, by - cy), Math.hypot(cx - ax, cy - ay)) > 3.2 * H) continue;
    tris.push(a, b, c);
  }
  return { pts, tris, edgeVerts, nb };
}

/* ================================================================ the builder */

/**
 * @param pattern  { panels, stitches } from POST /api/ngl/pattern (cm, y up, facing +z)
 * @param photos   { front: Photo, back?: Photo }
 */
export function sewPattern(body, human, item, pattern, photos, { under = [], warm = null, detail = null } = {}) {
  const bones = body.bones;
  const display = snapPose(bones);
  const ctx = posedBody(body, human);
  const { n: nb, reg } = ctx;
  const fab = fabricOf(item.material || item.type, item.category);

  /* ---- where GarmentCode's body and ours differ: line the pattern up with our landmarks ---- */
  // tops and dresses hang from the shoulders: the collar line starts 1 cm above our side-neck point and
  // drops on; skirts and trousers sit at our waist (GarmentCode's waist level: height − head − waist line)
  const Rt = new THREE.Matrix4(), vt = new THREE.Vector3();
  const topOf = (sel) => {
    let top = -Infinity;
    for (const [name, p] of Object.entries(pattern.panels)) {
      if (!sel(name)) continue;
      const [rx, ry, rz] = p.rotation.map(THREE.MathUtils.degToRad);
      Rt.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'ZYX'));
      for (const e of p.edges) for (const [x, y] of e.pts) top = Math.max(top, vt.set(x, y, 0).applyMatrix4(Rt).y + p.translation[1]);
    }
    return top * 0.01;
  };
  const upperGarment = Object.keys(pattern.panels).some((k) => /torso/.test(k));
  const gb = pattern.body || {};
  const lift = upperGarment
    ? ctx.yNeckSide + 0.01 - topOf((k) => /torso/.test(k))
    : ctx.L.waistY - ((gb.height - gb.head_l - gb.waist_line) || 0) * 0.01;

  /* ---- panels → one mesh, placed in 3D ---- */
  const X0 = [], P2 = [], tris = [], panelOf = [], edgeIdx = {};
  const Rm = new THREE.Matrix4(), v = new THREE.Vector3();
  const panelInfo = {};
  for (const [name, panel] of Object.entries(pattern.panels)) {
    const m = meshPanel(panel);
    const base = X0.length / 3;
    const [rx, ry, rz] = panel.rotation.map(THREE.MathUtils.degToRad);
    Rm.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'ZYX'));          // GarmentCode: R = Rz·Ry·Rx
    const [tx, ty, tz] = panel.translation;
    for (const [x, y] of m.pts) {
      v.set(x, y, 0).applyMatrix4(Rm).add({ x: tx, y: ty, z: tz }).multiplyScalar(0.01);
      v.y += lift;
      X0.push(v.x, v.y, v.z); P2.push(x * 0.01, y * 0.01); panelOf.push(name);
    }
    // outward winding: the panel's normal points away from the body
    const nrm = new THREE.Vector3(0, 0, 1).applyMatrix4(Rm);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < m.pts.length; i++) { cx += X0[(base + i) * 3]; cy += X0[(base + i) * 3 + 1]; cz += X0[(base + i) * 3 + 2]; }
    cx /= m.pts.length; cy /= m.pts.length; cz /= m.pts.length;
    const sk = ctx.nearestSkin(cx, cy, cz, null, 10);
    const out = sk >= 0 ? new THREE.Vector3(cx - ctx.Q[sk * 3], 0, cz - ctx.Q[sk * 3 + 2]) : new THREE.Vector3(cx, 0, cz);
    const flip = nrm.dot(out) < 0;
    // which side of the garment it shows: front panels face +z
    const front = tz >= 0;
    panelInfo[name] = { base, count: m.pts.length, front, flip };
    for (let t = 0; t < m.tris.length; t += 3) {
      const a = base + m.tris[t], b = base + m.tris[t + 1], c = base + m.tris[t + 2];
      // Delaunator gives counter-clockwise triangles in the panel plane: that faces the panel normal
      if (flip) tris.push(a, c, b); else tris.push(a, b, c);
    }
    edgeIdx[name] = m.edgeVerts.map((ev) => ev.map((i) => base + i));
  }
  const N = X0.length / 3;
  const cloth = new Cloth(warm && warm.x.length === N * 3 ? warm.x : Float32Array.from(X0));

  /* ---- constraints: stretch + bending from the flat panels, seams ---- */
  const d2 = (a, b) => Math.hypot(P2[a * 2] - P2[b * 2], P2[a * 2 + 1] - P2[b * 2 + 1]);
  const edges = new Map();
  const key = (a, b) => (a < b ? a * N + b : b * N + a);
  for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
    const a = tris[t + q], b = tris[t + ((q + 1) % 3)], c = tris[t + ((q + 2) % 3)], k = key(a, b);
    const e = edges.get(k);
    if (e) e.push(c); else edges.set(k, [a, b, c]);
  }
  const sp = [], sr = [], bp = [], br = [];
  for (const [a, b, c, d] of edges.values()) {
    sp.push(a, b); sr.push(d2(a, b));
    if (d != null) { bp.push(c, d); br.push(d2(c, d)); }
  }
  cloth.addGroup(sp, sr, fab.stretch).limit = 1.08;
  cloth.addGroup(bp, br, fab.bend);
  // stitches: each point to the point at the same fraction of the other edge (a gathered edge ruffles)
  const seamPairs = [], seamRest = [], seen = new Set();
  const p3 = (i) => new THREE.Vector3(X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2]);
  for (const [sa, sb] of pattern.stitches) {
    const A = edgeIdx[sa.panel]?.[sa.edge], B = edgeIdx[sb.panel]?.[sb.edge];
    if (!A || !B) continue;
    const same = p3(A[0]).distanceTo(p3(B[0])) + p3(A.at(-1)).distanceTo(p3(B.at(-1)));
    const cross = p3(A[0]).distanceTo(p3(B.at(-1))) + p3(A.at(-1)).distanceTo(p3(B[0]));
    const Bo = cross < same ? B.slice().reverse() : B;
    const pair = (a, b) => { const k = key(a, b); if (a === b || seen.has(k)) return; seen.add(k); seamPairs.push(a, b); seamRest.push(p3(a).distanceTo(p3(b))); };
    for (let i = 0; i < A.length; i++) pair(A[i], Bo[Math.round((i / (A.length - 1)) * (Bo.length - 1))]);
    for (let j = 0; j < Bo.length; j++) pair(A[Math.round((j / (Bo.length - 1)) * (A.length - 1))], Bo[j]);
  }
  const seam = cloth.addGroup(seamPairs, seamRest, 0);
  const rest0 = Float32Array.from(seamRest);

  /* ---- the body in the sewing pose: arms along GarmentCode's sleeves (~45° down) ---- */
  let simPose = display;
  if (!warm) {
    const hasSleeves = Object.keys(pattern.panels).some((k) => /sleeve/.test(k));
    if (hasSleeves || Object.values(pattern.panels).some((p) => Math.abs(p.translation[0]) > 25)) {
      armsAlong(body, human, { l: 0.79, r: 0.79 });
      simPose = snapPose(bones);
    }
    if (Object.keys(pattern.panels).some((k) => /pant/.test(k))) {
      legsApart(body, human, 9);
      simPose = snapPose(bones);
    }
  }
  const underPts = under.map((u) => u.pts), underNrm = under.map((u) => u.nrm);
  const skinNow = () => skinBody(body, human, ctx.Qc, ctx.WL);
  const collider = (sk) => {
    const cnt = nb + underPts.reduce((a, u) => a + u.length / 3, 0);
    const pts = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3);
    pts.set(sk.Q); nrm.set(sk.N);
    let o = nb * 3;
    underPts.forEach((u, k) => { pts.set(u, o); nrm.set(underNrm[k], o); o += u.length; });
    return makeCollider(pts, nrm, 0.03);
  };
  let sk = skinNow(), col = collider(sk);
  const thick = 0.004 + (under.length ? 0.003 : 0) + fab.thick;
  const G = -9.81, dt = 1 / 60, SUB = 4;

  // a skirt's / trousers' waist edge grips the body where it's worn (a waistband, elastic or buttoned, does
  // not slide down): each waist point is held to the skin under it
  let setAnchors = () => {};
  const gripWaist = (Xs) => {                   // once sewn: the waist edge as it hangs now, held to the skin under it
    if (upperGarment) return;
    const segs = new Set(seamPairs);
    const open = new Set();
    for (const [a, b, , d] of edges.values()) if (d == null && !(segs.has(a) && segs.has(b))) { open.add(a); open.add(b); }
    let topY = -Infinity; for (const k of open) topY = Math.max(topY, Xs[k * 3 + 1]);
    // the waist edge is a level ring: each point grips the skin at the ring's height beside it (its own nearest
    // skin point would be higher or lower from point to point — a zig-zag edge)
    const top = [...open].filter((k) => Xs[k * 3 + 1] > topY - 0.03);
    const yRing = top.reduce((a, k) => a + Xs[k * 3 + 1], 0) / (top.length || 1);
    // points sewn together (a dart's two sides, a side seam) grip the same spot — gripped apart, a dart that
    // isn't closed yet would be held open (a saw-tooth of open darts along the waist)
    const par = new Map(), find = (k) => { while (par.has(k) && par.get(k) !== k) k = par.get(k); return k; };
    for (const k of top) par.set(k, k);
    for (let q = 0; q < seamPairs.length; q += 2) {
      const a = seamPairs[q], b = seamPairs[q + 1];
      if (par.has(a) && par.has(b)) par.set(find(a), find(b));
    }
    const groups = new Map();
    for (const k of top) { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); }
    const idx = [], src = [];
    for (const g of groups.values()) {
      let x = 0, z = 0; for (const k of g) { x += Xs[k * 3]; z += Xs[k * 3 + 2]; }
      x /= g.length; z /= g.length;
      const i = ctx.nearestSkin(x, yRing, z, (q) => !/arm|hand|head/.test(reg[q]) && Math.abs(ctx.Q[q * 3 + 1] - yRing) < 0.012, 10);
      if (i >= 0) for (const k of g) { idx.push(k); src.push(i); }
    }
    if (!idx.length) return;
    const t = new Float32Array(idx.length * 3);
    cloth.anchors = { idx: Uint32Array.from(idx), t, k: 0.3 };
    setAnchors = (sk) => {
      const g = thick + 0.004;
      src.forEach((i, q) => { for (let c = 0; c < 3; c++) t[q * 3 + c] = sk.Q[i * 3 + c] + sk.N[i * 3 + c] * g; });
    };
    setAnchors(sk);
  };

  let sewn = null;                              // cloth as sewn in the sewing pose (for the texture projection)
  if (!warm) {
    cloth.stick = 0;
    const SEW = upperGarment ? 90 : 140;
    let stopNow = false;
    for (let t = 0; t < SEW; t++) {
      if (globalThis.__sewStop === 'f' + t) { stopNow = true; break; }
      if (t === Math.round(SEW * 0.6)) gripWaist(cloth.x);     // seams nearly closed, before the weight comes on
      const k = Math.max(0, 1 - (t + 1) / (SEW * 0.7));
      for (let q = 0; q < rest0.length; q++) seam.rest[q] = rest0[q] * k;
      cloth.step(dt, SUB, G * smooth(SEW * 0.6, SEW, t), col, thick);
      if (globalThis.__sewLog) { let a = 0, b = 9, gap = 0; for (let k = 0; k < N; k++) { a = Math.max(a, cloth.x[k * 3 + 1]); b = Math.min(b, cloth.x[k * 3 + 1]); } for (let q = 0; q < seamPairs.length; q += 2) { const i = seamPairs[q] * 3, j = seamPairs[q + 1] * 3; gap = Math.max(gap, Math.hypot(cloth.x[i] - cloth.x[j], cloth.x[i + 1] - cloth.x[j + 1], cloth.x[i + 2] - cloth.x[j + 2])); } globalThis.__sewLog.push([t, a.toFixed(3), b.toFixed(3), gap.toFixed(3)]); }
    }
    cloth.stick = 1;
    if (!stopNow) {
      for (let t = 0; t < 40; t++) cloth.step(dt, SUB, G, col, thick);
    }
    sewn = Float32Array.from(cloth.x);
    if (globalThis.__sewStop === 'sewn' || stopNow) {                      // debug: the raw cloth as sewn
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(cloth.x), 3));
      gg.setIndex(tris); gg.computeVertexNormals();
      const m = new THREE.Mesh(gg, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }));
      human.object.add(m);
      return { mesh: m, hide: new Set(), posed: { pts: sewn, nrm: new Float32Array(sewn.length) }, state: null, follow() {}, dispose() { m.removeFromParent(); gg.dispose(); } };
    }
    if (simPose !== display) {
      // arms down to the pose shown: every point carried by the skin under it, the cloth relaxing as it goes
      const X = cloth.x, W = [], a = new Float64Array(12), restP = new Float64Array(N * 3);
      for (let k = 0; k < N; k++) {
        const arm = /sleeve|cuff/.test(panelOf[k]) ? (X[k * 3] > 0 ? 'arm_l' : 'arm_r') : null;
        // a trouser leg follows its own leg (above the crotch: the pelvis too)
        const leg = !arm && /pant/.test(panelOf[k]) ? (X[k * 3] > 0 ? 'leg_r' : 'leg_l') : null;
        const i = ctx.nearestSkin(X[k * 3], X[k * 3 + 1], X[k * 3 + 2], arm ? (q) => reg[q] === arm
          : leg ? (q) => reg[q] !== leg && reg[q] !== 'head' && !/arm|hand/.test(reg[q]) : (q) => reg[q] !== 'head' && reg[q] !== 'hand', 8);
        W.push(i >= 0 ? ctx.WL[i] : [[body.boneIndex.pelvis, 1]]);
      }
      for (let k = 0; k < N; k++) {
        affineOf(W[k], sk.ME, a);
        const m = inv3(a), x = X[k * 3] - a[9], y = X[k * 3 + 1] - a[10], z = X[k * 3 + 2] - a[11];
        restP[k * 3] = m[0] * x + m[3] * y + m[6] * z; restP[k * 3 + 1] = m[1] * x + m[4] * y + m[7] * z; restP[k * 3 + 2] = m[2] * x + m[5] * y + m[8] * z;
      }
      const STEPS = 24, prev = new Float32Array(N * 3), cur = new Float32Array(N * 3);
      const place = (ME, outArr) => { for (let k = 0; k < N; k++) { affineOf(W[k], ME, a); applyA(a, restP[k * 3], restP[k * 3 + 1], restP[k * 3 + 2], outArr, k * 3); } };
      place(sk.ME, prev);
      for (let t = 1; t <= STEPS; t++) {
        lerpPose(bones, simPose, display, smooth(0, 1, t / STEPS));
        sk = skinNow(); col = collider(sk); setAnchors(sk);
        place(sk.ME, cur);
        for (let q = 0; q < N * 3; q++) { const dd = cur[q] - prev[q]; cloth.x[q] += dd; cloth.p[q] += dd; }
        prev.set(cur);
        for (let r = 0; r < 3; r++) cloth.step(dt, SUB, G, col, thick);
      }
    }
  }
  if (warm) gripWaist(cloth.x);
  setPose(bones, display);
  human.object.updateMatrixWorld(true);
  sk = skinNow(); col = collider(sk); setAnchors(sk);
  for (let t = 0; t < (warm ? 50 : 80); t++) cloth.step(dt, SUB, G, col, thick, t > 50 ? 0.97 : 0.995);
  const X = cloth.x;
  // seams closed exactly: every stitched point on the midpoint of its pair(s) — one surface, no slit
  // (the same point → the same skin weights → it stays closed in every pose)
  for (let it = 0; it < 3; it++) {
    const acc = new Float64Array(N * 3), cnt = new Uint16Array(N);
    for (let q = 0; q < seamPairs.length; q += 2) {
      const a = seamPairs[q], b = seamPairs[q + 1];
      for (let c = 0; c < 3; c++) { const m = (X[a * 3 + c] + X[b * 3 + c]) / 2; acc[a * 3 + c] += m; acc[b * 3 + c] += m; }
      cnt[a]++; cnt[b]++;
    }
    for (let k = 0; k < N; k++) if (cnt[k]) for (let c = 0; c < 3; c++) X[k * 3 + c] = acc[k * 3 + c] / cnt[k];
  }

  /* ---- relief from the 3D model (TRELLIS.2, fitted on this body): where its surface stands off ours along our
     normal — a cargo pocket, a fold, a collar's roll — the sewn garment takes that shape; only outward (never
     into the body), at most 3 cm, smoothed over the surface so it's fabric, not noise ---- */
  if (detail) {
    const VN = new Float32Array(N * 3);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { VN[v] += nx; VN[v + 1] += ny; VN[v + 2] += nz; }
    }
    const dcol = makeCollider(detail.pts, new Float32Array(detail.pts.length), 0.04);
    const off = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const l = Math.hypot(VN[k * 3], VN[k * 3 + 1], VN[k * 3 + 2]) || 1;
      const nx = VN[k * 3] / l, ny = VN[k * 3 + 1] / l, nz = VN[k * 3 + 2] / l;
      VN[k * 3] = nx; VN[k * 3 + 1] = ny; VN[k * 3 + 2] = nz;
      // the model's local relief at the nearest point of it (a pocket stands out, a crease sinks in)
      const c = dcol.nearest(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]);
      off[k] = c >= 0 ? Math.max(-0.008, Math.min(0.03, detail.h[c])) : 0;
    }
    const nbr = Array.from({ length: N }, () => []);
    for (const [a, b] of edges.values()) { nbr[a].push(b); nbr[b].push(a); }
    const tmp = new Float32Array(N);
    for (let it = 0; it < 2; it++) {
      for (let k = 0; k < N; k++) { let sum = off[k], c = 1; for (const j of nbr[k]) { sum += off[j]; c++; } tmp[k] = sum / c; }
      off.set(tmp);
    }
    for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) X[k * 3 + c] += VN[k * 3 + c] * off[k];
    globalThis.__relief = { max: off.reduce((a, v) => Math.max(a, v), 0), over1cm: off.filter((v) => v > 0.01).length, N, hmax: detail.h.reduce((a, v) => Math.max(a, v), 0), hn: detail.h.filter((v) => v > 0.01).length, hN: detail.h.length };
  }

  /* ---- texture: baked in pattern space from the photos (bake.js) ---- */
  const baked = bakeGarment({
    N, X, tris, P2,
    panels: Object.entries(panelInfo).map(([name, p]) => ({ name, base: p.base, count: p.count, front: p.front, grain: /sleeve|cuff/.test(name) ? 'u' : 'v', limb: /sleeve|cuff/.test(name) })),
    lower: !upperGarment,
  }, photos, detail);
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
  const atlas = { map: tex(baked.map, true), normalMap: tex(baked.normal, false), W: baked.W, H: baked.H, front: { h: baked.H } };
  const verts = [];
  for (let k = 0; k < N; k++) verts.push({ uv: [baked.uv[k * 2], baked.uv[k * 2 + 1]] });
  const s = baked.H / baked.ppm;                       // finish(): metres per texel = s / H
  globalThis.__bake = { frame: baked.frame, patch: baked.patch, W: baked.W, H: baked.H, ppm: baked.ppm };

  /* ---- the waistline trued (as a pattern-maker redraws it once the darts are sewn): a closed dart's two top
     corners meet in a point that sticks up above the waist — every point is brought down to the waistline ---- */
  if (!upperGarment) {
    const segs = new Set(seamPairs), open = new Set();
    for (const [a, b, , d] of edges.values()) if (d == null && !(segs.has(a) && segs.has(b))) { open.add(a); open.add(b); }
    let topY = -Infinity; for (const k of open) topY = Math.max(topY, X[k * 3 + 1]);
    const ys = [...open].map((k) => X[k * 3 + 1]).filter((y) => y > topY - 0.06).sort((a, b) => a - b);
    const line = ys[Math.floor(ys.length * 0.35)] ?? topY;
    for (let k = 0; k < N; k++) if (X[k * 3 + 1] > line) X[k * 3 + 1] = line + (X[k * 3 + 1] - line) * 0.15;
  }

  /* ---- last word: nothing of the finished garment inside the body (seam closing and the relief move points
     after the simulation) — every point closer than the fabric's thickness is put back out along the skin ---- */
  {
    const cSk = collider(sk);
    for (let it = 0; it < 3; it++) for (let k = 0; k < N; k++) {
      const c = cSk.nearest(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]);
      if (c < 0) continue;
      const P = cSk.pts, Nn = cSk.nrm;
      const d = (X[k * 3] - P[c * 3]) * Nn[c * 3] + (X[k * 3 + 1] - P[c * 3 + 1]) * Nn[c * 3 + 1] + (X[k * 3 + 2] - P[c * 3 + 2]) * Nn[c * 3 + 2];
      if (d < thick) for (let q = 0; q < 3; q++) X[k * 3 + q] += Nn[c * 3 + q] * (thick - d);
    }
  }

  /* ---- skin weights, hidden skin, mesh ---- */
  const weights = [];
  for (let k = 0; k < N; k++) {
    const src = ctx.nearestSkin(X[k * 3], X[k * 3 + 1], X[k * 3 + 2], (i) => reg[i] !== 'head' && reg[i] !== 'hand', 6);
    verts[k].src = src;
    weights.push(src >= 0 ? ctx.WL[src] : [[body.boneIndex.pelvis, 1]]);
  }
  const cg = makeCollider(X, new Float32Array(X.length), 0.035);
  // skin the garment covers (hidden: it can't poke through): the cloth right above it, along its normal —
  // past an open edge (neck, hem, cuffs) the nearest cloth is off to the side, so that skin stays drawn
  const hide = new Set(), Qs = sk.Q, Ns = sk.N;
  for (let i = 0; i < nb; i++) {
    if (ctx.part[i] !== 0 || reg[i] === 'head' || reg[i] === 'hand') continue;
    const c = cg.nearest(Qs[i * 3], Qs[i * 3 + 1], Qs[i * 3 + 2]);
    if (c < 0) continue;
    const dx = X[c * 3] - Qs[i * 3], dy = X[c * 3 + 1] - Qs[i * 3 + 1], dz = X[c * 3 + 2] - Qs[i * 3 + 2];
    const dn = dx * Ns[i * 3] + dy * Ns[i * 3 + 1] + dz * Ns[i * 3 + 2];
    const dt2 = dx * dx + dy * dy + dz * dz - dn * dn;
    if (dn > -0.003 && dn < 0.045 && dt2 < 0.02 * 0.02) hide.add(i);
  }
  const res = finish(ctx, item, atlas, { verts, idx: tris, posed: X, weights, hide, covered: (i) => hide.has(i), s, thickness: fab.thick, cutout: false });
  res.state = { x: Float32Array.from(X) };
  if (globalThis.__sewDebug) globalThis.__sewDebug = { ctx, cloth, pattern, panelInfo, N, tris: tris.length / 3, seams: seamPairs.length / 2 };
  return res;
}
