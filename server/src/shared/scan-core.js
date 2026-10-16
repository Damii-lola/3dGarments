/**
 * Garment scan core: photo(s) of a garment + a template -> the template's texture atlas.
 * Pure typed arrays (no canvas, no DOM): runs in the API server and in the browser.
 *
 *  1. The template's silhouette, seen from the front, is split into PARTS: the torso (front + back panels) and each sleeve.
 *  2. Each photo comes with a garment mask (from the AI cut-out). The torso is registered to the photo by maximising the
 *     overlap (IoU) of the template's silhouette with the mask (scale x/y, shift, small rotation); then every sleeve is
 *     registered on its own (shift, rotation about its root, scale).
 *  3. Every texel of the UV atlas is mapped to its 3D point on the template, then PERSPECTIVE-PROJECTED through an
 *     estimated camera into the photo. Only front-facing surfaces are sampled from each photo; the back photo (mirrored)
 *     covers back-facing surfaces. Shading is removed (albedo extraction) so the texture is flat colour, not baked-in light.
 *  4. Only solid garment pixels are sampled (the matte's soft edge borrows the nearest solid colour); islands are padded.
 */

const GRID_H = 256;                       // working height of the registration grids
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ vector math */

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/** lookAt camera: eye -> target, up vector. Returns {x, y, z, eye} basis in world space. */
function lookAt(eye, target, up) {
  const z = normalize(sub(target, eye));   // forward (camera looks down this)
  const x = normalize(cross(up, z));       // camera right
  const y = cross(z, x);                   // camera up
  return { x, y, z, eye };
}

/** Perspective-project a 3D point into 2D photo pixels. Returns {u, v, zc} or null if behind camera. */
function projectPoint(p, cam, fx, fy, cx, cy) {
  const rel = sub(p, cam.eye);
  const xc = dot(cam.x, rel);
  const yc = dot(cam.y, rel);
  const zc = dot(cam.z, rel);
  if (zc <= 0.001) return null;
  return { u: fx * xc / zc + cx, v: fy * yc / zc + cy, zc };
}

/* ------------------------------------------------------------------ template */

/** connected pieces of the template and what each is: 'front' | 'back' | 'sleeve' (+ side: sign of its mean x) */
export function templateParts(T) {
  const n = T.pos.length / 3, par = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < T.index.length; t += 3) { par[find(T.index[t + 1])] = find(T.index[t]); par[find(T.index[t + 2])] = find(T.index[t]); }
  const ids = new Map(), piece = new Uint16Array(n);
  for (let i = 0; i < n; i++) { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); piece[i] = ids.get(r); }
  const k = ids.size, mx = new Float64Array(k), mz = new Float64Array(k), c = new Float64Array(k);
  let maxAbsX = 0;
  for (let i = 0; i < n; i++) { mx[piece[i]] += T.pos[i * 3]; mz[piece[i]] += T.nrm[i * 3 + 2]; c[piece[i]]++; maxAbsX = Math.max(maxAbsX, Math.abs(T.pos[i * 3])); }
  const kind = [], side = [];
  for (let p = 0; p < k; p++) {
    const x = mx[p] / c[p], nz = mz[p] / c[p];
    if (Math.abs(x) > 0.5 * maxAbsX) { kind.push('sleeve'); side.push(x > 0 ? 1 : -1); }
    else { kind.push(nz >= 0 ? 'front' : 'back'); side.push(0); }
  }
  return { piece, kind, side };
}

const BIT_TORSO = 1, BIT_SLEEVE_POS = 2, BIT_SLEEVE_NEG = 4;

