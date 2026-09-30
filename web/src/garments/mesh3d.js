/**
 * A garment that is already 3D (TRELLIS.2: photo → textured garment mesh, tools/garment_ml/trellis2) put
 * on OUR model:
 *
 *   reduce   the generated mesh (~400k triangles) simplified to a few tens of thousands, UVs kept
 *            (meshoptimizer), welded by position for the simulation (UV seams stay seams in the render)
 *   place    lined up with the body where it's worn (a top's collar on the side-neck point, trousers' and
 *            skirts' waist on the waist) and scaled so its body width fits ours with a little ease
 *   fit      the body starts shrunk onto its bones (so it is inside the garment wherever the garment is)
 *            and grows back to full size: the cloth is pushed out onto it from the inside, keeping its
 *            own lengths (a knit gives a little, woven barely) — then gravity, and a waist that grips
 *   finish   skinned to the body like every garment (fit.js finish), with the model's own texture
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { makeCollider } from './cloth.js';
import { posedBody, finish, fabricOf, smooth } from './fit.js';

/** GLB → { pos, uv, index, map (texture) } (one primitive, as TRELLIS.2 exports it) */
export async function loadGarmentGLB(url) {
  const g = await new GLTFLoader().loadAsync(url);
  let mesh = null;
  g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  const geo = mesh.geometry, n = geo.attributes.position.count;
  // Hunyuan3D's shapes come untextured (no UVs, no map): relief only
  return {
    pos: geo.attributes.position.array, uv: geo.attributes.uv ? geo.attributes.uv.array : new Float32Array(n * 2),
    index: geo.index ? geo.index.array : Uint32Array.from({ length: n }, (_, i) => i),
    map: mesh.material.map || null,
  };
}

/** a real 3D garment, not a flat slab (a model given a cut-out with holes can return a relief of the photo):
 *  its depth is at least a fifth of its width */
export function isVolumetric(src) {
  const P = src.pos, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i + c]); hi[c] = Math.max(hi[c], P[i + c]); }
  return (hi[2] - lo[2]) / Math.max(1e-6, hi[0] - lo[0]) > 0.2;
}

/** simplified to ~`tris` triangles, UVs kept; → { pos, uv, index } compacted */
async function reduce(src, tris) {
  await MeshoptSimplifier.ready;
  const idx = Uint32Array.from(src.index);
  const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, Float32Array.from(src.pos), 3, Float32Array.from(src.uv), 2, [0.5, 0.5], null,
    Math.min(idx.length, tris * 3), 0.02, []);
  const map = new Map(), pos = [], uv = [], index = new Uint32Array(out.length);
  for (let k = 0; k < out.length; k++) {
    const v = out[k];
    if (!map.has(v)) { map.set(v, pos.length / 3); pos.push(src.pos[v * 3], src.pos[v * 3 + 1], src.pos[v * 3 + 2]); uv.push(src.uv[v * 2], src.uv[v * 2 + 1]); }
    index[k] = map.get(v);
  }
  return { pos: Float32Array.from(pos), uv: Float32Array.from(uv), index };
}

/** width (x extent) of points near height y, keeping only the run through x≈cx (not an arm / a sleeve) */
function widthAt(P, n, y, band, cx = 0) {
  const xs = [];
  for (let i = 0; i < n; i++) if (Math.abs(P[i * 3 + 1] - y) < band) xs.push(P[i * 3]);
  if (xs.length < 4) return 0;
  xs.sort((a, b) => a - b);
  // the connected run containing cx (gaps > 3 cm split it)
  let lo = 0, hi = xs.length - 1, k = xs.findIndex((x) => x >= cx);
  if (k < 0) k = xs.length - 1;
  lo = k; hi = k;
  while (lo > 0 && xs[lo] - xs[lo - 1] < 0.03) lo--;
  while (hi < xs.length - 1 && xs[hi + 1] - xs[hi] < 0.03) hi++;
  return xs[hi] - xs[lo];
}

/**
 * @param src  loadGarmentGLB() result
 * @param item { zone: 'upper' | 'lower' | 'full', material?, … }
 */
