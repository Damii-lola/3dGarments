/**
 * Garment wrapping — turns a flat cut-out + its silhouette measurements into a
 * thin 3D shell draped on the body model.
 *
 * Garment space (from silhouette.js): unit = texture height, x ∈ [0, aspect], y ∈ [0,1] DOWN.
 * World space: metres, y up, body faces +z, image-left → world −x.
 *
 * Regions:
 *   shell  – torso/skirt/hips: row half-width maps onto the front half of an ellipse
 *            around the body (inflated when the garment is wider than the body).
 *   sleeve – pixels outside the torso edges map onto a tube around each arm,
 *            using the measured sleeve axis (so any flat-lay sleeve angle works).
 *   leg    – below the crotch each trouser leg maps onto a tube around each leg.
 * The back half is the same surface mirrored through the body (z → −z).
 */
import * as THREE from 'three';
import { WRAP_MODE, LAYER } from '@shared/silhouette.js';
import { ellipsePerimeter } from './body.js';

const EASE = { top: 1.1, outerwear: 1.2, dress: 1.06, skirt: 1.04, pants: 1.03, shorts: 1.05 };
const FIT_EASE = { tight: 0.95, regular: 1, loose: 1.1, oversized: 1.22 };
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

function fillNearest(arr) {
  const out = arr.slice();
  let last = NaN;
  for (let i = 0; i < out.length; i++) { if (Number.isFinite(out[i])) last = out[i]; else out[i] = last; }
  last = NaN;
  for (let i = out.length - 1; i >= 0; i--) { if (Number.isFinite(arr[i])) last = arr[i]; else if (!Number.isFinite(out[i])) out[i] = last; }
  return out;
}

function rowTable(g) {
  const rows = g.rows, n = rows.length;
  const y0 = rows[0].y, y1 = rows[n - 1].y;
  const col = (fn) => fillNearest(rows.map(fn));
  const tl = col((r) => (r.t ? r.t[0] : NaN));
  const tr = col((r) => (r.t ? r.t[1] : NaN));
  const hasLegs = rows.some((r) => r.legs);
  const lg = hasLegs ? [0, 1, 2, 3].map((q) => col((r) => (r.legs ? r.legs[q >> 1][q & 1] : NaN))) : null;
  const at = (arr, y) => {
    const f = clamp(((y - y0) / (y1 - y0 || 1)) * (n - 1), 0, n - 1);
    const i = Math.floor(f), j = Math.min(n - 1, i + 1), t = f - i;
    return arr[i] + (arr[j] - arr[i]) * t;
  };
  const fallbackW = g.aspect;
  return {
    torso: (y) => {
      const l = at(tl, y), r = at(tr, y);
      return Number.isFinite(l) && Number.isFinite(r) ? [l, r] : [0, fallbackW];
    },
    legs: hasLegs ? (y) => [[at(lg[0], y), at(lg[1], y)], [at(lg[2], y), at(lg[3], y)]] : null,
  };
}