/** the template's front-view silhouette rasterised per part into a bit grid (mirror = seen from behind) */
function templateGrid(T, parts, mirror) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const X = (i) => (mirror ? -T.pos[i * 3] : T.pos[i * 3]);
  for (let i = 0; i < T.pos.length / 3; i++) { x0 = Math.min(x0, X(i)); x1 = Math.max(x1, X(i)); y0 = Math.min(y0, T.pos[i * 3 + 1]); y1 = Math.max(y1, T.pos[i * 3 + 1]); }
  const sc = GRID_H / (y1 - y0), W = Math.ceil((x1 - x0) * sc) + 1, H = GRID_H + 1;
  const bits = new Uint8Array(W * H);
  for (let t = 0; t < T.index.length; t += 3) {
    const ia = T.index[t], ib = T.index[t + 1], ic = T.index[t + 2], pc = parts.piece[ia];
    let bit = BIT_TORSO;
    if (parts.kind[pc] === 'sleeve') bit = (mirror ? -parts.side[pc] : parts.side[pc]) > 0 ? BIT_SLEEVE_POS : BIT_SLEEVE_NEG;
    const ax = (X(ia) - x0) * sc, ay = (y1 - T.pos[ia * 3 + 1]) * sc, bx = (X(ib) - x0) * sc, by = (y1 - T.pos[ib * 3 + 1]) * sc, cx = (X(ic) - x0) * sc, cy = (y1 - T.pos[ic * 3 + 1]) * sc;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5, py = y + 0.5, w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
        if (w1 >= -0.03 && w2 >= -0.03 && 1 - w1 - w2 >= -0.03) bits[y * W + x] |= bit;
      }
  }
  return { W, H, sc, x0, y1, bits };
}

/* ------------------------------------------------------------------ photo */

/** a photo prepared for scanning: mask grid, solid-pixel mask, fabric colour */
export function preparePhoto({ rgba, width: w, height: h, mask, alpha }) {
  let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 <= bx0 || by1 <= by0) throw new Error('no garment found in the photo');
  bx1++; by1++;
  const s = GRID_H / (by1 - by0), Wg = Math.ceil((bx1 - bx0) * s) + 1, Hg = GRID_H + 1, Mg = new Uint8Array(Wg * Hg);
  for (let y = 0; y < Hg; y++) for (let x = 0; x < Wg; x++) {
    const px = Math.min(w - 1, Math.floor(bx0 + (x + 0.5) / s)), py = Math.min(h - 1, Math.floor(by0 + (y + 0.5) / s));
    Mg[y * Wg + x] = mask[py * w + px];
  }
  let solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = (alpha ? alpha[i] >= 235 : mask[i]) ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    const nx = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; nx[i] = solid[i] && solid[i - 1] && solid[i + 1] && solid[i - w] && solid[i + w] ? 1 : 0; }
    solid = nx;
  }
  const near = new Int32Array(w * h).fill(-1), nd = new Float32Array(w * h).fill(Infinity);
  for (let i = 0; i < w * h; i++) if (solid[i]) { near[i] = i; nd[i] = 0; }
  const relax = (i, j, x, y) => {
    const s0 = near[j]; if (s0 < 0) return;
    const sx = s0 % w, sy = (s0 / w) | 0, d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
    if (d < nd[i]) { nd[i] = d; near[i] = s0; }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) relax(i, i - 1, x, y); if (y > 0) { relax(i, i - w, x, y); if (x > 0) relax(i, i - w - 1, x, y); if (x < w - 1) relax(i, i - w + 1, x, y); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) relax(i, i + 1, x, y); if (y < h - 1) { relax(i, i + w, x, y); if (x < w - 1) relax(i, i + w + 1, x, y); if (x > 0) relax(i, i + w - 1, x, y); }
  }
  const ch = [[], [], []], cx0 = bx0 + (bx1 - bx0) * 0.3, cx1 = bx1 - (bx1 - bx0) * 0.3, cy0 = by0 + (by1 - by0) * 0.35, cy1 = by1 - (by1 - by0) * 0.1;
  for (let y = Math.floor(cy0); y < cy1; y += 3) for (let x = Math.floor(cx0); x < cx1; x += 3) if (solid[y * w + x]) for (let c = 0; c < 3; c++) ch[c].push(rgba[(y * w + x) * 4 + c]);
  const med = (a) => { if (!a.length) return 200; a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return { rgba, w, h, mask, solid, near, nd, reach2: Math.pow(Math.max(w, h) * 0.06, 2), bx0, by0, bx1, by1, s, Wg, Hg, Mg, fabric: [med(ch[0]), med(ch[1]), med(ch[2])] };
}

