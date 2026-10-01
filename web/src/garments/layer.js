/**
 * Clothes LAYERED ON THE BODYSUIT: a garment photographed on a hanger is worn exactly as it looks there — its cut,
 * length, sleeves, collar, print — at the bodysuit's own surface (human.js makeSuit: skin-tight, 1.5 mm off the
 * skin), following every pose and body-shape change with it.
 *
 * The garment is laid onto three charts of the body's surface:
 *   torso   the photo's body panel wrapped around the torso: the FRONT photo over the front half, the BACK photo
 *           over the back half, by arc length around each height (side seams at the sides), its shoulder line on
 *           the body's shoulder points; heights keep the garment's own proportions (scale: shoulder to shoulder)
 *   sleeves each sleeve wrapped around its arm: along it from the shoulder joint, around it from the top of the arm
 *           (the sleeve's top edge in the photo) over the front (front photo) to the underarm and back up the
 *           back (back photo)
 * Each chart is a texture resampled from the photos (torso: around × down, sleeve: around × along); the garment's
 * edges are the photo's own outline (alpha test), so a curved shirt-tail hem or a rolled cuff is exactly as shot.
 *
 *   const worn = layerGarment(human, { front: { cut }, back?: { cut } });
 *   // → { mesh, hide, deep, follow(influences), dispose() } (what tryon.js shows)
 *
 * cut: the cleaned cut-out (canvas, alpha = garment); its shape is measured here (photoOf). World/mesh space: metres, y up, the body faces +z, its left is +x; the front photo's
 * image-left is the body's right (−x), the back photo's image-left the body's left (+x).
 */
import * as THREE from 'three';
import { useCpuMorphs, patchMaterial } from '../human/cpumorph.js';
import { buildShell, buildAnchored, reskin } from './shell.js';
import { prepareFabric } from './fabric.js';
import { drapeField } from './drape.js';
import { limbCollider } from './collide.js';

const TORSO = { W: 1024, H: 1024, top: -0.32, bottom: 1.3 };     // h: metres below the shoulder line
const COLLAR = 0.09;                                             // the most a collar rises above the shoulder line (m)
const SLEEVE = { W: 512, L: 512, len: 0.95 };                    // along the arm from the shoulder joint (m)
const LIFT = 0.0012;                                             // over the bodysuit (m): the underwear (≥ 2.5 mm off the skin) stays under it

/* ------------------------------------------------------------------ the photo side */

/**
 * A garment on its hanger, from its cut-out: pixel access and its shape — the torso's side seams (lines fitted on the
 * straight band of the body, so a sleeve hanging beside it doesn't count), the shoulder line, the hem (the hanger
 * stand's legs below it cut off) and each sleeve (the garment outside the side seams, with its own axis).
 * Units: garment units = the cut's height; x right, y down.
 */
function photoOf({ cut }) {
  const w = cut.width, h = cut.height;
  const px = cut.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  // the outline cleaned: an opening (r ≈ 0.4 % of the height) takes off spikes and threads — what's left of the
  // hanger's hook or stand at the collar
  {
    const r = Math.max(2, Math.round(h * 0.004)), m = new Uint8Array(w * h), e = new Uint8Array(w * h), d = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) m[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    const pass = (src, dst, keep) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = keep ? 1 : 0;
        for (let q = -r; q <= r; q++) { const a = x + q >= 0 && x + q < w ? src[y * w + x + q] : 0, b = y + q >= 0 && y + q < h ? src[(y + q) * w + x] : 0; if (keep ? !(a && b) : a || b) { v = keep ? 0 : 1; break; } }
        dst[y * w + x] = v;
      }
    };
    pass(m, e, true); pass(e, d, false);
    for (let i = 0; i < w * h; i++) if (!d[i]) px[i * 4 + 3] = 0;
  }
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : px[(y * w + x) * 4 + 3]);
  // outer extent per pixel row
  const L = new Float32Array(h).fill(NaN), R = new Float32Array(h).fill(NaN);
  let top = -1, bot = -1;
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (A(x, y) > 127) { if (l < 0) l = x; r = x; }
    if (l >= 0 && r - l > 2) { L[y] = l; R[y] = r + 1; if (top < 0) top = y; bot = y; }
  }
  const band = [];                                           // the straight body: 45 … 85 % down
  for (let y = Math.round(top + 0.45 * (bot - top)); y <= top + 0.85 * (bot - top); y++) if (Number.isFinite(L[y])) band.push(y);
  const med = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const Wt = med(band.map((y) => R[y] - L[y]));
  // a robust line through the band's edges (pixels): fitted, then refitted on the rows within 2 % of it
  const fit = (E) => {
    const m0 = med(band.map((q) => E[q]));
    let rows = band.filter((y) => Math.abs(E[y] - m0) < 0.08 * Wt);
    let a = m0, b = 0;
    for (let it = 0; it < 2; it++) {
      const n = rows.length; if (n < 4) break;
      let sy = 0, se = 0, syy = 0, sye = 0; for (const y of rows) { sy += y; se += E[y]; syy += y * y; sye += y * E[y]; }
      const d = n * syy - sy * sy; b = d ? (n * sye - sy * se) / d : 0; a = (se - b * sy) / n;
      rows = rows.filter((y) => Math.abs(E[y] - (a + b * y)) < 0.02 * Wt);
    }
    return (y) => a + b * y;
  };
  const lineL = fit(L), lineR = fit(R);
  // the hem: the last row still at least half the torso's width (below: the hanger stand's legs)
  let hem = bot; while (hem > top && !(R[hem] - L[hem] >= 0.5 * Wt)) hem--;
  // the shoulder line: the first row from the top where the garment is as wide as its seams there
  let sh = top; while (sh < hem && !(R[sh] - L[sh] >= 0.98 * (lineR(sh) - lineL(sh)))) sh++;
  const torsoPx = (y) => {
    if (y < top || y > hem || !Number.isFinite(L[y])) return null;
    return [Math.max(L[y], lineL(y)), Math.min(R[y], lineR(y))];
  };
  const U = (v) => v / h;
  const torsoAt = (gy) => { const t = torsoPx(Math.round(gy * h)); return t ? [U(t[0]), U(t[1])] : null; };
  const sample = (gx, gy, out, o) => {                 // bilinear RGBA at garment units (garment pixels only)
    const x = gx * h - 0.5, y = gy * h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    for (let c = 0; c < 4; c++) out[o + c] = 0;
    if (y0 > hem) return;
    let wsum = 0;
    for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const X = x0 + dx, Y = y0 + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h || wt <= 0) continue;
      const i = (Y * w + X) * 4, a = px[i + 3] / 255;
      out[o] += px[i] * wt * a; out[o + 1] += px[i + 1] * wt * a; out[o + 2] += px[i + 2] * wt * a; out[o + 3] += px[i + 3] * wt;
      wsum += wt * a;
    }
    if (wsum > 0) for (let c = 0; c < 3; c++) out[o + c] /= wsum;
  };
  // the armpit: going up from the band, where the garment first gets clearly wider than its seams
  let pit = band[0] ?? Math.round(top + 0.4 * (bot - top));
  while (pit > sh && R[pit] - L[pit] <= (lineR(pit) - lineL(pit)) * 1.06 + 2) pit--;
  const P = { w, h, px, top: U(top), hem: U(hem), shoulderY: U(sh), torsoW: U(Wt), shoulderW: U(lineR(sh) - lineL(sh)), armpitY: U(pit), torsoAt, sample };
  // sleeves: the garment outside the seam lines (by ≥ 2 % of the torso's width)
  P.sleeves = {};
  for (const side of ['left', 'right']) {
    const isSleeve = (x, y) => A(x, y) > 127 && y <= hem && (side === 'left' ? x < lineL(y) - 0.02 * Wt : x > lineR(y) + 0.02 * Wt);
    let n = 0, mx = 0, my = 0;
    for (let y = top; y <= hem; y += 2) for (let x = 0; x < w; x += 2) if (isSleeve(x, y)) { n++; mx += x; my += y; }
    if (n * 4 < 0.01 * Wt * (hem - top)) continue;
    mx /= n; my /= n;
    const ry = (sh + pit) / 2, rx = side === 'left' ? lineL(ry) : lineR(ry);
    let dx = mx - rx, dy = my - ry; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    let nx = -dy, ny = dx; if (ny > 0) { nx = -nx; ny = -ny; }   // across: toward the sleeve's top edge
    let far = 0;
    for (let y = top; y <= hem; y += 2) for (let x = 0; x < w; x += 2) if (isSleeve(x, y)) far = Math.max(far, (x - rx) * dx + (y - ry) * dy);
    // along the axis: the sleeve's extent across it, slice by slice
    const K = 96, span = far * 1.04, ext = [];
    for (let k = 0; k < K; k++) {
      const a = (k / (K - 1)) * span, cx = rx + dx * a, cy = ry + dy * a;
      let lo = Infinity, hi = -Infinity;
      for (let p = -1.2 * Wt; p <= 1.2 * Wt; p += 1) if (isSleeve(Math.round(cx + nx * p), Math.round(cy + ny * p))) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
      ext.push(hi > lo ? [U(lo), U(hi)] : null);
    }
    // near the armhole the sleeve's own pixels are cut off by the seam line: the first full slice stands in
    const widest = Math.max(...ext.map((e) => (e ? e[1] - e[0] : 0)));
    const first = ext.findIndex((e) => e && e[1] - e[0] > 0.6 * widest);
    if (first < 0) continue;
    for (let k = 0; k < first; k++) ext[k] = ext[first];
    // (and its fabric: up there the slice crosses the shoulder's slope into the background — the sleeve's root is
    // sampled where it's whole, so the sleeve reaches the armhole all round)
    P.sleeves[side] = { rx: U(rx), ry: U(ry), dx, dy, nx, ny, span: U(span), K, ext, P, root: U((first / (K - 1)) * span) };
  }
  return P;
}

