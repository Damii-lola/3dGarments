/**
 * Garment builder: photographed garment → a sewn, simulated, textured 3D garment on the model.
 *
 * Nothing is invented. The garment is made the way real clothes are: its front and back photos are
 * the flat pattern pieces (pattern.js) at the garment's real size, sewn together along their shared
 * outline except where the garment opens (neck, armholes, cuffs, hem, waist, trouser hems). The
 * pieces are placed in front of and behind the body — posed with its arms along the photo's sleeves —
 * sewn shut around it, dropped under gravity onto the skin (and onto whatever is worn under them),
 * then the arms are brought down to the pose shown while the cloth keeps moving (cloth.js). Folds,
 * drape, flare, the fitted parts and the loose ones all come out of that, not out of rules.
 *
 *   texture    every point of each piece is a pixel of its photo (front / back); the back of an
 *              unphotographed garment is its own base colour with the front's shading (never a copy
 *              of a print), or the fabric mirrored when it repeats
 *   scale      a flat-laid garment is half its circumference wide. Tops: chest = the body's fullest
 *              chest × (1 + the ease of the photographed fit); bottoms: waistband = the body's girth there
 *   thickness  an outer and an inner surface, the fabric's thickness apart
 *   motion     skinned to the skin under it (un-skinned into the bind pose), so it follows every pose;
 *              body sliders move it live (each vertex follows the skin under it), and it is re-draped
 *              exactly once they settle (Outfit)
 *
 * Skin right under the cloth is hidden (Body#setHidden), so it can never poke through.
 */
import * as THREE from 'three';
import { prepareFabric, createFabricMaterial, blur } from './fabric.js';
import { buildPattern } from './pattern.js';
import { Cloth, makeCollider } from './cloth.js';