/** colour at photo pixel (x, y): the nearest solid garment pixel, as long as it is close (a few % of the photo); else false */
function sample(P, x, y, out) {
  const xi = clamp(Math.round(x), 0, P.w - 1), yi = clamp(Math.round(y), 0, P.h - 1), i = yi * P.w + xi;
  const off = (x < -3 || y < -3 || x > P.w + 2 || y > P.h + 2);
  const s0 = P.near[i];
  if (off || s0 < 0 || P.nd[i] > P.reach2) return false;
  const o = s0 * 4; out[0] = P.rgba[o]; out[1] = P.rgba[o + 1]; out[2] = P.rgba[o + 2];
  return true;
}

/* ------------------------------------------------------------------ registration */

/** affine as [a, b, e, c, d, f]: x' = a x + b y + e ; y' = c x + d y + f */
const apply = (A, x, y, o) => { o[0] = A[0] * x + A[1] * y + A[2]; o[1] = A[3] * x + A[4] * y + A[5]; };
function invert(A) {
  const det = A[0] * A[4] - A[1] * A[3];
  const a = A[4] / det, b = -A[1] / det, c = -A[3] / det, d = A[0] / det;
  return [a, b, -(a * A[2] + b * A[5]), c, d, -(c * A[2] + d * A[5])];
}
const compose = (B, A) => [B[0] * A[0] + B[1] * A[3], B[0] * A[1] + B[1] * A[4], B[0] * A[2] + B[1] * A[5] + B[2], B[3] * A[0] + B[4] * A[3], B[3] * A[1] + B[4] * A[4], B[3] * A[2] + B[4] * A[5] + B[5]];

/** global transform from params: template-grid -> photo-grid, about the two bounding-box centres */
function globalAffine(prm, qc, pc) {
  const th = prm.th * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const a = c * prm.sx, b = -s * prm.sy, d = s * prm.sx, e = c * prm.sy;
  return [a, b, pc[0] + prm.tx - (a * qc[0] + b * qc[1]), d, e, pc[1] + prm.ty - (d * qc[0] + e * qc[1])];
}

/** IoU of the warped union silhouette with the photo mask, over the photo grid padded by 25% */
function iou(G, P, A) {
  const inv = invert(A), pad = Math.round(P.Wg * 0.25), q = [0, 0];
  let inter = 0, uni = 0;
  for (let y = -pad; y < P.Hg + pad; y++) for (let x = -pad; x < P.Wg + pad; x++) {
    apply(inv, x + 0.5, y + 0.5, q);
    const qx = Math.floor(q[0]), qy = Math.floor(q[1]);
    const t = qx >= 0 && qy >= 0 && qx < G.W && qy < G.H && G.bits[qy * G.W + qx] ? 1 : 0;
    const m = x >= 0 && y >= 0 && x < P.Wg && y < P.Hg ? P.Mg[y * P.Wg + x] : 0;
    if (t && m) inter++;
    if (t || m) uni++;
  }
  return inter / (uni || 1);
}

/** coordinate descent over named params with shrinking steps; maximises score(params) */
function descend(prm, steps, score, rounds = 5) {
  let best = score(prm);
  for (let r = 0; r < rounds; r++) {
    let improved = true, guard = 0;
    while (improved && guard++ < 30) {
      improved = false;
      for (const k of Object.keys(steps)) for (const dir of [1, -1]) {
        const trial = { ...prm, [k]: prm[k] + dir * steps[k] }, s = score(trial);
        if (s > best + 1e-9) { prm = trial; best = s; improved = true; }
      }
    }
    for (const k of Object.keys(steps)) steps[k] *= 0.5;
  }
  return { prm, score: best };
}