/* ------------------------------------------------------------------ the body side */

const REGION = (name) => {
  const m = name.match(/_(l|r)$/);
  if (m && /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/.test(name)) return 'arm_' + m[1];
  if (m && /^(thigh|calf|foot|ball)/.test(name)) return 'leg_' + m[1];
  if (/^head/.test(name)) return 'head';
  return 'torso';
};

/** the active body as it is now (rest pose, current shape): points, normals, regions, joints */
function bodyNow(human) {
  const B = human.active, mesh = B.mesh, g = mesh.geometry;
  mesh.userData.cpuMorphUpdate?.();
  const P = g.attributes.position.array, MP = g.attributes.morphPos?.array;
  const N = (g.attributes.suitNrm || g.attributes.normal).array, MN = g.attributes.morphNrm?.array;
  const n = P.length / 3, Q = new Float32Array(n * 3), NQ = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) { Q[i] = P[i] + (MP ? MP[i] : 0); NQ[i] = N[i] + (MN ? MN[i] : 0); }
  const names = B.bones.map((b) => b.name), regOfBone = names.map(REGION);
  const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, part = g.attributes._part.array;
  const region = new Array(n);
  for (let i = 0; i < n; i++) {
    const acc = {};
    for (let k = 0; k < 4; k++) { const r = regOfBone[si[i * 4 + k]]; acc[r] = (acc[r] || 0) + sw[i * 4 + k]; }
    let best = 'torso', bw = -1; for (const [r, w] of Object.entries(acc)) if (w > bw) { bw = w; best = r; }
    region[i] = best;
  }
  const joint = (name) => {
    const k = names.indexOf(name);
    return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[k]).invert());
  };
  const probes = B.probes;
  const ys = probes ? (Q[probes.l * 3 + 1] + Q[probes.r * 3 + 1]) / 2 : joint('neck_01').y - 0.05;
  const shoulderW = probes ? Math.abs(Q[probes.l * 3] - Q[probes.r * 3]) : 0.4;
  // the crotch: the lowest torso point near the middle
  let crotchY = Infinity;
  for (let i = 0; i < n; i++) if (part[i] < 0.5 && region[i] === 'torso' && Math.abs(Q[i * 3]) < 0.02) crotchY = Math.min(crotchY, Q[i * 3 + 1]);
  return { B, mesh, g, n, Q, NQ, region, part, joint, ys, shoulderW, crotchY };
}

/**
 * Around the torso at every height: centre and the arc length of the body's surface by angle (front half and back
 * half, each 0 … 1 from side to side) — the texture goes around the body as a tape measure would
 */