const REGION = (name) => {
  if (/^(pelvis|spine_0\d|clavicle_[lr])$/.test(name)) return 'torso';
  if (name === 'neck_01') return 'neck';
  if (name === 'head') return 'head';
  if (/^(upperarm|lowerarm)_([lr])$/.test(name)) return `arm_${name.slice(-1)}`;
  if (/^(thigh|calf)_([lr])$/.test(name)) return `leg_${name.slice(-1)}`;
  if (/^(foot|ball)_([lr])$/.test(name)) return `foot_${name.slice(-1)}`;
  return 'hand';
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function hull2(p) {
  if (p.length < 3) return p.slice();
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
const polyLen = (h) => h.reduce((s, q, i) => s + Math.hypot(q[0] - h[(i + 1) % h.length][0], q[1] - h[(i + 1) % h.length][1]), 0);

/* ---- affine 3×4 matrices (12 floats: the three columns, then the translation) ---- */
const affineOf = (list, ME, out = new Float64Array(12)) => {
  out.fill(0);
  for (const [b, w] of list) {
    const e = ME[b];
    out[0] += w * e[0]; out[1] += w * e[1]; out[2] += w * e[2];
    out[3] += w * e[4]; out[4] += w * e[5]; out[5] += w * e[6];
    out[6] += w * e[8]; out[7] += w * e[9]; out[8] += w * e[10];
    out[9] += w * e[12]; out[10] += w * e[13]; out[11] += w * e[14];
  }
  return out;
};
const applyA = (a, x, y, z, out, o) => {
  out[o] = a[0] * x + a[3] * y + a[6] * z + a[9];
  out[o + 1] = a[1] * x + a[4] * y + a[7] * z + a[10];
  out[o + 2] = a[2] * x + a[5] * y + a[8] * z + a[11];
};
const applyA3 = (a, x, y, z, out, o) => {
  out[o] = a[0] * x + a[3] * y + a[6] * z;
  out[o + 1] = a[1] * x + a[4] * y + a[7] * z;
  out[o + 2] = a[2] * x + a[5] * y + a[8] * z;
};
/** inverse of the 3×3 part, in place layout (translation handled by the caller) */
const inv3 = (a) => {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const c0 = a4 * a8 - a5 * a7, c1 = a5 * a6 - a3 * a8, c2 = a3 * a7 - a4 * a6;
  const det = a0 * c0 + a1 * c1 + a2 * c2 || 1e-12, k = 1 / det;
  return [c0 * k, (a2 * a7 - a1 * a8) * k, (a1 * a5 - a2 * a4) * k,
    c1 * k, (a0 * a8 - a2 * a6) * k, (a2 * a3 - a0 * a5) * k,
    c2 * k, (a1 * a6 - a0 * a7) * k, (a0 * a4 - a1 * a3) * k];
};

/* ================================================================ the body */

const statics = new WeakMap();
/** per-body data that never changes (bind space) */
function staticBody(body) {
  if (statics.has(body)) return statics.get(body);
  const shape = body.ensureShape();
  const g = body.mesh.geometry, part = g.attributes._part.array, n = part.length;
  const region = body.bones.map((b) => REGION(b.name));
  const reg = new Array(n);
  for (let i = 0; i < n; i++) reg[i] = part[i] === 0 ? region[body.dom[i]] : 'fabric';
  // underwear vertex → the skin under it (hidden together)
  const P = shape.base, grid = new Map(), cell = 0.02;
  const ck = (a, b, c) => ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512);
  for (let i = 0; i < n; i++) if (part[i] === 0) {
    const k = ck(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const fabricSkin = [];
  for (let i = 0; i < n; i++) {
    if (part[i] !== 4) continue;
    const cx = Math.floor(P[i * 3] / cell), cy = Math.floor(P[i * 3 + 1] / cell), cz = Math.floor(P[i * 3 + 2] / cell);
    let best = -1, bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const j of grid.get(ck(cx + a, cy + b, cz + c)) || []) {
      const d = (P[j * 3] - P[i * 3]) ** 2 + (P[j * 3 + 1] - P[i * 3 + 1]) ** 2 + (P[j * 3 + 2] - P[i * 3 + 2]) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) fabricSkin.push([i, best]);
  }
  const s = { shape, reg, part, n, fabricSkin };
  statics.set(body, s);
  return s;
}


/**
 * The body in its current pose, in the human's local space (metres, unscaled): skinned positions,
 * normals, and the per-bone matrices (posed = Σ w · M_b · rest). `Qc`: rest positions with the current
 * morphs; `WL`: skin weights per vertex.
 */
function skinBody(body, human, Qc, WL) {
  const mesh = body.mesh, n = WL.length;
  human.object.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bm = mesh.skeleton.boneMatrices;
  const K = new THREE.Matrix4().copy(human.object.matrixWorld).invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
  const ME = body.bones.map((_, b) => new THREE.Matrix4().fromArray(bm, b * 16).premultiply(K).multiply(mesh.bindMatrix).elements);
  const Nb = mesh.geometry.attributes.normal.array;
  const Q = new Float32Array(n * 3), N = new Float32Array(n * 3), a = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    affineOf(WL[i], ME, a);
    applyA(a, Qc[i * 3], Qc[i * 3 + 1], Qc[i * 3 + 2], Q, i * 3);
    applyA3(a, Nb[i * 3], Nb[i * 3 + 1], Nb[i * 3 + 2], N, i * 3);
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
  }
  return { Q, N, ME };
}

/** the body as shown: shape, pose, landmarks, lookups */
function posedBody(body, human) {
  const S = staticBody(body), { shape, reg, part, n } = S;
  const mesh = body.mesh, g = mesh.geometry;
  const infl = Array.from(mesh.morphTargetInfluences || []);
  const deltas = (g.morphAttributes.position || []).map((m) => m.array);
  const Qc = Float32Array.from(shape.base);
  deltas.forEach((d, k) => { const w = infl[k]; if (w) for (let i = 0; i < Qc.length; i++) Qc[i] += d[i] * w; });
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const WL = new Array(n);
  for (let i = 0; i < n; i++) { const out = []; for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > 0) out.push([si.getComponent(i, c), w]); } WL[i] = out; }
  const { Q, N, ME } = skinBody(body, human, Qc, WL);

  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) if (part[i] === 0) { yMin = Math.min(yMin, Q[i * 3 + 1]); yMax = Math.max(yMax, Q[i * 3 + 1]); }
  const inv = new THREE.Matrix4().copy(human.object.matrixWorld).invert();
  const joint = (name) => body.bones[body.boneIndex[name]].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const Mp = ME[body.boneIndex.pelvis], L0 = shape.L;
  const yP = (y) => Mp[5] * y + Mp[13];
  const H = yMax - yMin;
  const L = { H, crotchY: yP(L0.crotchY), hipY: yP(L0.hipY), waistY: yP(L0.waistY) };
  const arms = {};
  for (const s of ['l', 'r']) arms[s] = { S: joint(`upperarm_${s}`), E: joint(`lowerarm_${s}`), W: joint(`hand_${s}`) };
  const yArm = Math.max(arms.l.S.y, arms.r.S.y) - 0.065 * (H / 1.75);

  // nearest skin (2 cm grid)
  const grid = new Map(), cell = 0.02;
  const ck = (a, b, c) => ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512);
  for (let i = 0; i < n; i++) if (part[i] === 0) {
    const k = ck(Math.floor(Q[i * 3] / cell), Math.floor(Q[i * 3 + 1] / cell), Math.floor(Q[i * 3 + 2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const nearestSkin = (x, y, z, test = null, maxRad = 4) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let rad = 1; rad <= maxRad; rad++) {
      let best = -1, bd = Infinity;
      for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) for (let c = -rad; c <= rad; c++) {
        for (const i of grid.get(ck(cx + a, cy + b, cz + c)) || []) {
          if (test && !test(i)) continue;
          const d = (Q[i * 3] - x) ** 2 + (Q[i * 3 + 1] - y) ** 2 + (Q[i * 3 + 2] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };

  // the side-neck point (where a top's collar rests)
  const neckY = joint('neck_01').y;
  let xN = 0;
  for (let i = 0; i < n; i++) if (reg[i] === 'neck' && Q[i * 3 + 1] > neckY + 0.01 && Q[i * 3 + 1] < neckY + 0.05) xN = Math.max(xN, Math.abs(Q[i * 3]));
  xN = xN || 0.06;
  let yNeckSide = -Infinity;
  for (let i = 0; i < n; i++) if (reg[i] === 'torso' && Math.abs(Math.abs(Q[i * 3]) - xN - 0.01) < 0.01) yNeckSide = Math.max(yNeckSide, Q[i * 3 + 1]);
  if (!Number.isFinite(yNeckSide)) yNeckSide = neckY;

  /** tape-measure girth (hull perimeter) of the trunk at a height */
  const girthAt = (y) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const r = reg[i];
      if (!(r === 'torso' || r === 'leg_l' || r === 'leg_r' || r === 'fabric')) continue;
      if (Math.abs(Q[i * 3 + 1] - y) < 0.008) pts.push([Q[i * 3], Q[i * 3 + 2]]);
    }
    return pts.length > 8 ? polyLen(hull2(pts)) : 0.8;
  };
  return { body, human, S, reg, part, n, Q, N, ME, WL, Qc, infl, deltas, yMin, yMax, L, arms, yArm, xN, yNeckSide, nearestSkin, girthAt };
}

/* ---- the body's pose, held and changed for the drape ---- */
const snapPose = (bones) => bones.map((b) => [b.position.clone(), b.quaternion.clone()]);
const setPose = (bones, snap) => bones.forEach((b, i) => { b.position.copy(snap[i][0]); b.quaternion.copy(snap[i][1]); });
const lerpPose = (bones, A, B, t) => bones.forEach((b, i) => { b.position.lerpVectors(A[i][0], B[i][0], t); b.quaternion.slerpQuaternions(A[i][1], B[i][1], t); });

/** raise the arms straight along the photo's sleeves: `angle` below horizontal, per side */
function armsAlong(body, human, angle) {
  const obj = human.object;
  obj.updateMatrixWorld(true);
  const q = new THREE.Quaternion(), wq = new THREE.Quaternion(), pq = new THREE.Quaternion();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), t = new THREE.Vector3();
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1;
    t.set(sx * Math.cos(angle[s]), -Math.sin(angle[s]), 0.04).transformDirection(obj.matrixWorld);
    for (const [bn, cn] of [[`upperarm_${s}`, `lowerarm_${s}`], [`lowerarm_${s}`, `hand_${s}`]]) {
      const bone = body.bones[body.boneIndex[bn]], child = body.bones[body.boneIndex[cn]];
      bone.getWorldPosition(a); child.getWorldPosition(b);
      q.setFromUnitVectors(b.sub(a).normalize(), t);
      bone.getWorldQuaternion(wq);
      bone.parent.getWorldQuaternion(pq);
      bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
      bone.updateMatrixWorld(true);
    }
  }
  obj.updateMatrixWorld(true);
}