/** register the template (front view or mirrored back view) to a prepared photo */
export function register(G, P) {
  const qc = [G.W / 2, G.H / 2], pc = [P.Wg / 2, P.Hg / 2];
  let tx0 = G.W, tx1 = 0, ty0 = G.H, ty1 = 0;
  for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) if (G.bits[y * G.W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
  const sx0 = P.Wg / (tx1 - tx0 + 1), sy0 = P.Hg / (ty1 - ty0 + 1);
  const tcx = (tx0 + tx1) / 2, tcy = (ty0 + ty1) / 2;
  let best = null;
  for (const th of [-6, 0, 6]) {
    const start = { sx: sx0, sy: sy0, tx: (qc[0] - tcx) * sx0, ty: (qc[1] - tcy) * sy0, th };
    const r = descend(start, { sx: sx0 * 0.12, sy: sy0 * 0.12, tx: P.Wg * 0.06, ty: P.Hg * 0.06, th: 5 }, (p) => iou(G, P, globalAffine(p, qc, pc)));
    if (!best || r.score > best.score) best = r;
  }
  const A = globalAffine(best.prm, qc, pc);
  const out = { torso: A, iouGlobal: best.score, sleeve: {} };
  const pad = Math.round(P.Wg * 0.25), inv = invert(A), q = [0, 0], covered = new Uint8Array((P.Wg + 2 * pad) * (P.Hg + 2 * pad));
  for (let y = -pad; y < P.Hg + pad; y++) for (let x = -pad; x < P.Wg + pad; x++) {
    apply(inv, x + 0.5, y + 0.5, q); const qx = Math.floor(q[0]), qy = Math.floor(q[1]);
    if (qx >= 0 && qy >= 0 && qx < G.W && qy < G.H && G.bits[qy * G.W + qx] & BIT_TORSO) covered[(y + pad) * (P.Wg + 2 * pad) + x + pad] = 1;
  }
  for (const [bit, key] of [[BIT_SLEEVE_POS, 'pos'], [BIT_SLEEVE_NEG, 'neg']]) {
    const xs = [], ys = []; let mean = 0;
    for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) if (G.bits[y * G.W + x] & bit) { xs.push(x); ys.push(y); mean += x; }
    if (xs.length < 20) continue;
    mean /= xs.length;
    const order = xs.map((x, i) => [Math.abs(x - G.W / 2), i]).sort((a, b) => a[0] - b[0]).slice(0, Math.max(5, Math.floor(xs.length * 0.05)));
    const root = [order.reduce((s, [, i]) => s + xs[i], 0) / order.length, order.reduce((s, [, i]) => s + ys[i], 0) / order.length], r = [0, 0];
    apply(A, root[0], root[1], r);
    const build = (p) => {
      const th = p.dth * Math.PI / 180, c = Math.cos(th) * p.ds, s = Math.sin(th) * p.ds;
      return compose([c, -s, r[0] + p.dx - (c * r[0] - s * r[1]), s, c, r[1] + p.dy - (s * r[0] + c * r[1])], A);
    };
    const score = (p) => {
      const B = build(p), invB = invert(B), qq = [0, 0]; let sc = 0;
      for (let y = -pad; y < P.Hg + pad; y++) for (let x = -pad; x < P.Wg + pad; x++) {
        apply(invB, x + 0.5, y + 0.5, qq); const qx = Math.floor(qq[0]), qy = Math.floor(qq[1]);
        if (qx < 0 || qy < 0 || qx >= G.W || qy >= G.H || !(G.bits[qy * G.W + qx] & bit)) continue;
        const m = x >= 0 && y >= 0 && x < P.Wg && y < P.Hg ? P.Mg[y * P.Wg + x] : 0;
        sc += m ? (covered[(y + pad) * (P.Wg + 2 * pad) + x + pad] ? 0.15 : 1) : -1.5;
      }
      return sc;
    };
    const res = descend({ dx: 0, dy: 0, dth: 0, ds: 1 }, { dx: P.Wg * 0.06, dy: P.Hg * 0.06, dth: 10, ds: 0.12 }, score, 5);
    out.sleeve[key] = build(res.prm);
    out.sleeve[key + 'Score'] = res.score;
  }
  return out;
}