/** Bilinear alpha lookup on a small grid. u ∈ [0,1] left→right, v ∈ [0,1] top→bottom. */
export function makeAlphaSampler(alpha, w, h) {
  return (u, v) => {
    const x = clamp(u * (w - 1), 0, w - 1), y = clamp(v * (h - 1), 0, h - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const a = alpha[y0 * w + x0] * (1 - tx) + alpha[y0 * w + x1] * tx;
    const b = alpha[y1 * w + x0] * (1 - tx) + alpha[y1 * w + x1] * tx;
    return (a * (1 - ty) + b * ty) / 255;
  };
}

export function buildGarmentMesh({ garment, texture, alphaAt, body, layer = 0 }) {
  const g = garment.geometry;
  const category = garment.category || g.guess || 'top';
  let mode = WRAP_MODE[category] || 'upper';
  const fit = { size: 1, lift: 0, ...(garment.fit || {}) };
  const aiFit = garment.analysis?.fit;
  const ext = Math.max(0.05, g.bottom - g.top);
  const table = rowTable(g);
  const H = body.H;

  // legs requested but the photo has no visible split → synthesise one
  let crotchY = g.crotch;
  let legsAt = table.legs;
  if (mode === 'legs' && (!legsAt || crotchY == null)) {
    crotchY = g.top + ext * 0.32;
    legsAt = (y) => { const [l, r] = table.torso(y); return [[l, g.centerX], [g.centerX, r]]; };
  }
  const sleeves = mode === 'upper' || mode === 'full' ? g.sleeves || {} : {};

  /* ---------- scale + anchor ---------- */
  const halfW = (y) => { const [l, r] = table.torso(y); return (r - l) / 2; };
  const sampleHalf = (a, b) => {
    const out = [];
    for (let i = 0; i <= 24; i++) out.push(halfW(a + ((b - a) * i) / 24));
    return median(out);
  };
  let hwRef, qBody, yTop;
  const ease = (EASE[category] || 1.08) * (FIT_EASE[aiFit] || 1) * clamp(fit.size, 0.6, 1.8);
  if (mode === 'upper' || mode === 'full') {
    const a = (g.armpit ?? g.top + ext * 0.18) + ext * 0.04;
    const b = mode === 'full' ? Math.min(g.bottom - ext * 0.05, a + ext * 0.18) : g.bottom - ext * 0.06;
    hwRef = sampleHalf(a, Math.max(a + 0.01, b));
    qBody = body.quarterArc(mode === 'full' ? body.L.waist * 0.4 + body.L.chest * 0.6 : (body.L.chest + body.L.waist) / 2);
    yTop = body.L.neckBase + 0.004 * body.k;
  } else {
    hwRef = sampleHalf(g.top + ext * 0.01, g.top + ext * 0.08);
    const yWaistband = mode === 'skirt' ? 0.615 * H : 0.585 * H;
    qBody = body.quarterArc(yWaistband);
    yTop = yWaistband + 0.012 * body.k;
  }
  const s = (qBody * ease) / Math.max(1e-3, hwRef); // metres per garment unit
  yTop += clamp(fit.lift, -0.3, 0.3);

  const clear = 0.006 + layer * 0.0075;
  const floorY = 0.035 * H;
  const pivotY = mode === 'legs' ? crotchY : clamp(g.top + (yTop - body.L.hip) / s, g.top, g.bottom);
  const pivot3 = yTop - (pivotY - g.top) * s;
  const tail = (g.bottom - pivotY) * s;
  const compress = tail > 0 && pivot3 - tail < floorY ? Math.max(0.2, (pivot3 - floorY) / tail) : 1;
  const y3 = (Y) => (Y <= pivotY ? yTop - (Y - g.top) * s : pivot3 - (Y - pivotY) * s * compress);

  /* ---------- region mappings ---------- */
  const tmp = { x: 0, y: 0, z: 0, bz: 0 };

  function shell(X, Y) {
    const [l, r] = table.torso(Y);
    const c = (l + r) / 2, hw = Math.max((r - l) / 2, 1e-3);
    const th = clamp(((X - c) / hw) * (PI / 2), -0.8 * PI, 0.8 * PI);
    const yy = y3(Y);
    const { rx, rz } = body.shellRadii(yy);
    const f = clamp((hw * s) / (ellipsePerimeter(rx, rz) / 4), 1, 3.2);
    const Rx = rx * f + clear, Rz = rz * f + clear;
    tmp.x = Rx * Math.sin(th); tmp.y = yy; tmp.z = Rz * Math.cos(th); tmp.bz = -tmp.z;
    return tmp;
  }

  const J = [body.arm.joint(-1), body.arm.joint(1)];
  const A = [body.arm.dir(-1), body.arm.dir(1)];
  function sleeve(X, Y, side) {
    const sl = side < 0 ? sleeves.left : sleeves.right;
    const i = side < 0 ? 0 : 1;
    const dx = sl.dir[0], dy = sl.dir[1];
    const px = X - sl.root[0], py = Y - sl.root[1];
    const along = px * dx + py * dy;
    const perp = px * -dy + py * dx - sl.offset;
    const hs = sl.width / 2;
    const phi = clamp((perp / hs) * (PI / 2), -0.8 * PI, 0.8 * PI);
    const am = Math.max(-0.03, along * s);
    // set-in sleeve: snug at the shoulder cap, opening up to its flat width further down the arm
    const rFull = (hs * s * 2) / PI;
    const r = Math.max(body.arm.radius(am) * 1.12 + clear, rFull * (0.5 + 0.5 * smooth(am / (0.11 * body.k))));
    const a = A[i], j = J[i];
    const cx = j.x + a.x * am, cy = j.y + a.y * am, cz = j.z;
    const sp = r * Math.sin(phi), cp = r * Math.cos(phi);
    tmp.x = cx + a.y * sp; tmp.y = cy - a.x * sp; tmp.z = cz + cp; tmp.bz = cz - cp;
    return tmp;
  }

  function leg(X, Y, side, legY) {
    const L = legsAt(legY);
    const [l, r] = L[side < 0 ? 0 : 1];
    const c = (l + r) / 2, hw = Math.max((r - l) / 2, 1e-3);
    const th = clamp(((X - c) / hw) * (PI / 2), -0.8 * PI, 0.8 * PI);
    const yy = y3(Y);
    const ly = Math.min(yy, body.legTop);
    const lr = Math.max(body.legRadius(ly) * 1.07 + clear, (hw * s * 2) / PI);
    const cx = side * body.legCenterX(ly);
    tmp.x = cx + lr * Math.sin(th); tmp.y = yy; tmp.z = lr * Math.cos(th); tmp.bz = -tmp.z;
    return tmp;
  }

  const band = ext * 0.06;
  function place(X, Y) {
    if (mode === 'legs' && Y > crotchY - band) {
      const side = X < g.centerX ? -1 : 1;
      if (Y >= crotchY) return { p: leg(X, Y, side, Y), region: side < 0 ? 3 : 4 };
      const t = smooth((Y - (crotchY - band)) / band);
      const a = { ...shell(X, Y) };
      const b = leg(X, Y, side, crotchY);
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, bz: a.bz + (b.bz - a.bz) * t }, region: 0 };
    }
    if (sleeves.left || sleeves.right) {
      const [l, r] = table.torso(Y);
      const m = 0.002;
      const beyondRoot = (sl) => (X - sl.root[0]) * sl.dir[0] + (Y - sl.root[1]) * sl.dir[1] > 0;
      if (X < l - m && sleeves.left && beyondRoot(sleeves.left)) return { p: sleeve(X, Y, -1), region: 1 };
      if (X > r + m && sleeves.right && beyondRoot(sleeves.right)) return { p: sleeve(X, Y, 1), region: 2 };
    }
    return { p: shell(X, Y), region: 0 };
  }

  /* ---------- grid ---------- */
  const aspect = g.aspect;
  const nx = 120;
  const ny = clamp(Math.round(nx / aspect), 64, 240);
  const W = nx + 1, V = W * (ny + 1);
  const pos = new Float32Array(V * 2 * 3);
  const uv = new Float32Array(V * 2 * 2);
  const colr = new Float32Array(V * 2 * 3);
  const region = new Uint8Array(V);
  const alpha = new Float32Array(V);

  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny, k = j * W + i;
    const { p, region: rg } = place(u * aspect, v);
    region[k] = rg;
    alpha[k] = alphaAt(u, v);
    pos.set([p.x, p.y, p.z], k * 3);
    pos.set([p.x, p.y, p.bz], (V + k) * 3);
    uv.set([u, 1 - v], k * 2);
    uv.set([u, 1 - v], (V + k) * 2);
    colr.set([1, 1, 1], k * 3);
    colr.set([0.9, 0.9, 0.9], (V + k) * 3);
  }

  /* ---------- shoulder drape: let the top edge settle onto the shoulder line ---------- */
  if (mode === 'upper' || mode === 'full') {
    const yFade = g.armpit ?? g.top + ext * 0.25;
    const delta = new Float32Array(W);
    const edgeV = new Float32Array(W);
    for (let i = 0; i <= nx; i++) {
      let j = 0;
      while (j < ny && alpha[j * W + i] < 0.5) j++;
      const k = j * W + i;
      edgeV[i] = j / ny;
      if (j >= ny || region[k] !== 0 || edgeV[i] >= yFade) continue;
      const support = body.supportY(pos[k * 3]) + clear + 0.004;
      delta[i] = Math.max(0, pos[k * 3 + 1] - support);
    }
    const sm = new Float32Array(W);
    for (let i = 0; i <= nx; i++) {
      let s2 = 0, c = 0;
      for (let d = -4; d <= 4; d++) { const q = i + d; if (q >= 0 && q <= nx) { s2 += delta[q]; c++; } }
      sm[i] = s2 / c;
    }
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = j * W + i, v = j / ny;
      if (region[k] !== 0 || !sm[i] || v >= yFade) continue;
      const t = 1 - smooth((v - edgeV[i]) / Math.max(1e-3, yFade - edgeV[i]));
      const dy = sm[i] * t;
      pos[k * 3 + 1] -= dy;
      pos[(V + k) * 3 + 1] -= dy;
    }
  }

  const cell = (s * aspect) / nx;
  const maxEdge = cell * 9;
  const d2 = (a, b) => {
    const x = pos[a * 3] - pos[b * 3], y = pos[a * 3 + 1] - pos[b * 3 + 1], z = pos[a * 3 + 2] - pos[b * 3 + 2];
    return x * x + y * y + z * z;
  };
  const idx = [], bidx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    const cu = (i + 0.5) / nx, cv = (j + 0.5) / ny;
    if (Math.max(alpha[a], alpha[b], alpha[c], alpha[d], alphaAt(cu, cv)) < 0.03) continue;
    const rs = new Set([region[a], region[b], region[c], region[d]]);
    if (rs.has(3) && rs.has(4)) continue;
    if (rs.has(1) && rs.has(2)) continue;
    const m2 = maxEdge * maxEdge;
    if (d2(a, b) > m2 || d2(a, c) > m2 || d2(b, d) > m2 || d2(c, d) > m2) continue;
    idx.push(a, c, b, b, c, d); // front, CCW from +z
    bidx.push(V + a, V + b, V + c, V + b, V + d, V + c); // back, CCW from −z
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setIndex([...idx, ...bidx]);
  geo.addGroup(0, idx.length, 0);
  geo.addGroup(idx.length, bidx.length, 1);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const makeMat = (map) => {
    const m = new THREE.MeshStandardMaterial({
      map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5,
      roughness: 0.9, metalness: 0, envMapIntensity: 0.75,
    });
    m.onBeforeCompile = (shader) => {
      // darken the inside of the garment (visible through necklines, hems, sleeves)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.42;',
      );
    };
    return m;
  };
  const mesh = new THREE.Mesh(geo, [makeMat(texture.front), makeMat(texture.back)]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texture.back, alphaTest: 0.5 });
  mesh.renderOrder = 1 + layer;
  mesh.name = `garment:${garment.id}`;
  mesh.userData = { garmentId: garment.id, mode, scale: s, ease, regions: region, V, grid: [nx, ny], triangles: (idx.length + bidx.length) / 3 };
  return mesh;
}

export const layerOf = (category) => LAYER[category] ?? 1;