/* ================================================================ photos */

/** mirror a garment-space measurement set left ↔ right (a photo flipped horizontally) */
function mirrorGeometry(g) {
  if (!g) return g;
  const a = g.aspect, fx = (x) => a - x, span = (s) => s && [fx(s[1]), fx(s[0])];
  const sleeve = (s) => s && { ...s, root: [fx(s.root[0]), s.root[1]], dir: [-s.dir[0], s.dir[1]], offset: -s.offset };
  return {
    ...g, centerX: fx(g.centerX),
    sleeves: { left: sleeve(g.sleeves?.right), right: sleeve(g.sleeves?.left) },
    rows: g.rows.map((r) => ({ ...r, t: span(r.t), legs: r.legs && [span(r.legs[1]), span(r.legs[0])], runs: r.runs.map(span).reverse() })),
  };
}

/** a cut-out photo: alpha lookups + its garment-space geometry (unit = image height, y down) */
export class Photo {
  constructor(image, geometry) {
    this.geometry = geometry;
    const w = image.width || image.naturalWidth, h = image.height || image.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    this.canvas = c;
    this.data = ctx.getImageData(0, 0, w, h).data;
    this.w = w; this.h = h;
    this.rows = geometry?.rows || [];
  }
  /** the same photo flipped left ↔ right (what the garment's back looks like from behind, if it repeats) */
  mirrored() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d');
    ctx.translate(this.w, 0); ctx.scale(-1, 1);
    ctx.drawImage(this.canvas, 0, 0);
    return new Photo(c, mirrorGeometry(this.geometry));
  }
  alpha(gx, gy) {
    const x = Math.round(gx * this.h), y = Math.round(gy * this.h);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3] / 255;
  }
  /** torso edges [l, r] at a photo height (interpolated between rows) */
  torsoAt(gy) { return this.#field(gy, (r) => r.t); }
  /** the two legs [[l, r], [l, r]] at a photo height (image-left leg first) */
  legsAt(gy) { return this.#field(gy, (r) => r.legs, true); }
  #field(gy, get, raw = false) {
    const R = this.rows;
    if (!R.length) return null;
    let k = 0;
    while (k < R.length - 1 && R[k + 1].y <= gy) k++;
    const A = get(R[k]), B = R[k + 1] && get(R[k + 1]);
    if (A && B && !raw) {
      const f = Math.max(0, Math.min(1, (gy - R[k].y) / ((R[k + 1].y - R[k].y) || 1)));
      return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
    }
    for (let d = 0; d < 4; d++) for (const j of [k - d, k + 1 + d]) if (R[j] && get(R[j])) return get(R[j]);
    return null;
  }
  /** first opaque row per pixel column (−1: none) */
  columnTops() {
    if (!this.tops) {
      this.tops = new Int32Array(this.w).fill(-1);
      for (let x = 0; x < this.w; x++) for (let y = 0; y < this.h; y++) if (this.data[(y * this.w + x) * 4 + 3] > 128) { this.tops[x] = y; break; }
    }
    return this.tops;
  }
  /**
   * The garment's top edge seen from above, the neck opening bridged (upper convex hull of the
   * outline's top): along it the garment rests on the shoulders. → gy at a photo x.
   */
  topEdge(gx) {
    if (!this.env) {
      const tops = this.columnTops(), pts = [];
      const step = Math.max(1, Math.round(this.w / 300));
      for (let x = 0; x < this.w; x += step) if (tops[x] >= 0) pts.push([x / this.h, -tops[x] / this.h]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const hi = [];
      for (const q of pts) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) >= 0) hi.pop(); hi.push(q); }
      this.env = hi.map(([x, y]) => [x, -y]);
    }
    const E = this.env;
    if (!E.length) return this.geometry?.top ?? 0;
    if (gx <= E[0][0]) return E[0][1];
    for (let i = 1; i < E.length; i++) if (gx <= E[i][0]) { const f = (gx - E[i - 1][0]) / ((E[i][0] - E[i - 1][0]) || 1); return E[i - 1][1] + (E[i][1] - E[i - 1][1]) * f; }
    return E[E.length - 1][1];
  }
  /** the garment's main colour: median of the opaque pixels */
  baseColor() {
    const px = [];
    for (let i = 0; i < this.data.length; i += 4 * 7) if (this.data[i + 3] > 240) px.push([this.data[i], this.data[i + 1], this.data[i + 2]]);
    if (!px.length) return [128, 128, 128];
    const med = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
    return [med(0), med(1), med(2)];
  }
}

/**
 * The back of a garment whose back wasn't photographed and whose fabric isn't a repeat: its own base
 * colour with the front's fabric shading (mirrored, so the side seams meet), in the front's outline —
 * never a copy of a print. A back neckline sits higher than a front one: the front's scoop is kept to
 * a third of its depth.
 */