function torsoRings(body, inTorso) {
  const { Q, n } = body;
  const BIN = 0.01, A = 72;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) if (inTorso(i)) { y0 = Math.min(y0, Q[i * 3 + 1]); y1 = Math.max(y1, Q[i * 3 + 1]); }
  const nb = Math.max(1, Math.ceil((y1 - y0) / BIN) + 1);
  const cx = new Float64Array(nb), cz = new Float64Array(nb), cn = new Float64Array(nb);
  for (let i = 0; i < n; i++) if (inTorso(i)) { const b = Math.min(nb - 1, Math.floor((Q[i * 3 + 1] - y0) / BIN)); cx[b] += Q[i * 3]; cz[b] += Q[i * 3 + 2]; cn[b]++; }
  for (let b = 0; b < nb; b++) if (cn[b]) { cx[b] /= cn[b]; cz[b] /= cn[b]; }
  // fill + smooth the centres (over ±3 bins)
  const fill = (arr) => { let last = null; for (let b = 0; b < nb; b++) if (cn[b]) last = arr[b]; else if (last != null) arr[b] = last; for (let b = nb - 1; b >= 0; b--) if (cn[b]) last = arr[b]; else if (!cn[b] && arr[b] === 0) arr[b] = last ?? 0; };
  fill(cx); fill(cz);
  const sm = (arr) => Float64Array.from(arr, (_, b) => { let s = 0, k = 0; for (let d = -3; d <= 3; d++) if (b + d >= 0 && b + d < nb) { s += arr[b + d]; k++; } return s / k; });
  const CX = sm(cx), CZ = sm(cz);
  // radius by angle per bin
  const R = new Float64Array(nb * A), RN = new Float64Array(nb * A);
  const ang = (x, z, b) => Math.atan2(x - CX[b], z - CZ[b]);           // 0 = front centre, +π/2 = the body's left (+x)
  for (let i = 0; i < n; i++) if (inTorso(i)) {
    const b = Math.min(nb - 1, Math.floor((Q[i * 3 + 1] - y0) / BIN));
    const a = ang(Q[i * 3], Q[i * 3 + 2], b), k = Math.min(A - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * A));
    R[b * A + k] += Math.hypot(Q[i * 3] - CX[b], Q[i * 3 + 2] - CZ[b]); RN[b * A + k]++;
  }
  for (let b = 0; b < nb; b++) {
    for (let k = 0; k < A; k++) if (RN[b * A + k]) R[b * A + k] /= RN[b * A + k];
    // empty angle bins: from the nearest filled ones around the ring
    for (let k = 0; k < A; k++) if (!RN[b * A + k]) {
      let l = 1; while (l < A && !RN[b * A + ((k - l + A) % A)] && !RN[b * A + ((k + l) % A)]) l++;
      const a1 = RN[b * A + ((k - l + A) % A)] ? R[b * A + ((k - l + A) % A)] : 0, a2 = RN[b * A + ((k + l) % A)] ? R[b * A + ((k + l) % A)] : 0;
      R[b * A + k] = a1 && a2 ? (a1 + a2) / 2 : a1 || a2 || 0.1;
    }
  }
  // smoothed over heights (±2 bins), then cumulative arc length per half
  const Rs = new Float64Array(nb * A);
  for (let b = 0; b < nb; b++) for (let k = 0; k < A; k++) { let s = 0, c = 0; for (let d = -2; d <= 2; d++) if (b + d >= 0 && b + d < nb) { s += R[(b + d) * A + k]; c++; } Rs[b * A + k] = s / c; }
  const cum = new Float64Array(nb * (A + 1));
  for (let b = 0; b < nb; b++) {
    let acc = 0;
    for (let k = 0; k <= A; k++) {
      const kk = k % A, km = (k - 1 + A) % A;
      if (k) {
        const a0 = -Math.PI + ((km + 0.5) / A) * 2 * Math.PI, a1 = a0 + (2 * Math.PI) / A;
        acc += Math.hypot(Rs[b * A + kk] * Math.sin(a1) - Rs[b * A + km] * Math.sin(a0), Rs[b * A + kk] * Math.cos(a1) - Rs[b * A + km] * Math.cos(a0));
      }
      cum[b * (A + 1) + k] = acc;
    }
  }
  // arc length at an angle (from angle −π + ½ bin), interpolated
  const arcAt = (b, a) => {
    let f = ((a + Math.PI) / (2 * Math.PI)) * A - 0.5;
    if (f < 0) f += A;
    const k = Math.floor(f), t = f - k;
    return cum[b * (A + 1) + k] + (cum[b * (A + 1) + k + 1] - cum[b * (A + 1) + k]) * t;
  };
  /** a point → [side 'front' | 'back', fraction 0 … 1 across that half (front: from the body's right to its left;
   *  back: from its left round to its right — as each photo shows it from image-left to image-right)] */
  return (x, y, z) => {
    const b = Math.max(0, Math.min(nb - 1, Math.floor((y - y0) / BIN)));
    const a = ang(x, z, b);
    const R0 = arcAt(b, -Math.PI / 2), R1 = arcAt(b, Math.PI / 2), L = cum[b * (A + 1) + A];
    let s = arcAt(b, a);
    if (a >= -Math.PI / 2 && a <= Math.PI / 2) return ['front', (s - R0) / ((R1 - R0) || 1)];
    // the back half runs from +π/2 through ±π to −π/2 (wrapping the table's start)
    if (s < R0) s += L;
    return ['back', (s - R1) / ((R0 + L - R1) || 1)];
  };
}

/** along / around an arm (rest pose): shoulder joint → elbow → wrist */
function armFrame(body, side) {
  const S = body.joint(`upperarm_${side}`), E = body.joint(`lowerarm_${side}`), W = body.joint(`hand_${side}`);
  const seg = (A, Bp) => {
    const len = A.distanceTo(Bp), a = Bp.clone().sub(A).normalize();
    const f = new THREE.Vector3(0, 0, 1).addScaledVector(a, -a.z).normalize();          // front, across the arm
    const up = new THREE.Vector3().crossVectors(f, a).normalize();
    if (up.y < 0) up.negate();                                                          // the top of the arm
    return { A, len, a, f, up };
  };
  const s1 = seg(S, E), s2 = seg(E, W);
  const v = new THREE.Vector3(), r = new THREE.Vector3();
  /** → [along (m from the shoulder joint), around 0 … 1 (0 top → front → 0.5 underarm → back → 1 top)] */
  return (x, y, z) => {
    v.set(x, y, z);
    let t = v.clone().sub(S).dot(s1.a), sg = s1, along = t;
    if (t > s1.len) { sg = s2; t = v.clone().sub(E).dot(s2.a); along = s1.len + t; }
    r.copy(v).sub(sg.A).addScaledVector(sg.a, -t);
    const rl = r.length() || 1;
    const c = Math.max(-1, Math.min(1, r.dot(sg.up) / rl)), th = Math.acos(c) / Math.PI;     // 0 top … 1 underarm
    return [along, r.dot(sg.f) >= 0 ? th * 0.5 : 1 - th * 0.5];
  };
}