export async function fitMeshGarment(body, human, item, src, { under = [], tris = 150000, stage = 'all' } = {}) {
  const R = await reduce(src, tris);
  const ctx = posedBody(body, human);
  const { n: nb, reg, Q, N: Nb } = ctx;
  const fab = fabricOf(item.material || item.type, item.category);
  const upper = item.zone !== 'lower';

  /* ---- weld by position: the simulated points ---- */
  const nr = R.pos.length / 3, key = new Map(), simOf = new Int32Array(nr), P0 = [];
  for (let i = 0; i < nr; i++) {
    const k = `${Math.round(R.pos[i * 3] * 2e4)},${Math.round(R.pos[i * 3 + 1] * 2e4)},${Math.round(R.pos[i * 3 + 2] * 2e4)}`;
    if (!key.has(k)) { key.set(k, P0.length / 3); P0.push(R.pos[i * 3], R.pos[i * 3 + 1], R.pos[i * 3 + 2]); }
    simOf[i] = key.get(k);
  }
  const N = P0.length / 3;
  const T = new Uint32Array(R.index.length);
  for (let k = 0; k < T.length; k++) T[k] = simOf[R.index[k]];

  /* ---- place + scale: where and how big it is worn ---- */
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) { y0 = Math.min(y0, P0[i * 3 + 1]); y1 = Math.max(y1, P0[i * 3 + 1]); }
  // a top: its collar is the top of the TORSO column (a sleeve raised in the photo may reach higher); the
  // torso's centre from its lower part (below the sleeves)
  let cx0 = 0;
  if (upper) {
    let sx = 0, sn = 0, xa = Infinity, xb = -Infinity;
    for (let i = 0; i < N; i++) { xa = Math.min(xa, P0[i * 3]); xb = Math.max(xb, P0[i * 3]); }
    for (let i = 0; i < N; i++) if (P0[i * 3 + 1] < y0 + 0.3 * (y1 - y0)) { sx += P0[i * 3]; sn++; }
    cx0 = sn ? sx / sn : 0;
    let yc = -Infinity;
    for (let i = 0; i < N; i++) if (Math.abs(P0[i * 3] - cx0) < 0.12 * (xb - xa)) yc = Math.max(yc, P0[i * 3 + 1]);
    if (Number.isFinite(yc)) y1 = yc;
  }
  const gh = y1 - y0;
  // the garment's width over the torso band (below the sleeves) / at the waist, vs the body's there
  const gBand = upper ? [0.55, 0.8] : [0.03, 0.12];
  let gw = 0, cnt = 0;
  for (let f = gBand[0]; f <= gBand[1]; f += 0.05) { const w = widthAt(P0, N, y1 - f * gh, 0.01 * gh, cx0); if (w) { gw += w; cnt++; } }
  gw /= cnt || 1;
  const topY = upper ? ctx.yNeckSide + 0.01 : ctx.L.waistY + 0.01;
  // first guess of the scale from the body's own width at the same place (then refined once, as the band's
  // height depends on the scale)
  let s = 1;
  for (let it = 0; it < 3; it++) {
    let bw = 0, bc = 0;
    for (let f = gBand[0]; f <= gBand[1]; f += 0.05) {
      const y = topY - f * gh * s, w = widthAt(Q, nb, y, 0.01);
      if (w) { bw += w; bc++; }
    }
    bw /= bc || 1;
    s = (bw * (upper ? 1.12 : 1.06)) / (gw || 1);
  }
  // trousers / skirts with a length measured on the photo (parse.js measuredLowerLength): the hem where the
  // photo shows it (floor: on the floor; ankle: at the ankle …) — more reliable than the waist width
  const REACH = { floor: 1, ankle: 0.93, midi: 0.8, below_knee: 0.68, knee: 0.55, above_knee: 0.4, mini: 0.3, micro: 0.2 };
  // tops: the hem at the length the photo shows (NGL length word), relative to our waist / hips
  const TOPHEM = { cropped: ctx.L.waistY + 0.05, waist: ctx.L.waistY - 0.12, high_hip: ctx.L.waistY - 0.15, hip: ctx.L.hipY - 0.02, thigh: ctx.L.crotchY - 0.08 };
  if (upper && item.zone === 'upper' && TOPHEM[item.length] != null) s = (topY - TOPHEM[item.length]) / gh;
  if (!upper && REACH[item.length] != null) {
    const hemY = item.length === 'floor' ? 0.012 : topY * (1 - REACH[item.length]);
    s = (topY - hemY) / gh;
  }
  // centre: x on the body's midline, z on the body's centre at the garment's band
  let zc = 0, zn = 0;
  const yMid = topY - 0.5 * (gBand[0] + gBand[1]) * gh * s;
  for (let i = 0; i < nb; i++) if (reg[i] === 'torso' && Math.abs(Q[i * 3 + 1] - yMid) < 0.03) { zc += Q[i * 3 + 2]; zn++; }
  zc /= zn || 1;
  let gz = 0, gzn = 0, gx = 0;
  for (let i = 0; i < N; i++) if (Math.abs(P0[i * 3 + 1] - (y1 - 0.5 * (gBand[0] + gBand[1]) * gh)) < 0.03 * gh) { gz += P0[i * 3 + 2]; gx += P0[i * 3]; gzn++; }
  gz /= gzn || 1; gx /= gzn || 1;
  if (upper) gx = cx0;
  const invW = new THREE.Matrix4().copy(human.object.matrixWorld).invert();
  const jpt = (name) => body.bones[body.boneIndex[name]].getWorldPosition(new THREE.Vector3()).applyMatrix4(invW);
  const thickTop = 0.008;
  const X0 = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    X0[i * 3] = (P0[i * 3] - gx) * s;
    X0[i * 3 + 1] = topY + (P0[i * 3 + 1] - y1) * s;
    X0[i * 3 + 2] = zc + (P0[i * 3 + 2] - gz) * s;
  }

  /* ---- shoulders: each side of a top lifted / lowered so its shoulder line sits on ours (the photo's wearer
     may drop a shoulder, or have narrower ones), fading to nothing at the collar and down the body ---- */
  if (item.zone !== 'lower') {
    for (const side of ['l', 'r']) {
      const sg = side === 'l' ? 1 : -1, S = jpt(`upperarm_${side}`);
      const x0 = ctx.xN + 0.02, x1 = Math.abs(S.x) + 0.02;
      let gTop = -Infinity, bTop = -Infinity;
      for (let i = 0; i < N; i++) { const x = sg * X0[i * 3]; if (x > x1 - 0.04 && x < x1 + 0.02 && X0[i * 3 + 1] > S.y - 0.15) gTop = Math.max(gTop, X0[i * 3 + 1]); }
      for (let i = 0; i < nb; i++) { const x = sg * Q[i * 3]; if (x > x1 - 0.04 && x < x1 + 0.02 && reg[i] !== 'head' && reg[i] !== 'neck') bTop = Math.max(bTop, Q[i * 3 + 1]); }
      if (!Number.isFinite(gTop) || !Number.isFinite(bTop)) continue;
      const dy = bTop + thickTop - gTop;
      if (Math.abs(dy) < 0.004) continue;
      for (let i = 0; i < N; i++) {
        const x = sg * X0[i * 3]; if (x < x0) continue;
        const w = smooth(x0, x1 - 0.02, x) * smooth(S.y - 0.35, S.y - 0.1, X0[i * 3 + 1]) + (x > x1 ? smooth(S.y - 0.35, S.y - 0.25, X0[i * 3 + 1]) * 0 : 0);
        X0[i * 3 + 1] += dy * Math.min(1, w);
      }
    }
  }

  /* ---- sleeves onto our arms: each sleeve turned about the shoulder onto our upper arm (the photo's arm pose
     is not ours), fading to nothing at the armhole so the seam stays whole ---- */
  if (item.zone !== 'lower') {
    for (const side of ['l', 'r']) {
      const sg = side === 'l' ? 1 : -1, S = jpt(`upperarm_${side}`), E = jpt(`lowerarm_${side}`);
      const xs = Math.abs(S.x) - 0.03, yLow = S.y - 0.14;
      // sleeve = fabric whose nearest body part is this arm, or that reaches out past the shoulder above it
      const idx = [];
      for (let i = 0; i < N; i++) {
        if (sg * X0[i * 3] < xs - 0.02) continue;
        const q = ctx.nearestSkin(X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2], null, 12);
        if ((q >= 0 && reg[q] === `arm_${side}`) || (sg * X0[i * 3] > xs + 0.06 && X0[i * 3 + 1] > S.y - 0.06)) idx.push(i);
      }
      if (idx.length < 50) continue;
      // the sleeve's direction: from the shoulder to the mean of its far half
      const far = idx.filter((i) => Math.hypot(X0[i * 3] - S.x, X0[i * 3 + 1] - S.y, X0[i * 3 + 2] - S.z) > 0.08);
      if (far.length < 20) continue;
      const a = new THREE.Vector3();
      for (const i of far) a.add(new THREE.Vector3(X0[i * 3] - S.x, X0[i * 3 + 1] - S.y, X0[i * 3 + 2] - S.z));
      a.normalize();
      const b = new THREE.Vector3().subVectors(E, S).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(a, b), qi = new THREE.Quaternion(), v = new THREE.Vector3();
      for (const i of idx) {
        const w = smooth(0.03, 0.1, Math.hypot(X0[i * 3] - S.x, X0[i * 3 + 1] - S.y, X0[i * 3 + 2] - S.z));
        qi.identity().slerp(q, w);
        v.set(X0[i * 3] - S.x, X0[i * 3 + 1] - S.y, X0[i * 3 + 2] - S.z).applyQuaternion(qi);
        X0[i * 3] = S.x + v.x; X0[i * 3 + 1] = S.y + v.y; X0[i * 3 + 2] = S.z + v.z;
      }
    }
  }

  /* ---- trouser legs onto our legs: below the crotch each leg tube is moved (in x, z) to our leg's axis ---- */
  const crotch = ctx.L.crotchY;
  if (stage === 'all' && (Object.values(item).includes('pants') || item.type === 'pants' || item.category === 'pants' || item.category === 'shorts')) {
    const legJ = (side) => ['thigh', 'calf', 'foot'].map((b) => jpt(`${b}_${side}`));
    const legAt = (J, y) => {                                   // our leg's axis at height y
      for (let k = 0; k < J.length - 1; k++) {
        const A = J[k], B = J[k + 1];
        if ((y <= A.y && y >= B.y) || k === J.length - 2) { const t = Math.max(0, Math.min(1, (A.y - y) / ((A.y - B.y) || 1))); return [A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t]; }
      }
      return [J[0].x, J[0].z];
    };
    const JL = legJ('l'), JR = legJ('r');
    // the garment's leg centres per 2 cm slice → offsets to our leg's axis, smoothed over ±8 cm (no shear)
    const slice = new Map();
    for (let i = 0; i < N; i++) {
      const y = X0[i * 3 + 1]; if (y > crotch) continue;
      const k = `${X0[i * 3] > 0 ? 'l' : 'r'}${Math.round(y / 0.02)}`, e = slice.get(k) || [0, 0, 0];
      e[0] += X0[i * 3]; e[1] += X0[i * 3 + 2]; e[2]++; slice.set(k, e);
    }
    const off = new Map();
    for (const [k, e] of slice) {
      const side = k[0], yk = +k.slice(1) * 0.02, [lx, lz] = legAt(side === 'l' ? JL : JR, yk);
      off.set(k, [lx - e[0] / e[2], lz - e[1] / e[2]]);
    }
    const offAt = (side, y) => {
      let x = 0, z = 0, w = 0;
      const c = Math.round(Math.min(y, crotch) / 0.02);
      for (let d = -4; d <= 4; d++) { const o = off.get(`${side}${c + d}`); if (o) { x += o[0]; z += o[1]; w++; } }
      return w ? [x / w, z / w] : [0, 0];
    };
    for (let i = 0; i < N; i++) {
      const y = X0[i * 3 + 1]; if (y > crotch + 0.06) continue;
      const side = X0[i * 3] > 0 ? 'l' : 'r', [ox, oz] = offAt(side, y), w = smooth(crotch + 0.06, crotch - 0.1, y);
      X0[i * 3] += ox * w; X0[i * 3 + 2] += oz * w;
    }
  }

  /* ---- fit: the generated shape kept (its folds, pockets, collar), only pushed off the body ---------------
     Every point inside the body (or closer than the fabric's thickness) is pushed out along the skin normal;
     that push is spread smoothly over the garment surface (so the fabric moves as a whole, no dents), and
     repeated until nothing is inside. A skirt's / trousers' waist is drawn in onto the waist (it's worn
     there, not hanging off it). */
  const X = Float32Array.from(X0);
  const Xp = Float32Array.from(X0);                // as placed
  const nbr = Array.from({ length: N }, () => []);
  for (let t = 0; t < T.length; t += 3) for (let q = 0; q < 3; q++) {
    const a = T[t + q], b = T[t + ((q + 1) % 3)];
    if (a !== b) { nbr[a].push(b); nbr[b].push(a); }
  }
  const thick = 0.005 + (under.length ? 0.003 : 0) + fab.thick;
  const skip = upper ? (j) => reg[j] === 'head' || /leg|foot/.test(reg[j]) : (j) => /arm|hand|head/.test(reg[j]) || reg[j] === 'torso' && Q[j * 3 + 1] > ctx.L.waistY + 0.08;
  const underPts = under.map((u) => u.pts), underNrm = under.map((u) => u.nrm);
  const nc = nb + underPts.reduce((a, u) => a + u.length / 3, 0);
  const CP = new Float32Array(nc * 3), CN = new Float32Array(nc * 3);
  CP.set(Q); CN.set(Nb);
  { let o = nb * 3; underPts.forEach((u, k) => { CP.set(u, o); CN.set(underNrm[k], o); o += u.length; }); }
  for (let i = 0; i < nb; i++) if (skip(i)) CP[i * 3 + 1] = 1e3;         // not part of this garment's collider
  // each skin point's closest point on its bone: the body starts shrunk onto its bones (inside the garment
  // wherever the garment is — a generated top can be shallower than our chest) and grows back to full size
  const jw = body.bones.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(invW));
  const childOf = body.bones.map((b) => body.bones.indexOf(b.children.find((c) => c.isBone)));
  const axis = new Float32Array(nb * 3);
  for (let i = 0; i < nb; i++) {
    let best = 0, bw = -1;
    for (const [b, w] of ctx.WL[i]) if (w > bw) { bw = w; best = b; }
    const A = jw[best], c = childOf[best], B = c >= 0 ? jw[c] : A;
    const ex = B.x - A.x, ey = B.y - A.y, ez = B.z - A.z, l2 = ex * ex + ey * ey + ez * ez;
    const t = l2 > 1e-8 ? Math.max(0, Math.min(1, ((Q[i * 3] - A.x) * ex + (Q[i * 3 + 1] - A.y) * ey + (Q[i * 3 + 2] - A.z) * ez) / l2)) : 0;
    axis[i * 3] = A.x + ex * t; axis[i * 3 + 1] = A.y + ey * t; axis[i * 3 + 2] = A.z + ez * t;
  }
  const GROW = upper ? 16 : 0;
  let col = makeCollider(CP, CN, 0.04);
  let top = -Infinity; for (let i = 0; i < N; i++) top = Math.max(top, X[i * 3 + 1]);
  const D = new Float32Array(N * 3), fixed = new Uint8Array(N), tmp = new Float32Array(N * 3);
  for (let it = 0; it < (stage === 'all' ? 30 + GROW : 0); it++) {
    if (GROW && it <= GROW) {
      const f = 0.45 + 0.55 * smooth(0, GROW, it);
      for (let i = 0; i < nb; i++) if (CP[i * 3 + 1] < 900 && reg[i] === 'torso') for (let c = 0; c < 3; c++) CP[i * 3 + c] = axis[i * 3 + c] + (Q[i * 3 + c] - axis[i * 3 + c]) * f;
      col = makeCollider(CP, CN, 0.04);
    }
    D.fill(0); fixed.fill(0);
    let inside = 0;
    for (let i = 0; i < N; i++) {
      const c = col.nearest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
      if (c < 0) continue;
      const dx = X[i * 3] - CP[c * 3], dy = X[i * 3 + 1] - CP[c * 3 + 1], dz = X[i * 3 + 2] - CP[c * 3 + 2];
      const d = dx * CN[c * 3] + dy * CN[c * 3 + 1] + dz * CN[c * 3 + 2];
      // trousers / skirts sit on the hips: from the waistband (snug) down over the hips (a little ease, more
      // further down), nothing hangs off them — below that, the garment's own cut
      const below = top - X[i * 3 + 1], waist = !upper && below < 0.2 && c < nb;
      const ease = waist ? 0.003 + 0.035 * smooth(0.03, 0.2, below) : 0;
      if (d < thick || (waist && d > thick + ease + 0.002)) {
        const k = (waist && d > thick ? thick + ease : thick) - d;
        D[i * 3] = CN[c * 3] * k; D[i * 3 + 1] = CN[c * 3 + 1] * k; D[i * 3 + 2] = CN[c * 3 + 2] * k;
        fixed[i] = 1; if (d < 0) inside++;
      }
    }
    if (!inside && it > 4 + GROW && it % 4 !== 0) break;
    // spread the pushes through space (a 2.5 cm grid, blurred): everything near a pushed point — the other
    // layer of the fabric, the fold beside it — moves with it, so the garment moves as a whole
    const G = 0.025, gx0 = -1.5, gy0 = -0.2, gz0 = -1.5, NX = 120, NY = 100, NZ = 120;
    const acc = new Float32Array(NX * NY * NZ * 4);
    const cell = (x, y, z) => { const i = Math.floor((x - gx0) / G), j = Math.floor((y - gy0) / G), k = Math.floor((z - gz0) / G); return i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? -1 : (k * NY + j) * NX + i; };
    for (let i = 0; i < N; i++) if (fixed[i]) {
      const c = cell(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); if (c < 0) continue;
      acc[c * 4] += D[i * 3]; acc[c * 4 + 1] += D[i * 3 + 1]; acc[c * 4 + 2] += D[i * 3 + 2]; acc[c * 4 + 3]++;
    }
    for (let pass = 0; pass < 2; pass++) for (const [sx, sy, sz] of [[1, 0, 0], [0, NX, 0], [0, 0, NX * NY]]) {
      const st = sx + sy + sz, src = acc.slice();
      for (let c = st; c < NX * NY * NZ - st; c++) for (let q = 0; q < 4; q++) acc[c * 4 + q] = (src[(c - st) * 4 + q] + src[c * 4 + q] + src[(c + st) * 4 + q]);
    }
    for (let i = 0; i < N; i++) {
      const c = cell(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); if (c < 0 || !acc[c * 4 + 3]) { if (!fixed[i]) D[i * 3] = D[i * 3 + 1] = D[i * 3 + 2] = 0; continue; }
      const w = acc[c * 4 + 3];
      const bx = acc[c * 4] / w, by = acc[c * 4 + 1] / w, bz = acc[c * 4 + 2] / w;
      if (fixed[i]) continue;                    // a point that must move keeps its own push
      D[i * 3] = bx; D[i * 3 + 1] = by; D[i * 3 + 2] = bz;
    }
    for (let i = 0; i < N * 3; i++) X[i] += D[i];
    // the total move so far, smoothed over the surface: the garment's own shape carried along, not dented
    if (it % 4 === 3) {
      const U = new Float32Array(N * 3);
      for (let i = 0; i < N * 3; i++) U[i] = X[i] - Xp[i];
      for (let sm = 0; sm < 20; sm++) {
        for (let i = 0; i < N; i++) {
          const l = nbr[i].length; if (!l) { tmp[i * 3] = U[i * 3]; tmp[i * 3 + 1] = U[i * 3 + 1]; tmp[i * 3 + 2] = U[i * 3 + 2]; continue; }
          let x = 0, y = 0, z = 0; for (const j of nbr[i]) { x += U[j * 3]; y += U[j * 3 + 1]; z += U[j * 3 + 2]; }
          tmp[i * 3] = 0.5 * U[i * 3] + 0.5 * x / l; tmp[i * 3 + 1] = 0.5 * U[i * 3 + 1] + 0.5 * y / l; tmp[i * 3 + 2] = 0.5 * U[i * 3 + 2] + 0.5 * z / l;
        }
        U.set(tmp);
      }
      for (let i = 0; i < N * 3; i++) X[i] = Xp[i] + U[i];
    }
  }

  /* ---- render vertices (UV seams kept), skin weights, hidden skin ---- */
  const posed = new Float32Array(nr * 3), verts = [], weights = [];
  const wOf = new Array(N);
  for (let i = 0; i < N; i++) {
    const q = ctx.nearestSkin(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], (j) => reg[j] !== 'head' && reg[j] !== 'hand', 6);
    wOf[i] = { src: q, w: q >= 0 ? ctx.WL[q] : [[body.boneIndex.pelvis, 1]] };
  }
  for (let v = 0; v < nr; v++) {
    const i = simOf[v];
    posed[v * 3] = X[i * 3]; posed[v * 3 + 1] = X[i * 3 + 1]; posed[v * 3 + 2] = X[i * 3 + 2];
    verts.push({ uv: [R.uv[v * 2], R.uv[v * 2 + 1]], src: wOf[i].src });
    weights.push(wOf[i].w);
  }
  const cg = makeCollider(X, new Float32Array(X.length), 0.035);
  const hide = new Set();
  for (let i = 0; i < nb; i++) {
    if (ctx.part[i] !== 0 || reg[i] === 'head' || reg[i] === 'hand') continue;
    const c = cg.nearest(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]);
    if (c < 0) continue;
    const dx = X[c * 3] - Q[i * 3], dy = X[c * 3 + 1] - Q[i * 3 + 1], dz = X[c * 3 + 2] - Q[i * 3 + 2];
    const dn = dx * Nb[i * 3] + dy * Nb[i * 3 + 1] + dz * Nb[i * 3 + 2];
    if (dn > -0.003 && dn < 0.045 && dx * dx + dy * dy + dz * dz - dn * dn < 0.02 * 0.02) hide.add(i);
  }
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true;
  let map = src.map;
  if (!map) { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 4, 4); map = new THREE.CanvasTexture(c); }
  map.flipY = false;
  const atlas = { map, normalMap: flat, W: 1, H: 1, front: { h: 1 } };
  const res = finish(ctx, item, atlas, { verts, idx: Array.from(R.index), posed, weights, hide, covered: (i) => hide.has(i), s: gh * s, thickness: 0.0005, cutout: false });
  res.state = { x: Float32Array.from(X) };
  res.debug = { N, tris: R.index.length / 3, scale: s };
  // its surface as fitted (display pose) + texture: for sew.js to take the look and relief from
  // its local relief: how far each point stands off its own smoothed surface along the normal (a pocket,
  // a flap, a fold, a collar's roll: + out, − in) — size-independent detail another garment can take on
  const Xs = Float32Array.from(X), tmp2 = new Float32Array(N * 3);
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < N; i++) {
      const l = nbr[i].length; if (!l) { for (let c = 0; c < 3; c++) tmp2[i * 3 + c] = Xs[i * 3 + c]; continue; }
      for (let c = 0; c < 3; c++) { let a = 0; for (const j of nbr[i]) a += Xs[j * 3 + c]; tmp2[i * 3 + c] = 0.5 * Xs[i * 3 + c] + 0.5 * a / l; }
    }
    Xs.set(tmp2);
  }
  const VN = new Float32Array(N * 3);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const ux = Xs[b] - Xs[a], uy = Xs[b + 1] - Xs[a + 1], uz = Xs[b + 2] - Xs[a + 2], vx = Xs[c] - Xs[a], vy = Xs[c + 1] - Xs[a + 1], vz = Xs[c + 2] - Xs[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { VN[v] += nx; VN[v + 1] += ny; VN[v + 2] += nz; }
  }
  const h = new Float32Array(nr);
  for (let v = 0; v < nr; v++) {
    const i = simOf[v], l = Math.hypot(VN[i * 3], VN[i * 3 + 1], VN[i * 3 + 2]) || 1;
    let d = 0; for (let c = 0; c < 3; c++) d += (X[i * 3 + c] - Xs[i * 3 + c]) * VN[i * 3 + c] / l;
    h[v] = d;
  }
  res.detail = { pts: Float32Array.from(posed), uv: R.uv, image: src.map ? src.map.image : null, h };
  return res;
}