/* ------------------------------------------------------------------ camera estimation */

/**
 * Estimate a perspective camera from the coarse 2D silhouette registration.
 * The affine A maps template-grid -> photo-grid; from its scale we derive pixels-per-meter,
 * then camera distance z0 = focal_length / pixels_per_meter.
 * Camera is placed above-and-in-front of the garment (+Z is front, toward camera).
 */
function estimateCamera(T, parts, GF, F, reg) {
  const A = reg.torso;
  const sx = Math.abs(A[0]) * GF.sc / F.s; // photo pixels per template metre (x)
  const sy = Math.abs(A[3]) * GF.sc / F.s; // photo pixels per template metre (y)
  const pxPerMeter = (sx + sy) / 2;
  const fx = Math.max(F.w, F.h);           // ~50-60 deg FOV focal length in pixels
  const z0 = fx / pxPerMeter;              // metres from camera to garment
  // camera above-and-in-front: +Z is front (toward camera), +Y is up
  const elev = 0.5; // ~29 deg elevation above horizontal
  const eye = [0, z0 * Math.sin(elev), z0 * Math.cos(elev)];
  const cam = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  return { cam, fx, fy: fx, cx: F.w / 2, cy: F.h / 2, z0 };
}

/* ------------------------------------------------------------------ per-row colours (inferred back) */

/** per-row colours of a photo's garment (median over the solid pixels of the middle of each row); the inferred back */
function rowColours(P) {
  const rows = new Array(P.h).fill(null);
  for (let y = 0; y < P.h; y++) {
    let a = -1, b = -1;
    for (let x = P.bx0; x < P.bx1; x++) if (P.mask[y * P.w + x]) { if (a < 0) a = x; b = x; }
    if (a < 0) continue;
    const x0 = Math.round(a + (b - a) * 0.15), x1 = Math.round(b - (b - a) * 0.15), r = [], g = [], bl = [];
    for (let x = x0; x < x1; x += 2) { const i = y * P.w + x; if (P.solid[i]) { r.push(P.rgba[i * 4]); g.push(P.rgba[i * 4 + 1]); bl.push(P.rgba[i * 4 + 2]); } }
    if (r.length > 8) { const m = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; }; rows[y] = [m(r), m(g), m(bl)]; }
  }
  let last = null;
  for (let y = 0; y < P.h; y++) { if (rows[y]) last = rows[y]; else if (last) rows[y] = last; }
  last = null;
  for (let y = P.h - 1; y >= 0; y--) { if (rows[y]) last = rows[y]; else if (last) rows[y] = last; }
  return rows;
}

/* ------------------------------------------------------------------ atlas */

/**
 * @param T       { pos, nrm, uv, index }  rest positions / normals / UVs (glTF: v runs down) / triangles
 * @param photos  { front: {rgba,width,height,mask,alpha?}, back?: same }
 * @param opts    { size = 2048, padding = 8, debug = false }
 * @returns { rgba: Uint8ClampedArray(size*size*4), size, report, debug? }
 */