function plainBack(Fm) {
  const { w, h, data } = Fm;
  const [br, bg, bb] = Fm.baseColor();
  const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const L0 = lumOf(br, bg, bb) || 1;
  const lm = new Float32Array(w * h), m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (data[i * 4 + 3] > 245 && Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < 70) { lm[i] = lumOf(r, g, b); m[i] = 1; }
  }
  const rad = Math.max(2, Math.round(h / 40));
  const Bl = blur(lm, w, h, rad), Bm = blur(m, w, h, rad);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const tops = Fm.columnTops();
  for (let x = 0; x < w; x++) {
    const t = tops[x];
    const env = Math.round(Fm.topEdge(x / h) * h);
    const top = t < 0 ? -1 : t - env > 2 ? Math.round(env + (t - env) / 3) : t;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      let a = data[i * 4 + 3];
      if (top >= 0 && y >= top && y < t) a = 255;                 // the higher back neckline
      if (!a) continue;
      const shade = Bm[i] > 0.05 ? Math.max(0.7, Math.min(1.25, Bl[i] / Bm[i] / L0)) : 1;
      d[i * 4] = Math.min(255, br * shade); d[i * 4 + 1] = Math.min(255, bg * shade); d[i * 4 + 2] = Math.min(255, bb * shade);
      d[i * 4 + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new Photo(c, Fm.geometry);
}

/* ================================================================ fit parameters */

/** ease over the body's chest, by the photographed fit */
const EASE = { tight: 0.02, fitted: 0.05, slim: 0.05, regular: 0.12, relaxed: 0.2, loose: 0.26, oversized: 0.38 };
/** fabric thickness (m) */
const THICK = { denim: 0.0012, wool: 0.0025, leather: 0.0015, knit: 0.0012, fleece: 0.003, silk: 0.0004, satin: 0.0004, linen: 0.0007, cotton: 0.0008, polyester: 0.0007 };
const thicknessOf = (m) => { const k = String(m || '').toLowerCase().split(/[^a-z]+/).find((w) => THICK[w]); return k ? THICK[k] : 0.0008; };

/* ================================================================ atlas */

function makeAtlas(item, photos) {
  const F = photos.front;
  let B = photos.back;
  if (!B) { const Fm = F.mirrored(); B = item.backFill === 'mirror' ? Fm : plainBack(Fm); }
  const W = F.w + B.w, H = Math.max(F.h, B.h);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(F.canvas, 0, 0);
  ctx.drawImage(B.canvas, F.w, 0);
  const normalCanvas = prepareFabric(canvas, [{ x: 0, w: F.w, h: F.h }, { x: F.w, w: B.w, h: B.h }]);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const ox = { front: 0, back: F.w };
  return {
    map: tex(canvas, true), normalMap: tex(normalCanvas, false), front: F, back: B, W, H,
    uv(panel, gx, gy) { const p = panel === 'front' ? F : B; return [(ox[panel] + gx * p.h) / W, (gy * p.h) / H]; },
  };
}


/* ================================================================ the builder */

const LOWER = new Set(['pants', 'shorts', 'skirt']);

/**
 * @param body   Body (human.js), as currently shaped and posed
 * @param human  the Human it belongs to (its local space is the build space)
 * @param item   wardrobe item (shared/wardrobe.js): category, fit, material, backFill …
 * @param photos { front: Photo, back?: Photo, side?: Photo }
 * @param opts   { under: [{ pts, nrm }] garments worn underneath (posed), warm: a previous build's state }
 * @returns { mesh, hide, posed: { pts, nrm }, state, infl, follow(), dispose() }
 */
export function buildGarment(body, human, item, photos, { under = [], warm = null } = {}) {
  if (item.category === 'shoes' || item.category === 'hat') {
    const ctx = posedBody(body, human);
    const atlas = makeAtlas({ ...item, backFill: 'mirror' }, { front: photos.front });
    const r = buildProjected(ctx, item, atlas);
    const pos = r.place(ctx.Q);
    return finish(ctx, item, atlas, { verts: r.verts, idx: r.idx, posed: pos, weights: r.verts.map((v) => ctx.WL[v.src]), hide: r.hide, covered: r.covered, s: r.s });
  }
  const atlas = makeAtlas(item, photos);
  return sewAndDrape(body, human, item, atlas, under, warm);
}

/** fabric behaviour by material: stretch and bending compliance, thickness */
function fabricOf(material, cat) {
  const m = String(material || '').toLowerCase();
  const has = (...w) => w.some((k) => m.includes(k));
  let bend = 8e-5, stretch = 2e-7, thick = 0.0008;
  if (has('denim', 'canvas', 'leather', 'twill')) { bend = 1.6e-5; thick = 0.0013; }
  if (has('wool', 'coat', 'fleece', 'felt', 'damask', 'aso')) { bend = 2.5e-5; thick = 0.0022; }
  if (has('silk', 'satin', 'chiffon', 'rayon', 'viscose')) { bend = 4e-4; thick = 0.0004; }
  if (has('jersey', 'knit', 'spandex', 'lycra', 'rib')) { stretch = 3e-6; bend = Math.max(bend, 1e-4); }
  if (cat === 'outerwear') { bend = Math.min(bend, 1.5e-5); thick = Math.max(thick, 0.002); }
  return { bend, stretch, thick };
}

function sewAndDrape(body, human, item, atlas, under, warm) {
  const cat = item.category, kind = LOWER.has(cat) ? 'lower' : 'upper';
  const F = atlas.front, Bk = atlas.back, geo = F.geometry;
  const bones = body.bones;
  const display = snapPose(bones);
  const ctx = posedBody(body, human);
  const { n: nb, Q: Qd, reg, L } = ctx;
  const fab = fabricOf(item.material || item.type, cat);

  /* ---------------- size and where it sits ---------------- */
  const flat = (gy) => { const a = F.torsoAt(gy); return a ? 2 * (a[1] - a[0]) : 0; };
  let s, yA;
  if (kind === 'upper') {
    const ease = (EASE[item.fit] ?? EASE.regular) + (cat === 'outerwear' ? 0.06 : 0);
    let chest = 0;
    for (let y = ctx.yArm - 0.16; y <= ctx.yArm; y += 0.02) chest = Math.max(chest, ctx.girthAt(y));
    let gC = geo.armpit != null ? geo.armpit + 0.012 : null;
    if (gC == null) {       // sleeveless: the widest row in the top half is the bust line
      let best = 0;
      for (let gy = geo.top + 0.05; gy < geo.top + 0.45 * (geo.bottom - geo.top); gy += 0.005) { const w = flat(gy); if (w > best) { best = w; gC = gy; } }
      gC ??= geo.top + 0.3 * (geo.bottom - geo.top);
    }
    s = (chest * (1 + ease)) / (flat(gC) || 0.5);
    yA = ctx.yNeckSide + 0.02;
  } else {
    const yW = L.hipY + 0.55 * (L.waistY - L.hipY);          // the waistband: between the hips and the natural waist
    s = (ctx.girthAt(yW) * 1.0) / (flat(geo.top + 0.012) || 0.5);
    yA = yW + 0.015;
  }
  // a top starts a little above the shoulders: its seams close in the air, then it drops onto them
  const lift = kind === 'upper' ? 0.07 : 0;
  const xOf = (gx) => (gx - geo.centerX) * s, yOf = (gy) => yA + lift - (gy - geo.top) * s;

  /* ---------------- the pattern ---------------- */
  const pat = buildPattern(F, Bk, s, { h: 0.016, kind });
  const n = pat.n, P2 = pat.pos2;
  const NP = n * 2;                                           // front 0…n−1, back n…2n−1

  /* ---------------- the body in the drape pose: arms along the sleeves ---------------- */
  // each arm aimed through the middle of its sleeve (front view: the image-left sleeve is the body's right arm)
  const sleeveAngle = (sl, side) => {
    if (!sl) return 0.62;
    const J = ctx.arms[side].S, mx = sl.root[0] + sl.dir[0] * sl.length * 0.55 + (-sl.dir[1]) * sl.offset, my = sl.root[1] + sl.dir[1] * sl.length * 0.55 + sl.dir[0] * sl.offset;
    return Math.max(0.15, Math.min(1.35, Math.atan2(J.y - yOf(my), Math.abs(xOf(mx) - J.x))));
  };
  let simPose = display;
  if (kind === 'upper' && !warm) {
    armsAlong(body, human, { r: sleeveAngle(geo.sleeves?.left, 'r'), l: sleeveAngle(geo.sleeves?.right, 'l') });
    simPose = snapPose(bones);
  }
  const skinNow = () => skinBody(body, human, ctx.Qc, ctx.WL);
  const underPts = under.map((u) => u.pts), underNrm = under.map((u) => u.nrm);
  const collider = (sk) => {
    const cnt = nb + underPts.reduce((a, u) => a + u.length / 3, 0);
    const pts = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3);
    pts.set(sk.Q); nrm.set(sk.N);
    let o = nb * 3;
    underPts.forEach((u, k) => { pts.set(u, o); nrm.set(underNrm[k], o); o += u.length; });
    return makeCollider(pts, nrm, 0.03);
  };
  let sk = skinNow(), col = collider(sk);

  /* ---------------- pieces in front of and behind the body ---------------- */
  const yTop = yOf(geo.top), yBot = yOf(geo.bottom), half = Math.max(...Array.from({ length: n }, (_, i) => Math.abs(xOf(P2[i * 2])))) + 0.02;
  let zF = -Infinity, zB = Infinity;
  const Pc = col.pts;
  for (let i = 0; i < Pc.length / 3; i++) {
    const y = Pc[i * 3 + 1], x = Pc[i * 3];
    if (y < yBot - 0.03 || y > yTop + 0.03 || Math.abs(x) > half) continue;
    if (i < nb && (reg[i] === 'head' || reg[i] === 'hand')) continue;
    zF = Math.max(zF, Pc[i * 3 + 2]); zB = Math.min(zB, Pc[i * 3 + 2]);
  }
  zF += 0.03; zB -= 0.03;
  const init = new Float32Array(NP * 3);
  for (let i = 0; i < n; i++) {
    const x = xOf(P2[i * 2]), y = yOf(P2[i * 2 + 1]);
    init.set([x, y, zF], i * 3); init.set([x, y, zB], (n + i) * 3);
  }
  const cloth = new Cloth(warm && warm.x.length === init.length ? warm.x : init);

  /* ---------------- constraints ---------------- */
  const T = pat.tris;
  const edgeTris = new Map();
  const ek = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < T.length; t += 3) for (let q = 0; q < 3; q++) {
    const a = T[t + q], b = T[t + ((q + 1) % 3)], c = T[t + ((q + 2) % 3)], k = ek(a, b);
    const e = edgeTris.get(k);
    if (e) e.push(c); else edgeTris.set(k, [a, b, c]);
  }
  const d2 = (a, b) => Math.hypot(P2[a * 2] - P2[b * 2], P2[a * 2 + 1] - P2[b * 2 + 1]) * s;
  const sp = [], sr = [], bp = [], br = [];
  for (const e of edgeTris.values()) {
    const [a, b, c, d] = e;
    for (const o of [0, n]) { sp.push(a + o, b + o); sr.push(d2(a, b)); }
    if (d != null) for (const o of [0, n]) { bp.push(c + o, d + o); br.push(d2(c, d)); }
  }
  cloth.addGroup(sp, sr, fab.stretch).limit = 1.08;
  cloth.addGroup(bp, br, fab.bend);
  const sewn = [...pat.sewn], seamPairs = [], seamRest = [];
  for (const v of sewn) { seamPairs.push(v, n + v); seamRest.push(warm ? 0 : zF - zB); }
  const seam = cloth.addGroup(seamPairs, seamRest, 0);
  const rest0 = Float32Array.from(seamRest);

  /* ---------------- drape ---------------- */
  const thick = 0.004 + (under.length ? 0.002 : 0) + fab.thick;
  const G = -9.81, dt = 1 / 60, SUB = 4;
  // debug: stop at a phase and show the raw cloth (normal-shaded) on the body as it is then
  const stopAt = (phase) => {
    if (globalThis.__simStop !== phase) return null;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(cloth.x), 3));
    const ii = [];
    for (let t = 0; t < T.length; t += 3) ii.push(T[t], T[t + 1], T[t + 2], n + T[t], n + T[t + 2], n + T[t + 1]);
    gg.setIndex(ii); gg.computeVertexNormals();
    const m = new THREE.Mesh(gg, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }));
    human.object.add(m);
    return { mesh: m, hide: new Set(), posed: { pts: Float32Array.from(cloth.x), nrm: new Float32Array(cloth.x.length) }, state: null, follow() {}, dispose() { m.removeFromParent(); gg.dispose(); } };
  };
  const log = globalThis.__simLog ? (tag) => {
    const X = cloth.x; let zf = 0, zb = 0, ymin = 1e9, ymax = -1e9;
    for (let i = 0; i < n; i++) { zf += X[i * 3 + 2]; zb += X[(n + i) * 3 + 2]; ymin = Math.min(ymin, X[i * 3 + 1]); ymax = Math.max(ymax, X[i * 3 + 1]); }
    globalThis.__simLog.push([tag, +(zf / n).toFixed(3), +(zb / n).toFixed(3), +ymin.toFixed(3), +ymax.toFixed(3)]);
  } : () => {};
  log('init');
  if (!warm) {
    const SEW = 70;
    cloth.stick = 0;                                  // seams slide over the body while they close
    for (let t = 0; t < SEW; t++) {
      const k = Math.max(0, 1 - (t + 1) / (SEW * 0.75));
      for (let q = 0; q < rest0.length; q++) seam.rest[q] = rest0[q] * k;
      cloth.step(dt, SUB, G * smooth(SEW * 0.6, SEW, t), col, thick);
      if (t % 10 === 9) log('sew' + t);
      if (t === 20 && globalThis.__simStop === 'sew20') return stopAt('sew20');
    }
    if (globalThis.__simStop === 'sew') return stopAt('sew');
    cloth.stick = 1;
    for (let t = 0; t < 40; t++) { cloth.step(dt, SUB, G, col, thick); if (t % 10 === 9) log('fall' + t); }
    if (globalThis.__simStop === 'fall') return stopAt('fall');
    if (simPose !== display) {
      // arms down to the pose shown: the cloth is carried by the skin under it (as the finished
      // garment will be), then settles there under gravity and collisions
      const X = cloth.x, W = [], A0 = [], a = new Float64Array(12);
      // a point of a sleeve (outside the photo's torso edges) is carried by its arm; the rest by the skin under it
      const armOf = (k) => {
        const i = k % n, gx = P2[i * 2], gy = P2[i * 2 + 1], e = F.torsoAt(gy);
        if (!e || (gx > e[0] - 0.01 && gx < e[1] + 0.01) || !(geo.sleeves?.left || geo.sleeves?.right)) return null;
        return gx < geo.centerX ? 'arm_r' : 'arm_l';            // image-left = the body's right
      };
      for (let k = 0; k < NP; k++) {
        const arm = armOf(k);
        const i = ctx.nearestSkin(X[k * 3], X[k * 3 + 1], X[k * 3 + 2], arm ? (v) => reg[v] === arm : (v) => reg[v] !== 'head' && reg[v] !== 'hand', 8);
        W.push(i >= 0 ? ctx.WL[i] : [[body.boneIndex.pelvis, 1]]);
      }
      const MEs = sk.ME;
      const restP = new Float64Array(NP * 3);
      for (let k = 0; k < NP; k++) {
        affineOf(W[k], MEs, a);
        const m = inv3(a), x = X[k * 3] - a[9], y = X[k * 3 + 1] - a[10], z = X[k * 3 + 2] - a[11];
        restP[k * 3] = m[0] * x + m[3] * y + m[6] * z; restP[k * 3 + 1] = m[1] * x + m[4] * y + m[7] * z; restP[k * 3 + 2] = m[2] * x + m[5] * y + m[8] * z;
      }
      void A0;
      // lowered in small steps: each moves every point with its skin, then the cloth relaxes
      const STEPS = 24, prev = new Float32Array(NP * 3), cur = new Float32Array(NP * 3);
      const place = (ME, out) => { for (let k = 0; k < NP; k++) { affineOf(W[k], ME, a); applyA(a, restP[k * 3], restP[k * 3 + 1], restP[k * 3 + 2], out, k * 3); } };
      place(sk.ME, prev);
      for (let t = 1; t <= STEPS; t++) {
        lerpPose(bones, simPose, display, smooth(0, 1, t / STEPS));
        sk = skinNow(); col = collider(sk);
        place(sk.ME, cur);
        for (let q = 0; q < NP * 3; q++) { const d = cur[q] - prev[q]; cloth.x[q] += d; cloth.p[q] += d; }
        prev.set(cur);
        for (let r = 0; r < 3; r++) cloth.step(dt, SUB, G, col, thick);
      }
      log('carried');
      if (globalThis.__simStop === 'carried') return stopAt('carried');
    }
  }
  setPose(bones, display);
  human.object.updateMatrixWorld(true);
  sk = skinNow(); col = collider(sk);
  log('display');
  for (let t = 0; t < (warm ? 50 : 90); t++) { cloth.step(dt, SUB, G, col, thick, t > 60 ? 0.97 : 0.995); if (t % 10 === 9) log('settle' + t); }

  if (globalThis.__simStop === 'final') return stopAt('final');
  /* ---------------- mesh ---------------- */
  // front faces outward (+z): fix the winding from the photo's y-down grid
  const X = cloth.x;
  const t0 = [T[0], T[1], T[2]];
  const e1 = [init[t0[1] * 3] - init[t0[0] * 3], init[t0[1] * 3 + 1] - init[t0[0] * 3 + 1]];
  const e2 = [init[t0[2] * 3] - init[t0[0] * 3], init[t0[2] * 3 + 1] - init[t0[0] * 3 + 1]];
  const flip = e1[0] * e2[1] - e1[1] * e2[0] < 0;
  const idx = [];
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = flip ? [T[t], T[t + 2], T[t + 1]] : [T[t], T[t + 1], T[t + 2]];
    idx.push(a, b, c);                 // front
    idx.push(n + a, n + c, n + b);     // back (faces −z)
  }
  const verts = [];
  const alpha = new Float32Array(NP);
  for (let i = 0; i < n; i++) {
    const gx = P2[i * 2], gy = P2[i * 2 + 1];
    verts.push({ uv: atlas.uv('front', gx, gy) });
    alpha[i] = pat.alphaF(gx, gy);
  }
  for (let i = 0; i < n; i++) {
    const [bx, by] = pat.backXY(P2[i * 2], P2[i * 2 + 1]);
    verts.push({ uv: atlas.uv('back', bx, by) });
    alpha[n + i] = pat.alphaB(P2[i * 2], P2[i * 2 + 1]);
  }
  // skin weights: the skin under each point (arms for sleeves, legs for trouser legs …)
  const weights = [];
  for (let k = 0; k < NP; k++) {
    const src = ctx.nearestSkin(X[k * 3], X[k * 3 + 1], X[k * 3 + 2], (i) => reg[i] !== 'head' && reg[i] !== 'hand', 6);
    verts[k].src = src;
    weights.push(src >= 0 ? ctx.WL[src] : [[body.boneIndex.pelvis, 1]]);
  }

  /* ---------------- skin under the cloth ---------------- */
  const cgrid = makeCollider(X, new Float32Array(X.length), 0.035);
  const hide = new Set();
  const Qs = sk.Q, Ns = sk.N;
  for (let i = 0; i < nb; i++) {
    if (ctx.part[i] !== 0 || reg[i] === 'head' || reg[i] === 'hand') continue;
    const x = Qs[i * 3], y = Qs[i * 3 + 1], z = Qs[i * 3 + 2];
    const c = cgrid.nearest(x, y, z);
    if (c < 0 || alpha[c] < 0.95) continue;
    const out = (X[c * 3] - x) * Ns[i * 3] + (X[c * 3 + 1] - y) * Ns[i * 3 + 1] + (X[c * 3 + 2] - z) * Ns[i * 3 + 2];
    if (out > -0.003 && Math.hypot(X[c * 3] - x, X[c * 3 + 1] - y, X[c * 3 + 2] - z) < 0.035) hide.add(i);
  }
  const res = finish(ctx, item, atlas, { verts, idx, posed: X, weights, hide, covered: (i) => hide.has(i), s, thickness: fab.thick });
  res.state = { x: Float32Array.from(X) };
  if (globalThis.__fitDebug) globalThis.__fitDebug = { ctx, pat, cloth, s, verts, alpha };
  return res;
}