/* ------------------------------------------------------------------ the charts' textures */

function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** the torso chart: around (front half | back half) × down from the shoulder line */
function torsoTexture(front, back) {
  const { W, H, top, bottom } = TORSO, c = canvasOf(W, H), x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
  for (let j = 0; j < H; j++) {
    const h = top + ((j + 0.5) / H) * (bottom - top);
    if (h < -COLLAR) continue;
    for (const [ph, i0, i1] of [[front, 0, W / 2], [back, W / 2, W]]) {
      const P = ph.P, gy = P.shoulderY + h / ph.s, t = P.torsoAt(gy);
      if (!t) continue;
      for (let i = i0; i < i1; i++) {
        let f = (i + 0.5 - i0) / (i1 - i0);
        if (ph.mirror) f = 1 - f;
        P.sample(t[0] + f * (t[1] - t[0]), gy, d, (j * W + i) * 4);
      }
    }
  }
  // the front photo shows the inside of the back collar across its open neck: that's the back's (and the back photo
  // has it) — above the shoulder line, within the neck opening's span just below it, the front is cleared
  {
    const j0 = Math.round(((0.03 - top) / (bottom - top)) * H);
    let a = W / 4, b = W / 4;
    if (d[(j0 * W + W / 4) * 4 + 3] < 128) {
      while (a > 0 && d[(j0 * W + a - 1) * 4 + 3] < 128) a--;
      while (b < W / 2 - 1 && d[(j0 * W + b + 1) * 4 + 3] < 128) b++;
      const j1 = Math.round(((0 - top) / (bottom - top)) * H);
      for (let j = 0; j < j1; j++) for (let i = a; i <= b; i++) d[(j * W + i) * 4 + 3] = 0;
    }
  }
  smoothTopEdge(d, W, H);
  x.putImageData(img, 0, 0);
  return { canvas: c, data: d, W, H };
}

/** the garment's top edge (a collar's, a neckline's), smoothed column by column: small spikes (a hanger's leftovers
 *  along the collar) cut, small notches filled with the fabric just under them — a real shape (a V opening, a
 *  lapel) is far bigger than the limit and stays */
function smoothTopEdge(d, W, H) {
  const lim = Math.round(H * 0.012), R = 12, top = new Int32Array(W).fill(-1);
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) if (d[(j * W + i) * 4 + 3] > 127) { top[i] = j; break; }
  for (let i = 0; i < W; i++) {
    if (top[i] < 0) continue;
    const near = []; for (let q = -R; q <= R; q++) { const t = top[(i + q + W) % W]; if (t >= 0) near.push(t); }
    near.sort((a, b) => a - b);
    const m = near[near.length >> 1];
    if (Math.abs(m - top[i]) > lim) continue;
    if (m > top[i]) for (let j = top[i]; j < m; j++) d[(j * W + i) * 4 + 3] = 0;                     // a spike
    else for (let j = m; j < top[i]; j++) { const o = (j * W + i) * 4, f = (top[i] * W + i) * 4; for (let c = 0; c < 4; c++) d[o + c] = d[f + c]; }   // a notch
  }
}

/** a sleeve chart: around (front half | back half) × along the arm from the shoulder joint */
function sleeveTexture(front, back) {
  const { W, L, len } = SLEEVE, c = canvasOf(W, L), x = c.getContext('2d'), img = x.createImageData(W, L), d = img.data;
  for (let j = 0; j < L; j++) {
    const m = ((j + 0.5) / L) * len;
    for (const [sl, i0, i1, s] of [[front.sl, 0, W / 2, front.s], [back.sl, W / 2, W, back.s]]) {
      if (!sl) continue;
      const a = m / s;
      if (a > sl.span) continue;
      const k = Math.min(sl.K - 1, Math.round((a / sl.span) * (sl.K - 1))), e = sl.ext[k];
      if (!e) continue;
      const P = sl.P, as = Math.max(a, sl.root || 0);
      for (let i = i0; i < i1; i++) {
        // 0 … 1 across this half: front from the top edge down to the underarm, back from the underarm back up
        let f = (i + 0.5 - i0) / (i1 - i0);
        if (i0) f = 1 - f;
        const p = e[1] - f * (e[1] - e[0]);
        P.sample(sl.rx + sl.dx * as + sl.nx * p, sl.ry + sl.dy * as + sl.ny * p, d, (j * W + i) * 4);
      }
    }
  }
  x.putImageData(img, 0, 0);
  return { canvas: c, data: d, W, H: L };
}

const alphaAt = (T, u, v) => {
  const i = ((Math.floor(u * T.W) % T.W) + T.W) % T.W, j = Math.max(0, Math.min(T.H - 1, Math.floor(v * T.H)));
  return T.data[(j * T.W + i) * 4 + 3] / 255;
};

/** the chart's photo de-lit (the studio's light gradient out, the design kept), its colours bled past its edges (the
 *  rim and the cut edge sample there) and a relief normal map from its fine shading (fabric.js) */
function finishTexture(T) {
  T.normal = prepareFabric(T.canvas, [{ x: 0, w: T.W, h: T.H }], { delight: 0.35, bleed: 16 });
  return T;
}

/**
 * How a garment's edges are finished (from its detail sheet): along every edge a band of doubled fabric stands out a
 * little — a collar along the neckline and lapels, the placket along a buttoned front, a folded hem, a rolled or
 * hemmed cuff. A distance-to-the-edge field on the chart (chamfer, millimetres) → raise(u, v) in metres.
 */