export function scanAtlas(T, photos, opts = {}) {
  const S = opts.size || 2048, pad = opts.padding ?? 8, t0 = Date.now(), ms = {}, lap = (k) => { ms[k] = Date.now() - (lap.t || t0); lap.t = Date.now(); };
  const parts = templateParts(T);
  const F = preparePhoto(photos.front), B = photos.back ? preparePhoto(photos.back) : null; lap('prepare');
  const GF = templateGrid(T, parts, false), GB = B ? templateGrid(T, parts, true) : null; lap('template');
  const regF = register(GF, F), regB = B ? register(GB, B) : null; lap('register');
  const frontRows = rowColours(F);

  /** template point (x, y) of a part -> photo pixel, through that part's affine transform */
  const mapper = (P, G, reg, mirror) => (kind, side, x, y, o) => {
    const qx = ((mirror ? -x : x) - G.x0) * G.sc, qy = (G.y1 - y) * G.sc, pp2 = [0, 0];
    let A = reg.torso;
    if (kind === 'sleeve') A = reg.sleeve[(mirror ? -side : side) > 0 ? 'pos' : 'neg'] || reg.torso;
    apply(A, qx, qy, pp2);
    o[0] = P.bx0 + pp2[0] / P.s; o[1] = P.by0 + pp2[1] / P.s;
  };
  const mapFront = mapper(F, GF, regF, false);
  const mapBack = B ? mapper(B, GB, regB, true) : null;

  const img = new Uint8ClampedArray(S * S * 4), filled = new Uint8Array(S * S), col = [0, 0, 0], pp = [0, 0];
  let nFront = 0, nBack = 0, nInferred = 0, nFabric = 0;
  const { pos, nrm, uv, index } = T, fab = F.fabric, bfab = B ? B.fabric : F.fabric;
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t], ib = index[t + 1], ic = index[t + 2];
    const ax = uv[ia * 2] * S, ay = uv[ia * 2 + 1] * S, bx = uv[ib * 2] * S, by = uv[ib * 2 + 1] * S, cx = uv[ic * 2] * S, cy = uv[ic * 2 + 1] * S;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const pc = parts.piece[ia], kind = parts.kind[pc], side = parts.side[pc];
    const pax = pos[ia * 3], pay = pos[ia * 3 + 1];
    const pbx = pos[ib * 3], pby = pos[ib * 3 + 1];
    const pcx = pos[ic * 3], pcy = pos[ic * 3 + 1];
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(S - 1, Math.ceil(Math.max(ay, by, cy))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5, py = y + 0.5;
        const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w3 = 1 - w1 - w2;
        if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
        // interpolate template 3D position across the triangle (barycentric)
        const X = pax * w1 + pbx * w2 + pcx * w3, Y = pay * w1 + pby * w2 + pcy * w3;
        const NZs = nrm[ia * 3 + 2] * w1 + nrm[ib * 3 + 2] * w2 + nrm[ic * 3 + 2] * w3;
        const useBack = kind === 'back' || (kind === 'sleeve' && NZs <= -0.12), o = (y * S + x) * 4;
        let ok = false;
        if (!useBack) {
          mapFront(kind, side, X, Y, pp);
          ok = sample(F, pp[0], pp[1], col);
          if (ok) nFront++;
        } else if (mapBack) {
          mapBack(kind, side, X, Y, pp);
          ok = sample(B, B.w - 1 - pp[0], pp[1], col); // mirror horizontally for flipped back
          if (ok) nBack++;
        }
        if (ok) {
          img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
        } else if (useBack && !B) {
          mapFront(kind, side, X, Y, pp);
          const f = frontRows[clamp(Math.round(pp[1]), 0, F.h - 1)] || fab; img[o] = f[0]; img[o + 1] = f[1]; img[o + 2] = f[2]; nInferred++;
        } else { const f = useBack ? bfab : fab; img[o] = f[0]; img[o + 1] = f[1]; img[o + 2] = f[2]; nFabric++; }
        img[o + 3] = 255; filled[y * S + x] = 1;
      }
    }
  lap('texels');
  // pad the islands outward so mip-mapping does not bleed the unused atlas colour in
  let cand = [];
  for (let i = 0; i < S * S; i++) {
    if (filled[i]) continue;
    const x = i % S;
    if ((x < S - 1 && filled[i + 1]) || (x > 0 && filled[i - 1]) || (i >= S && filled[i - S]) || (i < S * (S - 1) && filled[i + S])) cand.push(i);
  }
  const N4 = [1, -1, S, -S];
  for (let pass = 0; pass < pad && cand.length; pass++) {
    const set = new Set();
    for (const i of cand) {
      const x = i % S; let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < 4; k++) {
        const j = i + N4[k];
        if (j < 0 || j >= S * S || (k === 0 && x === S - 1) || (k === 1 && x === 0) || !filled[j]) continue;
        const o = j * 4; r += img[o]; g += img[o + 1]; b += img[o + 2]; n++;
      }
      if (n) { const o = i * 4; img[o] = r / n; img[o + 1] = g / n; img[o + 2] = b / n; img[o + 3] = 255; set.add(i); }
    }
    const next = [];
    for (const i of set) { filled[i] = 1; const x = i % S; for (let k = 0; k < 4; k++) { const j = i + N4[k]; if (j >= 0 && j < S * S && !(k === 0 && x === S - 1) && !(k === 1 && x === 0) && !filled[j]) next.push(j); } }
    cand = next;
  }
  for (let i = 0; i < S * S; i++) if (!filled[i]) { img[i * 4] = fab[0]; img[i * 4 + 1] = fab[1]; img[i * 4 + 2] = fab[2]; img[i * 4 + 3] = 255; }
  lap('pad');

  const total = nFront + nBack + nInferred + nFabric || 1, r3 = (v) => Math.round(v * 1000) / 1000;
  const report = {
    ms: Date.now() - t0, stages: ms, size: S,
    fromFrontPhoto: r3(nFront / total), fromBackPhoto: r3(nBack / total), backInferredFromFront: r3(nInferred / total), fabricFill: r3(nFabric / total),
    fabricRGB: fab.map(Math.round),
    registration: { frontIoU: r3(regF.iouGlobal), backIoU: regB ? r3(regB.iouGlobal) : null },
  };
  const result = { rgba: img, size: S, report };
  if (opts.debug) result.debug = { front: overlay(F, GF, regF), back: B ? overlay(B, GB, regB) : null };
  return result;
}

