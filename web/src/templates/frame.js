/**
 * The body a template is worn on, measured: landmarks, and the smooth surfaces fabric lies on — a TORSO tube (rings
 * round the body, height by height) and a tube along each ARM — with the fixed texture layout every template shares.
 *
 * TEXTURE LAYOUT (atlas.js draws it): one 2048² PNG per template, like a game skin —
 *   TORSO_FRONT  x 0…1024,    y 0…1536   the front as seen from the front (image left = the wearer's right)
 *   TORSO_BACK   x 1024…2048, y 0…1536   the back as seen from behind (image left = the wearer's left)
 *   SLEEVE_R     x 0…1024,    y 1536…1792  along the arm → x (shoulder joint at 0), around → y (top, front, under, back)
 *   SLEEVE_L     x 0…1024,    y 1792…2048
 *   LEG_R / LEG_L x 1024…2048, y 1536…1792 / 1792…2048 (reserved)
 * Rows of the torso panels are BODY-RELATIVE (landmarks: a hem drawn at "hip" sits at the hips on any body):
 *   v = 0 neck top · 0.03 neck base · 0.07 shoulder line · 0.17 armpit · 0.33 waist · 0.45 hip · 0.53 crotch ·
 *       0.76 knee · 0.97 ankle · 1 floor
 * Across a panel, u is the arc length round the body (front: side to side through the front centre).
 * Sleeves: along 0 shoulder joint · 0.45 elbow · 0.9 wrist · 1 (past the wrist); around 0 top · 0.25 front ·
 * 0.5 under · 0.75 back (the same on both arms).
 */
import * as THREE from 'three';

export const ATLAS = 2048;
export const RECT = {
  torsoFront: [0, 0, 1024, 1536], torsoBack: [1024, 0, 1024, 1536],
  sleeveR: [0, 1536, 1024, 256], sleeveL: [0, 1792, 1024, 256],
  legR: [1024, 1536, 1024, 256], legL: [1024, 1792, 1024, 256],
};
export const TORSO_V = [['neckTop', 0], ['neckBase', 0.03], ['shoulder', 0.07], ['armpit', 0.17], ['waist', 0.33],
  ['hip', 0.45], ['crotch', 0.53], ['knee', 0.76], ['ankle', 0.97], ['floor', 1]];
export const SLEEVE_A = [['shoulder', 0], ['elbow', 0.45], ['wrist', 0.9]];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** convex hull (monotone chain) of 2D points → polygon */
function hull(pts) {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** distance from (cx, cy) along (dx, dy) to where the ray leaves the polygon */
function rayOut(poly, cx, cy, dx, dy) {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / den, u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}
/** piecewise-linear map through [[x, y] …] (x increasing) */
const pw = (pts) => (x) => {
  if (x <= pts[0][0]) return pts[0][1] + (x - pts[0][0]) * (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
  for (let k = 1; k < pts.length; k++) if (x <= pts[k][0]) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0); }
  const n = pts.length; return pts[n - 1][1] + (x - pts[n - 1][0]) * (pts[n - 1][1] - pts[n - 2][1]) / (pts[n - 1][0] - pts[n - 2][0]);
};

const REGION = (name) => {
  const m = name.match(/_(l|r)$/);
  if (m && /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/.test(name)) return 'arm_' + m[1];
  if (m && /^(thigh|calf|foot|ball)/.test(name)) return 'leg_' + m[1];
  if (/^head/.test(name)) return 'head';
  return 'torso';
};