function edgeBands(T, kind, det) {
  const { W, H, data } = T, D = new Float32Array(W * H);
  // millimetres per texel across / down the chart (around: ~ a chest's or an arm's girth over its width)
  const du = kind === 'torso' ? 1.0 : 0.65, dv = kind === 'torso' ? ((TORSO.bottom - TORSO.top) * 1000) / H : (SLEEVE.len * 1000) / H, dd = Math.hypot(du, dv);
  for (let i = 0; i < W * H; i++) D[i] = data[i * 4 + 3] > 127 ? 1e9 : 0;
  const relax = (i, j, c) => { if (D[j] + c < D[i]) D[i] = D[j] + c; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = y * W + ((x - 1 + W) % W);
    relax(i, l, du);
    if (y) { relax(i, i - W, dv); relax(i, (y - 1) * W + ((x - 1 + W) % W), dd); relax(i, (y - 1) * W + ((x + 1) % W), dd); }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x, r = y * W + ((x + 1) % W);
    relax(i, r, du);
    if (y < H - 1) { relax(i, i + W, dv); relax(i, (y + 1) * W + ((x + 1) % W), dd); relax(i, (y + 1) * W + ((x - 1 + W) % W), dd); }
  }
  const at = (u, v) => {
    const x = ((Math.floor(u * W) % W) + W) % W, y = Math.max(0, Math.min(H - 1, Math.floor(v * H)));
    return D[y * W + x];
  };
  // a band: full height up to its width, easing off over its last quarter
  // a band: full height up to its width, then a short step down (a folded edge, not a slope)
  const band = (d, width, height, ease = 8) => (d >= width ? 0 : d <= width - ease ? height : height * (width - d) / ease);
  const collar = det?.collar?.style && det.collar.style !== 'none';
  const buttoned = det?.closure && det.closure.type !== 'none' && det.closure.type !== 'pullover';
  const cuff = det?.sleeves?.cuff || 'hemmed';
  if (kind === 'sleeve') {
    const [w, h] = cuff === 'rolled' ? [35, 0.0032] : cuff === 'buttoned' ? [45, 0.0014] : cuff === 'ribbed' ? [40, 0.001] : cuff === 'none' ? [0, 0] : [14, 0.0009];
    return (u, v) => band(at(u, v), w, h);
  }
  return (u, v) => {
    const d = at(u, v), h = TORSO.top + v * (TORSO.bottom - TORSO.top), frontC = u > 0.17 && u < 0.33;
    let r = 0;
    // the collar (and its lapels — wider toward its points, at the front)
    if (collar && h < 0.14) r = Math.max(r, band(d, u < 0.5 ? 58 : 45, 0.0024, 3));
    if (buttoned && frontC && h >= 0.1) r = Math.max(r, band(d, 24, 0.0012));                  // the placket
    if (h > 0.3 && !frontC) r = Math.max(r, band(d, 16, 0.0009));                              // the hem's fold
    if (h > 0.3 && frontC) r = Math.max(r, band(d, 16, 0.0009));
    return r;
  };
}