/* ================================================================ shoes / hats */

function buildProjected(ctx, item, atlas) {
  const { Q, N, n, reg } = ctx;
  const F = atlas.front, geo = F.geometry;
  const M = new Array(n);
  let s = 1;
  if (item.category === 'shoes') {
    for (const side of ['l', 'r']) {
      const vs = [];
      for (let i = 0; i < n; i++) if (reg[i] === `foot_${side}` || (reg[i] === `leg_${side}` && Q[i * 3 + 1] < ctx.yMin + 0.18)) vs.push(i);
      if (!vs.length) continue;
      let z0 = Infinity, z1 = -Infinity, y0 = Infinity;
      for (const i of vs) { z0 = Math.min(z0, Q[i * 3 + 2]); z1 = Math.max(z1, Q[i * 3 + 2]); y0 = Math.min(y0, Q[i * 3 + 1]); }
      // the side photo: the toe end is the lower end of the profile
      const w = F.w / F.h;
      const colTop = (x0, x1) => { let sum = 0, c = 0; for (let x = x0; x < x1; x += 0.01) { let top = 1; for (let y = 0; y < 1; y += 0.01) if (F.alpha(x, y) > 0.5) { top = y; break; } sum += 1 - top; c++; } return sum / (c || 1); };
      const toeRight = colTop(w * 0.75, w) < colTop(0, w * 0.25);
      const Lf = z1 - z0; s = (Lf * 1.06) / (w * 0.94);
      for (const i of vs) {
        const y = Q[i * 3 + 1] - y0, f = (Q[i * 3 + 2] - z0) / Lf;
        const gx = toeRight ? w * (0.03 + f * 0.94) : w * (0.97 - f * 0.94), gy = geo.bottom - y / s;
        M[i] = { gx, gy, a: F.alpha(gx, gy) };
      }
    }
  } else {
    const vs = [];
    for (let i = 0; i < n; i++) if (reg[i] === 'head' || reg[i] === 'neck') vs.push(i);
    let top = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const i of vs) top = Math.max(top, Q[i * 3 + 1]);
    for (const i of vs) if (Q[i * 3 + 1] > top - 0.08) { x0 = Math.min(x0, Q[i * 3]); x1 = Math.max(x1, Q[i * 3]); }
    const e = F.torsoAt(geo.bottom - 0.02) || [0, F.w / F.h];
    s = ((x1 - x0) * 1.1) / (e[1] - e[0]);
    const yBand = Math.max(top - (geo.bottom - geo.top) * s, top - 0.16 * (ctx.L.H / 1.75));
    for (const i of vs) {
      const y = Q[i * 3 + 1];
      if (y < yBand - 0.01) continue;
      M[i] = { gx: (e[0] + e[1]) / 2 + Q[i * 3] / s, gy: geo.bottom - (y - yBand) / s, a: y >= yBand ? 1 : 0 };
    }
  }
  const I = ctx.S.shape.index, verts = [], key = new Map(), idx = [];
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    if (tri.some((i) => !M[i]) || tri.every((i) => M[i].a < 0.5)) continue;
    for (const i of tri) {
      if (!key.has(i)) { key.set(i, verts.length); verts.push({ src: i, uv: atlas.uv('front', M[i].gx, M[i].gy) }); }
      idx.push(key.get(i));
    }
  }
  const thick = 0.002, off = 0.004, nv = verts.length;
  const place = (Qk) => {
    const out = new Float32Array(nv * 6);
    verts.forEach((v, k) => {
      const i = v.src;
      for (const [layer, o] of [[0, off + thick], [1, off]]) for (let c = 0; c < 3; c++) out[(k + layer * nv) * 3 + c] = Qk[i * 3 + c] + N[i * 3 + c] * o;
    });
    return out;
  };
  const hide = new Set();
  for (let i = 0; i < n; i++) if (M[i] && M[i].a > 0.98) hide.add(i);
  return { verts, idx, place, solveAll: () => null, hide, covered: (i) => hide.has(i), s, thick };
}