/** the active body as it is now (rest pose, current shape): points, regions, joints, landmarks */
export function measureBody(human) {
  const B = human.active, mesh = B.mesh, g = mesh.geometry;
  mesh.userData.cpuMorphUpdate?.();
  const P = g.attributes.position.array, MP = g.attributes.morphPos?.array, n = P.length / 3;
  // the body AS IT STANDS (its current pose and shape): a garment is made on it here, then taken back to the rig's
  // rest pose (unskin) — so it fits the pose it's seen in exactly, and follows any other pose by its skinning
  human.object.updateMatrixWorld(true);
  mesh.skeleton.update();
  const Q = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3] + (MP ? MP[i * 3] : 0), P[i * 3 + 1] + (MP ? MP[i * 3 + 1] : 0), P[i * 3 + 2] + (MP ? MP[i * 3 + 2] : 0));
    mesh.applyBoneTransform(i, v);
    Q[i * 3] = v.x; Q[i * 3 + 1] = v.y; Q[i * 3 + 2] = v.z;
  }
  const names = B.bones.map((b) => b.name), regOf = names.map(REGION);
  const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, part = g.attributes._part.array;
  const region = new Array(n);
  for (let i = 0; i < n; i++) {
    const acc = {};
    for (let k = 0; k < 4; k++) { const r = regOf[si[i * 4 + k]]; acc[r] = (acc[r] || 0) + sw[i * 4 + k]; }
    let best = 'torso', bw = -1; for (const r in acc) if (acc[r] > bw) { bw = acc[r]; best = r; }
    region[i] = best;
  }
  const joint = (name) => new THREE.Vector3().setFromMatrixPosition(B.bones[names.indexOf(name)].matrixWorld).applyMatrix4(mesh.bindMatrixInverse);
  const probes = B.probes;
  const neck = joint('neck_01');
  const shoulder = probes ? (Q[probes.l * 3 + 1] + Q[probes.r * 3 + 1]) / 2 : neck.y - 0.05;
  let crotch = Infinity;
  for (let i = 0; i < n; i++) if (part[i] < 0.5 && region[i] === 'torso' && Math.abs(Q[i * 3]) < 0.02) crotch = Math.min(crotch, Q[i * 3 + 1]);
  const skin = (i) => part[i] < 0.5;
  const body = { B, mesh, g, n, Q, region, part, skin, joint, names };
  // the torso's girth by height (its convex hull's perimeter): the waist is the narrowest above the hips, the hips
  // the widest below the waist
  const girthAt = (y) => {
    const pts = [];
    for (let i = 0; i < n; i++) if (skin(i) && (region[i] === 'torso' || region[i].startsWith('leg')) && Math.abs(Q[i * 3 + 1] - y) < 0.006) pts.push([Q[i * 3], Q[i * 3 + 2]]);
    const h = hull(pts); let s = 0; for (let k = 0; k < h.length; k++) { const a = h[k], b = h[(k + 1) % h.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    return s;
  };
  const armpit = shoulder - 0.2 * (shoulder - crotch);
  let waist = armpit, wBest = Infinity;
  for (let y = crotch + 0.45 * (armpit - crotch); y < crotch + 0.8 * (armpit - crotch); y += 0.01) { const gth = girthAt(y); if (gth > 0 && gth < wBest) { wBest = gth; waist = y; } }
  let hip = crotch, hBest = 0;
  for (let y = crotch + 0.02; y < waist - 0.04; y += 0.01) { const gth = girthAt(y); if (gth > hBest) { hBest = gth; hip = y; } }
  const L = {
    neckTop: neck.y + 0.04, neckBase: neck.y, shoulder, armpit, waist, hip, crotch,
    knee: (joint('calf_l').y + joint('calf_r').y) / 2, ankle: (joint('foot_l').y + joint('foot_r').y) / 2, floor: 0,
  };
  body.L = L;
  body.neck = neck;
  // rows of the torso panels ↔ heights
  const anchors = TORSO_V.map(([k, v]) => [v, L[k]]);
  body.yOfV = pw(anchors);
  body.vOfY = pw([...anchors].reverse().map(([v, y]) => [y, v]));
  return body;
}

/* ------------------------------------------------------------------ the torso surface */

/**
 * Rings round the torso, every `step` m from y0 down to y1: per ring a centre and the fabric's radius by angle
 * (θ = atan2(x, z): 0 the front centre, +π/2 the wearer's left). The body's slice wrapped in its convex hull,
 * enveloped over ±`span` m (the fabric spans the hollows), plus `ease(θ, y)`, then `fall`: going down it never comes
 * in faster than that (m per m) — a woven top falls straight off the chest.
 * @returns { ys, rings: [{ y, cx, cz, R: Float64Array(NA) }], at(θ, y) → [x, y, z], NA }
 */
export function torsoSurface(body, { y0, y1, step = 0.005, span = 0.025, ease = () => 0.01, fall = 0.05, fallFrom = null, skirt = false, cap = 0, minGap = 0.006 }) {
  const { Q, n, region, skin, L, joint } = body, NA = 180;
  // the shoulder caps (the arm within `cap` m of the shoulder joint, along the arm): part of the torso's surface — the
  // garment's shoulder runs over them (a dropped shoulder), its sleeves start past them
  const caps = {};
  if (cap > 0) for (const s of ['l', 'r']) { const S = joint(`upperarm_${s}`), E = joint(`lowerarm_${s}`), a = E.clone().sub(S).normalize(); caps['arm_' + s] = { S, a }; }
  // (faded out toward its end: points past half of it are drawn in toward the shoulder joint — no step where it stops)
  const inCap = (i, r) => { const c = caps[r]; if (!c) return 0; const al = (Q[i * 3] - c.S.x) * c.a.x + (Q[i * 3 + 1] - c.S.y) * c.a.y + (Q[i * 3 + 2] - c.S.z) * c.a.z; return al < cap ? 1 - smooth(cap * 0.4, cap, al) : 0; };
  const rows = []; for (let y = y0; y >= y1 - 1e-9; y -= step) rows.push(y);
  // points of each row's band (±6 mm): torso, legs above the crotch (or all of the legs, for a skirt)
  const band = 0.006, pts = rows.map(() => []);
  for (let i = 0; i < n; i++) {
    if (!skin(i) && !(body.part[i] > 3.5 && body.part[i] < 4.5)) continue;     // (the underwear too: a garment goes over it)
    const r = region[i], y = Q[i * 3 + 1];
    const fc = r.startsWith('arm') ? inCap(i, r) : 1;
    if (!(r === 'torso' || (r.startsWith('leg') && (skirt || y > L.crotch - 0.005)) || fc > 0)) continue;
    const k0 = Math.max(0, Math.ceil((y0 - y - band) / step)), k1 = Math.min(rows.length - 1, Math.floor((y0 - y + band) / step));
    let px = Q[i * 3], pz = Q[i * 3 + 2];
    if (fc < 1) { const c = caps[r]; px = c.S.x + (px - c.S.x) * fc; pz = c.S.z + (pz - c.S.z) * fc; }
    for (let k = k0; k <= k1; k++) pts[k].push([px, pz]);
  }
  const raw = rows.map((y, k) => {
    if (pts[k].length < 8) return null;
    const poly = hull(pts[k]);
    let cx = 0, cz = 0; for (const q of poly) { cx += q[0]; cz += q[1]; } cx /= poly.length; cz /= poly.length;
    return { poly, cx, cz };
  });
  // fill gaps, smooth the centres
  const valid = raw.map((r) => !!r), cxs = new Float64Array(rows.length), czs = new Float64Array(rows.length);
  for (let k = 0; k < rows.length; k++) {
    let s = 0, c = 0, sz = 0;
    for (let d = -8; d <= 8; d++) { const r = raw[k + d]; if (r) { s += r.cx; sz += r.cz; c++; } }
    cxs[k] = c ? s / c : 0; czs[k] = c ? sz / c : 0;
  }
  const Rraw = rows.map((y, k) => {
    const r = raw[k]; if (!r) return null;
    const R = new Float64Array(NA);
    for (let a = 0; a < NA; a++) { const t = (a / NA) * Math.PI * 2; R[a] = rayOut(r.poly, cxs[k], czs[k], Math.sin(t), Math.cos(t)); }
    return R;
  });
  for (let k = 0; k < rows.length; k++) if (!Rraw[k]) {          // a missing row: its nearest neighbour's
    for (let d = 1; d < rows.length; d++) { const r = Rraw[k - d] || Rraw[k + d]; if (r) { Rraw[k] = r; break; } }
  }
  // the envelope over ±span (power mean: the high points carry the fabric), rounded round the ring (±4 bins)
  const sr = Math.max(1, Math.round(span / step));
  const R = rows.map((y, k) => {
    const out = new Float64Array(NA);
    for (let a = 0; a < NA; a++) {
      let s = 0, c = 0;
      for (let d = -sr; d <= sr; d++) { const rr = Rraw[k + d]; if (!rr) continue; const w = 1 - Math.abs(d) / (sr + 1); s += w * rr[a] ** 3; c += w; }
      out[a] = (s / c) ** (1 / 3);
    }
    const o2 = new Float64Array(NA);
    for (let a = 0; a < NA; a++) { let s = 0; for (let d = -9; d <= 9; d++) s += out[(a + d + NA) % NA] * (10 - Math.abs(d)); o2[a] = s / 100; }
    return o2;
  });
  // the fabric spans the hollows up and down too (between the pecs and the abs, the abs' own ridges, the small of the
  // back): per angle, the upper hull of the profile (radius against height) from the shoulder line down
  for (let a = 0; a < NA; a++) {
    const H = [];
    for (let k = 0; k < rows.length; k++) {
      if (rows[k] > L.shoulder) continue;
      const q = [rows[k], R[k][a], k];
      while (H.length >= 2) {
        const o = H[H.length - 2], m = H[H.length - 1];
        // (y decreasing: m is under the chord o–q when the turn is the wrong way)
        if ((m[0] - o[0]) * (q[1] - o[1]) - (m[1] - o[1]) * (q[0] - o[0]) >= 0) H.pop(); else break;
      }
      H.push(q);
    }
    for (let h = 0; h + 1 < H.length; h++) {
      const [ya, ra, ka] = H[h], [yb, rb, kb] = H[h + 1];
      for (let k = ka + 1; k < kb; k++) { const r = ra + ((rb - ra) * (rows[k] - ya)) / (yb - ya); if (r > R[k][a]) R[k][a] = r; }
    }
  }
  // ease, then the fall (from the chest down)
  for (let k = 0; k < rows.length; k++) for (let a = 0; a < NA; a++) R[k][a] += ease((a / NA) * Math.PI * 2, rows[k]);
  for (let k = 1; k < rows.length; k++) {
    // (eased in round the armpit: no crease where it starts)
    const yf = fallFrom ? L[fallFrom] - 0.03 : L.armpit, f = fall + 4 * (1 - smooth(yf + 0.06, yf - 0.06, rows[k]));
    for (let a = 0; a < NA; a++) R[k][a] = Math.max(R[k][a], R[k - 1][a] - f * step);
  }
  // smoothed down the body (no ridges where one ring's few points differ from the next): ±1 cm above the shoulder
  // line, ±4 cm below it
  {
    for (let pass = 0; pass < 2; pass++) {
      const S = R.map((r) => Float64Array.from(r));
      for (let k = 0; k < rows.length; k++) {
        const w = Math.round((0.012 + 0.06 * smooth(L.shoulder, L.waist, rows[k])) / step);
        for (let a = 0; a < NA; a++) {
          let s = 0, c = 0;
          for (let d = -w; d <= w; d++) { const kk = k + d; if (kk < 0 || kk >= rows.length) continue; const q = 1 - Math.abs(d) / (w + 1); s += S[kk][a] * q; c += q; }
          R[k][a] = s / c;
        }
      }
    }
    // the centres likewise
    const X = Float64Array.from(cxs), Z = Float64Array.from(czs), w = Math.round(0.08 / step);
    for (let k = 0; k < rows.length; k++) { let s = 0, sz = 0, c = 0; for (let d = -w; d <= w; d++) { const kk = k + d; if (kk < 0 || kk >= rows.length) continue; s += X[kk]; sz += Z[kk]; c++; } cxs[k] = s / c; czs[k] = sz / c; }
  }
  // the last word: a gentle smoothing pass down the body (±2 cm, 3 times) over the finished surface — the hull, the
  // ease and the fall each leave sub-millimetre kinks that light as stripes across 5 mm rows
  for (let pass = 0; pass < 3; pass++) {
    const S = R.map((r) => Float64Array.from(r)), w = Math.round(0.02 / step);
    for (let k = 0; k < rows.length; k++) {
      if (rows[k] > L.neckBase) continue;
      for (let a = 0; a < NA; a++) { let s = 0, c = 0; for (let d = -w; d <= w; d++) { const kk = k + d; if (kk < 0 || kk >= rows.length) continue; const q = w + 1 - Math.abs(d); s += S[kk][a] * q; c += q; } R[k][a] = s / c; }
    }
  }
  const rings = rows.map((y, k) => ({ y, cx: cxs[k], cz: czs[k], R: R[k] }));
  const ringAt = (y) => {
    const f = Math.max(0, Math.min(rows.length - 1.0001, (y0 - y) / step)), k = Math.floor(f), t = f - k;
    return [rings[k], rings[k + 1] || rings[k], t];
  };
  const rAt = (ring, th) => { let f = (((th / (Math.PI * 2)) % 1) + 1) % 1 * NA; const a0 = Math.floor(f) % NA, a1 = (a0 + 1) % NA; f -= Math.floor(f); return ring.R[a0] * (1 - f) + ring.R[a1] * f; };
  const at = (th, y) => {
    const [A, Bq, t] = ringAt(y), cx = A.cx + (Bq.cx - A.cx) * t, cz = A.cz + (Bq.cz - A.cz) * t, r = rAt(A, th) * (1 - t) + rAt(Bq, th) * t;
    return [cx + Math.sin(th) * r, y, cz + Math.cos(th) * r];
  };
  // arc length round a ring, per half (front: θ −π/2 → π/2; back, seen from behind: θ π/2 → 3π/2):
  // u ↔ θ tables at the ring's height
  const halves = (y) => {
    const M = 96, out = {};
    for (const [key, t0] of [['front', -Math.PI / 2], ['back', Math.PI / 2]]) {
      const th = new Float64Array(M + 1), Ls = new Float64Array(M + 1); let prev = null;
      for (let m = 0; m <= M; m++) {
        th[m] = t0 + (m / M) * Math.PI; const p = at(th[m], y);
        if (prev) Ls[m] = Ls[m - 1] + Math.hypot(p[0] - prev[0], p[2] - prev[2]); prev = p;
      }
      for (let m = 0; m <= M; m++) Ls[m] /= Ls[M] || 1;
      out[key] = { th, Ls };
    }
    return out;
  };
  const thOfU = (h, u) => { const { th, Ls } = h; let m = 1; while (m < Ls.length - 1 && Ls[m] < u) m++; const t = (u - Ls[m - 1]) / ((Ls[m] - Ls[m - 1]) || 1); return th[m - 1] + (th[m] - th[m - 1]) * t; };
  const uOfTh = (h, t) => { const { th, Ls } = h; const f = Math.max(0, Math.min(th.length - 1.0001, ((t - th[0]) / (th[th.length - 1] - th[0])) * (th.length - 1))), m = Math.floor(f); return Ls[m] + (Ls[m + 1] - Ls[m]) * (f - m); };
  /** is a point inside the fabric's surface (at its height)? → signed distance, horizontal (< 0 inside) */
  const outside = (x, y, z) => {
    if (y > rows[0] || y < rows[rows.length - 1]) return 1;
    const [A, Bq, t] = ringAt(y), cx = A.cx + (Bq.cx - A.cx) * t, cz = A.cz + (Bq.cz - A.cz) * t, th = Math.atan2(x - cx, z - cz);
    return Math.hypot(x - cx, z - cz) - (rAt(A, th) * (1 - t) + rAt(Bq, th) * t);
  };
  return { rows, rings, at, halves, thOfU, uOfTh, NA, outside, centreAt: (y) => { const [A, Bq, t] = ringAt(y); return [A.cx + (Bq.cx - A.cx) * t, A.cz + (Bq.cz - A.cz) * t]; } };
}

/* ------------------------------------------------------------------ the arms */

/**
 * A tube along one arm (shoulder joint → elbow → wrist): per 5 mm along, the arm's cross-section (its convex hull)
 * by angle φ round the arm (0 the top, π/2 the front, π underneath), as `shape(φ, along, Rarm)` makes it.
 * @returns { at(φ, along) → [x, y, z], aOfV, vOfA, len, frame(x, y, z) → [along, φ] }
 */
export function armSurface(body, side, { a0 = -0.05, a1, shape, meet = null }) {
  const { Q, n, region, skin, joint } = body;
  const S = joint(`upperarm_${side}`), E = joint(`lowerarm_${side}`), W = joint(`hand_${side}`);
  const segs = [[S, E], [E, W]].map(([p, q]) => {
    const a = q.clone().sub(p), len = a.length(); a.normalize();
    // front: +z across the arm; top: the side that's up with the arm held out (outward with it hanging)
    const f = new THREE.Vector3(0, 0, 1).addScaledVector(a, -a.z).normalize();
    const up = new THREE.Vector3().crossVectors(a, f).multiplyScalar(side === 'r' ? 1 : -1).normalize();
    return { p, a, len, up, f };
  });
  const L1 = segs[0].len, L2 = segs[1].len;
  const frame = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z);
    let s = segs[0], t = v.clone().sub(s.p).dot(s.a), along = t;
    if (t > L1) { s = segs[1]; t = v.clone().sub(s.p).dot(s.a); along = L1 + t; }
    const r = v.clone().sub(s.p).addScaledVector(s.a, -t);
    return [along, Math.atan2(r.dot(s.f), r.dot(s.up)), r.length()];
  };
  const STEP = 0.005, NA = 96, nb = Math.ceil((a1 - a0) / STEP) + 1;
  const pts = Array.from({ length: nb }, () => []);
  for (let i = 0; i < n; i++) {
    if (!skin(i) || region[i] !== `arm_${side}`) continue;
    const [along, phi, r] = frame(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]);
    const k = Math.round((along - a0) / STEP);
    for (let d = -1; d <= 1; d++) if (k + d >= 0 && k + d < nb) pts[k + d].push([Math.sin(phi) * r, Math.cos(phi) * r]);
  }
  let Rarm = pts.map((p) => {
    if (p.length < 8) return null;
    const poly = hull(p), R = new Float64Array(NA);
    for (let a = 0; a < NA; a++) { const t = (a / NA) * Math.PI * 2; R[a] = rayOut(poly, 0, 0, Math.sin(t), Math.cos(t)); }
    return R;
  });
  const first = Rarm.findIndex(Boolean);
  for (let k = 0; k < nb; k++) if (!Rarm[k]) { for (let d = 1; d < nb; d++) { const r = Rarm[k + d] || Rarm[k - d]; if (r) { Rarm[k] = r; break; } } }
  if (first < 0) return null;
  // smoothed along the arm (±2.5 cm: one bin's few points jitter), the root (inside the shoulder) as the ring 3 cm out
  {
    // (never smaller there than further out: at the joint the arm's slice is cut by the torso)
    const k3 = Math.max(0, Math.round((0.03 - a0) / STEP));
    for (let k = 0; k < Math.min(k3, nb); k++) for (let a = 0; a < NA; a++) Rarm[k][a] = Math.max(Rarm[k][a], Rarm[Math.min(k3, nb - 1)][a]);
    const S = Rarm.map((r) => Float64Array.from(r)), w = 5;
    for (let k = 0; k < nb; k++) for (let a = 0; a < NA; a++) { let s = 0, c = 0; for (let d = -w; d <= w; d++) { const kk = k + d; if (kk < 0 || kk >= nb) continue; s += S[kk][a]; c++; } Rarm[k][a] = s / c; }
  }
  const R = shape(Rarm.map((r, k) => ({ along: a0 + k * STEP, R: r })), NA);
  const rAt = (phi, along) => {
    const f = Math.max(0, Math.min(nb - 1.0001, (along - a0) / STEP)), k = Math.floor(f), t = f - k;
    let g = (((phi / (Math.PI * 2)) % 1) + 1) % 1 * NA; const a = Math.floor(g) % NA, b = (a + 1) % NA; g -= Math.floor(g);
    const r0 = R[k][a] * (1 - g) + R[k][b] * g, r1 = R[k + 1][a] * (1 - g) + R[k + 1][b] * g;
    return r0 * (1 - t) + r1 * t;
  };
  // MEET (a sleeve set into a body): over its first `meet.len` m the sleeve's radius is where its ray from the arm's
  // axis comes out of the body's fabric (+ meet.over), blended into its own shape — the shoulder runs on into it
  const axisAt = (along) => { const s = along <= L1 ? segs[0] : segs[1], t = along <= L1 ? along : along - L1; return [s, s.p.clone().addScaledVector(s.a, t)]; };
  const meetR = (phi, along) => {
    const [s, O] = axisAt(along), dx = s.up.x * Math.cos(phi) + s.f.x * Math.sin(phi), dy = s.up.y * Math.cos(phi) + s.f.y * Math.sin(phi), dz = s.up.z * Math.cos(phi) + s.f.z * Math.sin(phi);
    const f = (r) => meet.outside(O.x + dx * r, O.y + dy * r, O.z + dz * r);
    let lo = 0.005, hi = 0.12;
    if (f(hi) < 0) return null;                    // (still inside at 25 cm: no exit that way)
    if (f(lo) > 0) return lo;
    for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
    return hi + meet.over;
  };
  const at = (phi, along) => {
    const [s, O] = axisAt(along);
    let r = rAt(phi, along);
    if (meet && along < meet.len) {
      const m = meetR(phi, along), w = 1 - smooth(meet.len * 0.35, meet.len, along);
      if (m != null) r = m * w + r * (1 - w);
    }
    const o = O.addScaledVector(s.up, Math.cos(phi) * r).addScaledVector(s.f, Math.sin(phi) * r);
    return [o.x, o.y, o.z];
  };
  const marks = [[0, 0], [L1, 0.45], [L1 + L2, 0.9]];
  return { at, frame, len: L1 + L2, upper: L1, aOfV: pw(marks.map(([a, v]) => [v, a])), vOfA: pw(marks) };
}