const alphaBilinear = (T, u, v) => {
  const x = (((u % 1) + 1) % 1) * T.W - 0.5, y = Math.max(0, Math.min(T.H - 1.001, v * T.H - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const at = (X, Y) => T.data[(Math.max(0, Math.min(T.H - 1, Y)) * T.W + ((X % T.W) + T.W) % T.W) * 4 + 3] / 255;
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
};

function textureOf(T, color = true) {
  const t = new THREE.CanvasTexture(T.canvas);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ the garment */

/**
 * @param human   the Human (its active body is dressed)
 * @param photos  { front: { cut, geometry }, back?: { cut, geometry } } — cleaned cut-outs of the garment on its
 *                hanger (no back photo: the front, mirrored, stands in for it)
 */
export function layerGarment(human, photos, opts = {}) {
  const body = bodyNow(human);
  const { B, mesh, g, n, Q, region, part } = body;
  const F = photoOf(photos.front), Bk = photos.back ? photoOf(photos.back) : F;
  // garment units → metres: a garment's shoulder seams sit on the shoulder points — on the hanger they're the top
  // corners of its torso (lengths then keep the garment's own proportions; the torso is wrapped by arc length)
  const scale = (P) => body.shoulderW / (P.shoulderW || P.torsoW || 0.3);
  const front = { P: F, s: scale(F), mirror: false }, back = { P: Bk, s: scale(Bk), mirror: !photos.back };

  const inTorso = (i) => part[i] < 0.5 && (region[i] === 'torso' || (region[i].startsWith('leg') && Q[i * 3 + 1] > body.crotchY));
  const ring = torsoRings(body, inTorso);
  const torsoT = finishTexture(torsoTexture(front, back));
  const torsoUV = (i) => {
    const [half, f] = ring(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]);
    const h = body.ys - Q[i * 3 + 1];
    return [half === 'front' ? f * 0.5 : 0.5 + f * 0.5, (h - TORSO.top) / (TORSO.bottom - TORSO.top)];
  };
  // sleeves: the body's right arm is the front photo's image-left sleeve and the back photo's image-right one
  const arms = {};
  for (const [side, fs, bs] of [['r', 'left', 'right'], ['l', 'right', 'left']]) {
    const fsl = F.sleeves[fs], bsl = photos.back ? Bk.sleeves[bs] : F.sleeves[fs === 'left' ? 'right' : 'left'];
    if (!fsl && !bsl) continue;
    const T = finishTexture(sleeveTexture({ sl: fsl, s: front.s }, { sl: bsl, s: back.s }));
    const frame = armFrame(body, side);
    arms['arm_' + side] = { T, uv: (i) => { const [al, ar] = frame(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]); return [ar, Math.max(0, al) / SLEEVE.len]; } };
  }

  /* ---- the garment's triangles: each skin triangle on its chart (by the regions of its corners) ---- */
  const charts = [{ key: 'torso', T: torsoT, uv: torsoUV }, ...Object.entries(arms).map(([key, a]) => ({ key, ...a }))];
  // (the neck's top is weighted to the head: it's on the torso chart too — the photo's outline decides what's covered)
  const chartOf = (r) => (arms[r] ? charts.findIndex((c) => c.key === r) : r === 'torso' || r === 'head' || r.startsWith('leg') ? 0 : -1);
  const skinEnd = g.groups[0] ? g.groups[0].start + g.groups[0].count : g.index.count;
  const idx = g.index.array;
  const per = charts.map(() => ({ tris: [], uvs: [] }));
  const armSide = B.bones.map((b) => { const r = REGION(b.name); return r.startsWith('arm') ? r.slice(4) : null; });
  const armBone = armSide.map(Boolean), SKI = g.attributes.skinIndex.array, SKW = g.attributes.skinWeight.array;
  const torsoShare = (i) => { let w = 0; for (let k = 0; k < 4; k++) if (!armBone[SKI[i * 4 + k]]) w += SKW[i * 4 + k]; return w; };
  const vAlpha = new Float32Array(n);                       // each body vertex: how covered it is on its own chart
  // the armholes: where a sleeve meets the torso is a smooth line round the arm's root — the 50 % level of each arm's
  // skin weight, smoothed over the surface (the bones' own boundary zigzags along the triangles' edges); triangles
  // near it go on both charts, each cut on its own side (shell.js `seam`)
  const sideOf = { arm_l: 'l', arm_r: 'r' }, seam = {};
  {
    const nbr = Array.from({ length: n }, () => []);
    for (let t = 0; t < skinEnd; t += 3) for (let e = 0; e < 3; e++) { const p = idx[t + e], q = idx[t + (e + 1) % 3]; nbr[p].push(q); nbr[q].push(p); }
    for (const side of ['l', 'r']) {
      if (!arms['arm_' + side]) continue;
      let f = new Float32Array(n);
      for (let i = 0; i < n; i++) { let w = 0; for (let k = 0; k < 4; k++) if (armSide[SKI[i * 4 + k]] === side) w += SKW[i * 4 + k]; f[i] = w; }
      for (let it = 0; it < 40; it++) {
        const o = new Float32Array(n);
        for (let i = 0; i < n; i++) { const N = nbr[i]; if (!N.length) { o[i] = f[i]; continue; } let m = 0; for (const j of N) m += f[j]; o[i] = 0.5 * f[i] + 0.5 * m / N.length; }
        f = o;
      }
      for (let i = 0; i < n; i++) f[i] -= 0.5;
      seam[side] = f;
    }
  }
  const NEAR = 0.2, ci = { l: charts.findIndex((c) => c.key === 'arm_l'), r: charts.findIndex((c) => c.key === 'arm_r') };
  const look = (c, v) => {
    const ch = charts[c], uvs = v.map((i) => ch.uv(i));
    // around the body / the arm the texture wraps: a triangle across the wrap is drawn on one side of it
    const us = uvs.map((q) => q[0]);
    if (Math.max(...us) - Math.min(...us) > 0.5) for (const q of uvs) if (q[0] < 0.5) q[0] += 1;
    return { uvs, al: uvs.map((q) => alphaAt(ch.T, q[0], q[1])) };
  };
  // each body vertex: which chart it's on (its side of an armhole, else its region)
  const ownerOf = (i) => {
    for (const side of ['l', 'r']) {
      if (!seam[side] || ci[side] <= 0 || !(region[i] === 'arm_' + side || region[i] === 'torso') || seam[side][i] < -0.45) continue;
      return seam[side][i] > 0 ? ci[side] : 0;
    }
    return chartOf(region[i]);
  };
  for (let t = 0; t < skinEnd; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (v.some((i) => part[i] > 0.5)) continue;
    const cs = v.map(ownerOf);
    // the triangle's chart: the one most of its corners are on (a torso / sleeve boundary goes to the sleeve)
    let c = cs[0] === cs[1] || cs[0] === cs[2] ? cs[0] : cs[1] === cs[2] ? cs[1] : Math.max(...cs);
    if (c < 0) continue;
    if (c > 0 && cs.every((x) => x !== c)) continue;
    const cands = new Set([c]);
    for (const side of ['l', 'r']) if (seam[side] && ci[side] > 0 && v.some((i) => Math.abs(seam[side][i]) < NEAR)) { cands.add(0); cands.add(ci[side]); }
    for (let cc of cands) {
      let { uvs, al } = look(cc, v), fell = false;
      // the armpit's skin is weighted to the arm but lies on the torso's side, past a short sleeve's hem along the
      // arm: the sleeve doesn't cover it — the torso's side panel does (in a pose with the arm out it shows)
      if (cc > 0 && Math.max(...al) < 0.02 && !cands.has(0) && v.some((i) => torsoShare(i) > 0.08)) {
        const o = look(0, v);
        if (Math.max(...o.al) >= 0.02) { cc = 0; fell = true; ({ uvs, al } = o); }
      }
      for (let k = 0; k < 3; k++) if (fell || ownerOf(v[k]) === cc) vAlpha[v[k]] = Math.max(vAlpha[v[k]], al[k]);
      if (Math.max(...al) < 0.02) continue;
      per[cc].tris.push(v); per[cc].uvs.push(uvs);
    }
  }
  // the pieces' seams: a sleeve on its side of its armhole; the torso on its side of every armhole — and past the
  // sleeve's own edge (its hem, along the arm: the armpit below a short sleeve) on both sides: the torso's line is
  // max(its side of the seam, how far out of the sleeve's cut-out), so the two pieces' cuts meet edge to edge
  const seamFor = (c) => {
    if (c > 0) return seam[sideOf[charts[c].key]] || null;
    if (!seam.l && !seam.r) return null;
    const f = new Float32Array(n).fill(0.5);
    for (const side of ['l', 'r']) {
      if (!seam[side] || ci[side] <= 0) continue;
      const ch = charts[ci[side]], S = seam[side];
      for (let i = 0; i < n; i++) {
        if (S[i] < -0.45) continue;
        const [u, v] = ch.uv(i), out = 0.5 - alphaBilinear(ch.T, u, v);
        f[i] = Math.min(f[i], Math.max(-S[i], out * 0.25));
      }
    }
    return f;
  };

  /* ---- one skinned mesh: the fabric as a real 3D piece (shell.js: cut on the photo's outline, with thickness) —
     every chart its own texture, on the body's bones and morphs ---- */
  const thick = opts.thick ?? 0.0012;
  const det = opts.details || null;
  const pieces = per.map((P, c) => ({ tris: P.tris, uvs: P.uvs, group: c, alpha: (u, v) => alphaBilinear(charts[c].T, u, v), seam: seamFor(c),
    raise: edgeBands(charts[c].T, c === 0 ? 'torso' : 'sleeve', det) })).filter((p) => p.tris.length);
  if (!pieces.length) return null;
  // how it hangs (drape.js): the garment's own girths off the photos — its torso (front + back flat widths) and
  // each sleeve (front + back sleeve widths) — around the body's
  const used = new Set(); for (const P of per) for (const t of P.tris) for (const i of t) used.add(i);
  const flat = (ph, h) => { const t = ph.P.torsoAt(ph.P.shoulderY + h / ph.s); return t ? (t[1] - t[0]) * ph.s : 0; };
  const girth = (h) => { const a = flat(front, h), b = photos.back ? flat(back, h) : a; return a && b ? a + b : 0; };
  const sleeveFlat = (sl, s, m) => {
    if (!sl) return 0;
    const a = m / s, k = Math.round((a / sl.span) * (sl.K - 1));
    const e = sl.ext[Math.max(0, Math.min(sl.K - 1, k))];
    return k < sl.K && a <= sl.span && e ? (e[1] - e[0]) * s : 0;
  };
  const sleeveG = {};
  for (const [side, fs, bs] of [['r', 'left', 'right'], ['l', 'right', 'left']]) {
    const fsl = F.sleeves[fs], bsl = photos.back ? Bk.sleeves[bs] : F.sleeves[fs === 'left' ? 'right' : 'left'];
    if (fsl || bsl) sleeveG[side] = (m) => { const a = sleeveFlat(fsl, front.s, m), b = sleeveFlat(bsl, back.s, m); return a && b ? a + b : 2 * (a || b); };
  }
  const drape = opts.hug ? null : drapeField(body, { inTorso, girth, sleeves: sleeveG, used });
  const geo = buildShell(g, pieces, { thick, drape });
  if (!geo.index.count) return null;
  const mats = [];
  charts.forEach((ch) => {
    const map = textureOf(ch.T), normalMap = ch.T.normal ? textureOf({ canvas: ch.T.normal }, false) : null;
    mats.push(materialFor(map, normalMap, opts.finish, 0.15, det?.colors?.main), materialFor(map, normalMap, opts.finish, 0, det?.colors?.main));
  });
  const garment = new THREE.SkinnedMesh(geo, mats);
  garment.name = 'layered-garment';
  garment.frustumCulled = false;
  garment.castShadow = garment.receiveShadow = true;
  garment.morphTargetInfluences = mesh.morphTargetInfluences;
  garment.bind(mesh.skeleton, mesh.bindMatrix);
  useCpuMorphs(garment);
  garment.customDepthMaterial = depthFor(mats[0].map);
  const blend = garment.onBeforeRender;
  garment.onBeforeRender = function (...a) { garment.morphTargetInfluences = mesh.morphTargetInfluences; return blend.apply(this, a); };
  mesh.parent.add(garment);
  B.layers.add(garment);

  /* ---- buttons (detail sheet + photo: details.js): each where it is on the front photo, riding on the garment ---- */
  let buttons = null;
  if (opts.buttons?.length) {
    const items = [];
    for (const b of opts.buttons) {
      const t = F.torsoAt(b.y);
      if (!t) continue;
      const u = ((b.x - t[0]) / ((t[1] - t[0]) || 1)) * 0.5, h = (b.y - F.shoulderY) * front.s, v = (h - TORSO.top) / (TORSO.bottom - TORSO.top);
      const at = anchorOn(per[0], u, v);
      if (!at) continue;
      const lift = thick + (pieces[0]?.raise?.(u, v) || 0) + 0.0002;
      items.push(buttonItem(body, at, Math.max(0.004, Math.min(0.01, b.r * front.s)), lift));
    }
    if (items.length) {
      const bg = buildAnchored(g, items, drape);
      const bm = buttonMaterial(opts.buttons[0].color);
      buttons = new THREE.SkinnedMesh(bg, bm);
      buttons.name = 'garment-buttons';
      buttons.frustumCulled = false;
      buttons.castShadow = true;
      buttons.morphTargetInfluences = mesh.morphTargetInfluences;
      buttons.bind(mesh.skeleton, mesh.bindMatrix);
      useCpuMorphs(buttons);
      const bBlend = buttons.onBeforeRender;
      buttons.onBeforeRender = function (...a) { buttons.morphTargetInfluences = mesh.morphTargetInfluences; return bBlend.apply(this, a); };
      mesh.parent.add(buttons);
      B.layers.add(buttons);
    }
  }

  /* ---- the body under it: skin fully inside the garment (and the underwear under that skin) sinks out of sight ---- */
  const hide = new Set();
  // (the skin under the fabric, all but its last triangle at an open edge — there the skin seen past the edge would
  // meet skin drawn deeper (materials.js) and the ambient occlusion would read the step as a crease)
  const nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < skinEnd; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; nb[a].push(b); nb[b].push(a); }
  for (let i = 0; i < n; i++) if (part[i] < 0.5 && vAlpha[i] > 0.9 && nb[i].every((j) => vAlpha[j] > 0.6)) hide.add(i);
  // the underwear under it: drawn deeper too (whole — a bra seen in an open front is a bra, not a cut-off piece of one)
  for (let i = 0; i < n; i++) {
    if (part[i] < 3.5 || part[i] > 4.5) continue;
    const c = ownerOf(i);
    if (c < 0 || !charts[c]) continue;
    const [u, v] = charts[c].uv(i);
    if (alphaAt(charts[c].T, u, v) > 0.5) hide.add(i);
  }

  // the body re-weights its armpits as the arms move: the garment (and its buttons) with it
  const onWeights = () => { reskin(geo, g); if (buttons) reskin(buttons.geometry, g); };
  B.weightListeners?.add(onWeights);
  onWeights();
  // in a pose the arms and hands push the loose fabric in (collide.js): the skin of the arms that the torso's hang
  // could reach, padded by a sleeve's own hang where one is over it
  let collide = null;
  if (drape) {
    const limbs = [], pad = {};
    for (let i = 0; i < n; i++) {
      if (part[i] > 0.5 || !region[i].startsWith('arm')) continue;
      limbs.push(i);
      if (vAlpha[i] > 0.5) pad[i] = 0.006 + Math.hypot(drape.all[i * 3] - drape.torso[i * 3], drape.all[i * 3 + 1] - drape.torso[i * 3 + 1], drape.all[i * 3 + 2] - drape.torso[i * 3 + 2]) + thick;
    }
    const cg = limbCollider(garment, mesh, limbs, pad), cb = buttons ? limbCollider(buttons, mesh, limbs, pad) : null;
    collide = () => { cg.update(); cb?.update(); };
    human.listeners?.add(collide);
    collide();
  }

  return {
    mesh: garment, hide, deep: null,
    posed: { pts: new Float32Array(0) },
    follow() { /* the morphs are the body's own (onBeforeRender) */ },
    dispose() {
      if (buttons) { B.layers.delete(buttons); buttons.removeFromParent(); buttons.geometry.dispose(); buttons.material.map?.dispose(); buttons.material.dispose(); }
      B.layers.delete(garment);
      B.weightListeners?.delete(onWeights);
      if (collide) human.listeners?.delete(collide);
      garment.removeFromParent();
      geo.dispose();
      for (const m of mats) { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); }
      garment.customDepthMaterial?.dispose();
    },
  };
}