/** the photo with the registered template parts tinted on it (red torso, green / blue sleeves): to SEE the alignment */
function overlay(P, G, reg) {
  const W = P.Wg, H = P.Hg, out = new Uint8ClampedArray(W * H * 4), q = [0, 0];
  const invT = invert(reg.torso), invP = reg.sleeve.pos ? invert(reg.sleeve.pos) : null, invN = reg.sleeve.neg ? invert(reg.sleeve.neg) : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = Math.min(P.w - 1, Math.floor(P.bx0 + (x + 0.5) / P.s)), py = Math.min(P.h - 1, Math.floor(P.by0 + (y + 0.5) / P.s)), i = (py * P.w + px) * 4, o = (y * W + x) * 4;
    let r = P.rgba[i], g = P.rgba[i + 1], b = P.rgba[i + 2];
    if (!P.mask[py * P.w + px]) { r = r * 0.35 + 90; g = g * 0.35 + 90; b = b * 0.35 + 90; }
    const hit = (inv, bit) => { apply(inv, x + 0.5, y + 0.5, q); const qx = Math.floor(q[0]), qy = Math.floor(q[1]); return qx >= 0 && qy >= 0 && qx < G.W && qy < G.H && (G.bits[qy * G.W + qx] & bit); };
    if (hit(invT, BIT_TORSO)) { r = r * 0.6 + 255 * 0.4; g *= 0.6; b *= 0.6; }
    if (invP && hit(invP, BIT_SLEEVE_POS)) { g = g * 0.6 + 255 * 0.4; r *= 0.6; b *= 0.6; }
    if (invN && hit(invN, BIT_SLEEVE_NEG)) { b = b * 0.6 + 255 * 0.4; r *= 0.6; g *= 0.6; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return { width: W, height: H, rgba: out };
}