/* ================================================================ mesh */

/** smooth normals, welded by position (panel seams shade as one surface) */
function weldedNormals(pos, index) {
  const nv = pos.length / 3, key = new Map(), rep = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(pos[i * 3] * 5e3)},${Math.round(pos[i * 3 + 1] * 5e3)},${Math.round(pos[i * 3 + 2] * 5e3)}`;
    if (!key.has(k)) key.set(k, i);
    rep[i] = key.get(k);
  }
  const acc = new Float32Array(nv * 3);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (let q = 0; q < 3; q++) { const r = rep[index[t + q]] * 3; acc[r] += nx; acc[r + 1] += ny; acc[r + 2] += nz; }
  }
  const out = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const r = rep[i] * 3, l = Math.hypot(acc[r], acc[r + 1], acc[r + 2]) || 1;
    out[i * 3] = acc[r] / l; out[i * 3 + 1] = acc[r + 1] / l; out[i * 3 + 2] = acc[r + 2] / l;
  }
  return out;
}


/**
 * Posed garment (outer surface) → a skinned, bind-pose mesh with an inner surface, morph targets
 * (each point follows the body's morphs through the skin under it, fading with distance), materials.
 */
function finish(ctx, item, atlas, r) {
  const { body, ME, deltas, infl, Q } = ctx;
  const { verts, idx, posed, weights, hide, covered, s } = r;
  const nv = verts.length, total = nv * 2;
  const th = r.thickness ?? 0.0015;

  const pN = weldedNormals(posed.slice(0, nv * 3), Uint32Array.from(idx));
  const P = new Float32Array(total * 3);
  for (let k = 0; k < nv; k++) for (let c = 0; c < 3; c++) {
    P[k * 3 + c] = posed[k * 3 + c];
    P[(k + nv) * 3 + c] = posed[k * 3 + c] - pN[k * 3 + c] * th;
  }
  // un-skin into the bind pose
  const base = new Float32Array(total * 3), a = new Float64Array(12);
  const inv = new Array(nv);
  for (let k = 0; k < nv; k++) {
    affineOf(weights[k], ME, a);
    inv[k] = { m: inv3(a), t: [a[9], a[10], a[11]] };
  }
  for (let j = 0; j < total; j++) {
    const { m, t } = inv[j < nv ? j : j - nv];
    const x = P[j * 3] - t[0], y = P[j * 3 + 1] - t[1], z = P[j * 3 + 2] - t[2];
    base[j * 3] = m[0] * x + m[3] * y + m[6] * z;
    base[j * 3 + 1] = m[1] * x + m[4] * y + m[7] * z;
    base[j * 3 + 2] = m[2] * x + m[5] * y + m[8] * z;
  }
  // morphs: the skin under each point, fading off where the cloth hangs away from it
  const follow = new Float32Array(nv);
  for (let k = 0; k < nv; k++) {
    const i = verts[k].src;
    if (i == null || i < 0) continue;
    const d = Math.hypot(posed[k * 3] - Q[i * 3], posed[k * 3 + 1] - Q[i * 3 + 1], posed[k * 3 + 2] - Q[i * 3 + 2]);
    follow[k] = 1 - smooth(0.02, 0.12, d) * 0.7;
  }
  const morphs = deltas.map((d) => {
    const out = new Float32Array(total * 3);
    for (let j = 0; j < total; j++) {
      const k = j < nv ? j : j - nv, i = verts[k].src;
      if (i == null || i < 0) continue;
      const f = follow[k];
      out[j * 3] = d[i * 3] * f; out[j * 3 + 1] = d[i * 3 + 1] * f; out[j * 3 + 2] = d[i * 3 + 2] * f;
    }
    return out;
  });

  const uv = new Float32Array(total * 2);
  const skI = new Uint16Array(total * 4), skW = new Float32Array(total * 4);
  for (let k = 0; k < nv; k++) {
    uv.set(verts[k].uv, k * 2); uv.set(verts[k].uv, (k + nv) * 2);
    for (const j of [k, k + nv]) weights[k].slice(0, 4).forEach(([b, w], c) => { skI[j * 4 + c] = b; skW[j * 4 + c] = w; });
  }
  const index = new Uint32Array(idx.length * 2);
  index.set(idx);
  for (let t = 0; t < idx.length; t += 3) { index[idx.length + t] = idx[t] + nv; index[idx.length + t + 1] = idx[t + 2] + nv; index[idx.length + t + 2] = idx[t + 1] + nv; }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  const n0 = weldedNormals(base, index);
  g.setAttribute('normal', new THREE.BufferAttribute(n0, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.addGroup(0, idx.length, 0);
  g.addGroup(idx.length, idx.length, 1);
  if (morphs.length) {
    g.morphAttributes.position = morphs.map((d) => new THREE.BufferAttribute(d, 3));
    g.morphAttributes.normal = morphs.map(() => new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    g.morphTargetsRelative = true;
  }
  g.computeBoundingSphere();

  const mpp = s / atlas.front.h;
  const metresPerUV = [atlas.W * mpp, atlas.H * mpp];
  const label = item.material || item.type;
  const outer = createFabricMaterial({ map: atlas.map, normalMap: atlas.normalMap, material: label, metresPerUV });
  const innerM = createFabricMaterial({ map: atlas.map, normalMap: null, material: label, metresPerUV, inner: true });
  const mesh = new THREE.SkinnedMesh(g, [outer, innerM]);
  mesh.name = `garment:${item.name || item.id}`;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const bodyMesh = body.mesh;
  mesh.position.copy(bodyMesh.position); mesh.quaternion.copy(bodyMesh.quaternion); mesh.scale.copy(bodyMesh.scale);
  bodyMesh.parent.add(mesh);
  mesh.bind(bodyMesh.skeleton, bodyMesh.bindMatrix);
  mesh.bindMatrix = bodyMesh.bindMatrix;                         // shared: a width rebind moves both
  mesh.bindMatrixInverse = bodyMesh.bindMatrixInverse;
  mesh.morphTargetInfluences = new Array(morphs.length).fill(0);

  const hideAll = new Set(hide);
  for (const [f, skn] of ctx.S.fabricSkin) if (covered(skn)) hideAll.add(f);
  return {
    mesh, hide: hideAll, item, scale: s, infl,
    posed: { pts: Float32Array.from(posed.slice(0, nv * 3)), nrm: pN },
    /** follow the body's morphs since the build (live, while sliders move) */
    follow(bodyInfl) { for (let k = 0; k < morphs.length; k++) mesh.morphTargetInfluences[k] = (bodyInfl[k] || 0) - (infl[k] || 0); },
    dispose() { mesh.removeFromParent(); g.dispose(); outer.dispose(); innerM.dispose(); atlas.map.dispose(); atlas.normalMap.dispose(); },
  };
}