/* ------------------------------------------------------------------ materials: on the bodysuit's surface */

const offset = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float suitGap;\nattribute vec3 suitNrm;\nattribute float shellOff;\nattribute vec3 shellN;\nattribute vec3 drape;\nattribute vec3 drapeT;\nattribute vec4 drapeW;\nattribute float drapeK;`)
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = shellN;')
    .replace('#include <skinning_vertex>', `transformed += drape * drapeK + normalize(suitNrm + morphNrm) * (suitGap + ${LIFT.toFixed(5)} + shellOff);
#include <skinning_vertex>
#ifdef USE_SKINNING
mat4 dM = drapeW.x * getBoneMatrix(skinIndex.x) + drapeW.y * getBoneMatrix(skinIndex.y) + drapeW.z * getBoneMatrix(skinIndex.z) + drapeW.w * getBoneMatrix(skinIndex.w);
transformed += (bindMatrixInverse * dM * bindMatrix * vec4(drapeT * drapeK, 0.0)).xyz;
#else
transformed += drapeT * drapeK;
#endif`);
};

/** the fabric's finish (the detail sheet's word) → how it takes the light */
const FINISH = {
  matte: { roughness: 0.92, sheen: 0.12 }, soft_sheen: { roughness: 0.78, sheen: 0.25 }, glossy: { roughness: 0.4, sheen: 0.2 },
  metallic: { roughness: 0.35, metalness: 0.6 }, fuzzy: { roughness: 1, sheen: 0.9 },
};