/* ------------------------------------------------------------------ skinning */

/**
 * Each garment vertex follows the body's skin under it: its 4 nearest skin vertices (inverse-square), their bones
 * and their shape-morph deltas. → { skinIndex, skinWeight, morph: [Float32Array] per body target, delta (current) }
 */
export function bindToBody(body, pos, { pull = null } = {}) {
  const { Q, n, skin, g, B } = body, m = pos.length / 3, C = 0.03, grid = new Map(), key = (a, b, c) => `${a},${b},${c}`;
  for (let i = 0; i < n; i++) {
    if (!skin(i)) continue;
    const k = key(Math.floor(Q[i * 3] / C), Math.floor(Q[i * 3 + 1] / C), Math.floor(Q[i * 3 + 2] / C));
    let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i);
  }
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
  const MP = g.morphAttributes.position || [], infl = B.mesh.morphTargetInfluences || [];
  const si = new Uint16Array(m * 4), sw = new Float32Array(m * 4), morph = MP.map(() => new Float32Array(m * 3)), delta = new Float32Array(m * 3);
  const near = [];
  for (let v = 0; v < m; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
    near.length = 0;
    for (let r = 1; r <= 4 && near.length < 4; r++) {
      near.length = 0;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        const l = grid.get(key(cx + a, cy + b, cz + c)); if (!l) continue;
        for (const i of l) near.push([(Q[i * 3] - x) ** 2 + (Q[i * 3 + 1] - y) ** 2 + (Q[i * 3 + 2] - z) ** 2, i]);
      }
    }
    near.sort((p, q) => p[0] - q[0]);
    const take = near.slice(0, 4), bones = new Map(); let wsum = 0;
    const ws = take.map(([d2]) => 1 / (d2 + 1e-6)); for (const w of ws) wsum += w;
    take.forEach(([, i], k) => {
      const w = ws[k] / wsum;
      for (let c = 0; c < 4; c++) { const b = SI[i * 4 + c], bw = SW[i * 4 + c] * w; if (bw > 0) bones.set(b, (bones.get(b) || 0) + bw); }
      MP.forEach((t, j) => { for (let c = 0; c < 3; c++) { const d = t.array[i * 3 + c] * w; morph[j][v * 3 + c] += d; delta[v * 3 + c] += d * (infl[j] || 0); } });
    });
    if (pull) pull(v, bones);
    const top = [...bones].sort((p, q) => q[1] - p[1]).slice(0, 4), tw = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (let c = 0; c < 4; c++) { si[v * 4 + c] = top[c] ? top[c][0] : 0; sw[v * 4 + c] = top[c] ? top[c][1] / tw : 0; }
  }
  return { si, sw, morph, delta };
}

/** posed (as built, mesh space) → the rig's rest pose, by each vertex's own skinning: rest = skin⁻¹ · posed */
export function unskin(mesh, pos, si, sw, nrm = null) {
  const bm = mesh.skeleton.boneMatrices, M = new THREE.Matrix4(), T = new THREE.Matrix4(), v = new THREE.Vector3();
  const B = mesh.bindMatrix, BI = mesh.bindMatrixInverse;
  for (let i = 0; i < pos.length / 3; i++) {
    const e = M.elements; e.fill(0);
    for (let k = 0; k < 4; k++) { const w = sw[i * 4 + k]; if (!w) continue; const o = si[i * 4 + k] * 16; for (let c = 0; c < 16; c++) e[c] += bm[o + c] * w; }
    T.multiplyMatrices(BI, M).multiply(B).invert();
    v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(T);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    // (a normal turns back with it: the skinning turns it the same way again)
    if (nrm) { v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).transformDirection(T); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z; }
  }
}

export { smooth, hull, rayOut, pw };