function materialFor(map, normalMap, finish = 'matte', alphaTest = 0.15, tint = null) {
  const f = FINISH[finish] || FINISH.matte;
  // the sheen in the fabric's own colour (a black satin glints dark grey, not white)
  const sc = tint ? new THREE.Color(tint).multiplyScalar(0.8).addScalar(0.12) : new THREE.Color(0.3, 0.3, 0.3);
  const m = new THREE.MeshPhysicalMaterial({
    map, normalMap, normalScale: new THREE.Vector2(0.14, 0.14), alphaTest, roughness: f.roughness, metalness: f.metalness || 0,
    // the photo already carries the light the garment was shot in: a little of it as its own glow keeps a dark
    // fabric's print as readable as in the photo (as fabric.js does for sewn garments)
    emissiveMap: map, emissive: new THREE.Color(0.55, 0.55, 0.55),
    // (both sides: where a pose crumples the fabric — the shoulder under a lowered arm — a fold turns triangles over)
    sheen: f.sheen || 0, sheenRoughness: 0.55, sheenColor: sc, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = offset;
  m.customProgramCacheKey = () => 'layered-garment';
  return m;
}

function depthFor(map) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.15 });
  d.onBeforeCompile = offset;
  d.customProgramCacheKey = () => 'layered-garment-depth';
  patchMaterial(d);
  return d;
}

/* ------------------------------------------------------------------ buttons */

/** the body-surface point under a chart position: the triangle holding it, its corners' weights */
function anchorOn(P, u, v) {
  for (let k = 0; k < P.tris.length; k++) {
    const [a, b, c] = P.uvs[k];
    for (const du of [0, 1, -1]) {
      const x = u + du, y = v;
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-4 && l2 >= -1e-4 && l3 >= -1e-4) { const t = P.tris[k]; return { src: [[t[0], l1], [t[1], l2], [t[2], l3]], uv: [u, v] }; }
    }
  }
  return null;
}

/** a sewn button: a slightly domed disc in the anchor's tangent plane (its face from buttonMaterial's texture) */
function buttonItem(body, at, r, lift) {
  const { Q, NQ } = body;
  let nx = 0, ny = 0, nz = 0;
  for (const [i, w] of at.src) { nx += NQ[i * 3] * w; ny += NQ[i * 3 + 1] * w; nz += NQ[i * 3 + 2] * w; }
  const n = new THREE.Vector3(nx, ny, nz).normalize();
  const t1 = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const S = 28, hb = 0.0016, verts = [], tris = [];
  const ring = (rad, off, nrm, uvk) => {
    const base = verts.length;
    for (let k = 0; k < S; k++) {
      const a = (k / S) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const d = [t1.x * c * rad + t2.x * s * rad, t1.y * c * rad + t2.y * s * rad, t1.z * c * rad + t2.z * s * rad];
      const nn = nrm === 'side' ? [t1.x * c + t2.x * s, t1.y * c + t2.y * s, t1.z * c + t2.z * s] : [n.x, n.y, n.z];
      verts.push({ d, off, n: nn, uv: [0.5 + 0.5 * c * uvk, 0.5 + 0.5 * s * uvk] });
    }
    return base;
  };
  const center = verts.length; verts.push({ d: [0, 0, 0], off: lift + hb + 0.0003, n: [n.x, n.y, n.z], uv: [0.5, 0.5] });
  const top = ring(r * 0.94, lift + hb, 'top', 0.94), edgeTop = ring(r, lift + hb * 0.8, 'side', 1), edgeBot = ring(r, lift, 'side', 1);
  for (let k = 0; k < S; k++) {
    const k1 = (k + 1) % S;
    tris.push([center, top + k, top + k1]);
    tris.push([top + k, edgeTop + k, edgeTop + k1], [top + k, edgeTop + k1, top + k1]);
    tris.push([edgeTop + k, edgeBot + k, edgeBot + k1], [edgeTop + k, edgeBot + k1, edgeTop + k1]);
  }
  return { src: at.src, verts, tris };
}

/** a button's face: its colour from the photo, a raised rim, four holes and the thread through them */
function buttonMaterial(color = [235, 235, 235]) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), [r, g, b] = color.map((v) => Math.round(v));
  const col = (k) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  x.fillStyle = col(1); x.fillRect(0, 0, 128, 128);
  const grd = x.createRadialGradient(64, 64, 10, 64, 64, 64); grd.addColorStop(0, col(0.92)); grd.addColorStop(0.72, col(0.88)); grd.addColorStop(0.86, col(1.06)); grd.addColorStop(1, col(0.85));
  x.fillStyle = grd; x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(40,40,40,0.55)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(52, 52); x.lineTo(76, 76); x.moveTo(76, 52); x.lineTo(52, 76); x.stroke();             // the thread
  x.fillStyle = 'rgba(20,20,20,0.9)';
  for (const [hx, hy] of [[52, 52], [76, 52], [52, 76], [76, 76]]) { x.beginPath(); x.arc(hx, hy, 5.5, 0, Math.PI * 2); x.fill(); }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  m.onBeforeCompile = offset;
  m.customProgramCacheKey = () => 'garment-buttons';
  return m;
}
