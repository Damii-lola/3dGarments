/**
 * 3dGarments — garment silhouette engine.
 *
 * Shared by the API (Node, via sharp raw buffers) and the web client (browser,
 * via ImageData) so a garment is cut out and measured identically everywhere.
 * Pure ESM, zero dependencies, works on any RGBA byte array.
 *
 * Pipeline:  segmentGarment → composeCutout → analyzeSilhouette
 *
 * Coordinate convention for analyzeSilhouette() output (the "garment space"):
 *   unit = texture height,  x ∈ [0, width/height],  y ∈ [0, 1],  y grows DOWN.
 */

export const SILHOUETTE_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

/** Coarse categories — each one maps to a wrap strategy on the 3D body. */
export const CATEGORIES = ['top', 'outerwear', 'dress', 'skirt', 'pants', 'shorts'];

export const WRAP_MODE = {
  top: 'upper',
  outerwear: 'upper',
  dress: 'full',
  skirt: 'skirt',
  pants: 'legs',
  shorts: 'legs',
};

/** Draw order / radial offset. Bottoms sit closest to the skin. */
export const LAYER = { pants: 0, shorts: 0, skirt: 0, top: 1, dress: 1, outerwear: 2 };

/** Fine-grained garment types the vision model may return. */
export const TYPE_TO_CATEGORY = {
  tshirt: 'top', shirt: 'top', blouse: 'top', polo: 'top', sweater: 'top', hoodie: 'top',
  sweatshirt: 'top', tank: 'top', crop_top: 'top', jersey: 'top',
  jacket: 'outerwear', coat: 'outerwear', blazer: 'outerwear', cardigan: 'outerwear', vest: 'outerwear',
  dress: 'dress', gown: 'dress', jumpsuit: 'dress', kaftan: 'dress', agbada: 'dress',
  skirt: 'skirt', wrapper: 'skirt',
  trousers: 'pants', jeans: 'pants', leggings: 'pants', joggers: 'pants', chinos: 'pants',
  shorts: 'shorts',
};

export function resolveCategory(aiType, silhouetteGuess) {
  const t = typeof aiType === 'string' ? aiType.toLowerCase().trim().replace(/[\s-]+/g, '_') : '';
  if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  if (CATEGORIES.includes(t)) return t;
  return CATEGORIES.includes(silhouetteGuess) ? silhouetteGuess : 'top';
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const L_WEIGHT = 0.62; // shadows on the backdrop mostly move lightness, not chroma

export function rgbaToLab(rgba, n) {
  const lab = new Float32Array(n * 3);
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    const r = LIN[rgba[p]], g = LIN[rgba[p + 1]], b = LIN[rgba[p + 2]];
    const fx = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[q] = (116 * fy - 16) * L_WEIGHT;
    lab[q + 1] = 500 * (fx - fy);
    lab[q + 2] = 200 * (fy - fz);
  }
  return lab;
}

export function kmeansLab(lab, samples, k, iters = 12) {
  const m = samples.length;
  const c = new Float32Array(k * 3);
  for (let j = 0; j < k; j++) {
    const s = samples[Math.min(m - 1, Math.floor(((j + 0.5) * m) / k))] * 3;
    c[j * 3] = lab[s]; c[j * 3 + 1] = lab[s + 1]; c[j * 3 + 2] = lab[s + 2];
  }
  const assign = new Int32Array(m);
  const dists = new Float32Array(m);
  for (let it = 0; it < iters; it++) {
    const sum = new Float64Array(k * 3);
    const cnt = new Int32Array(k);
    for (let a = 0; a < m; a++) {
      const s = samples[a] * 3;
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const dl = lab[s] - c[j * 3], da = lab[s + 1] - c[j * 3 + 1], db = lab[s + 2] - c[j * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bd) { bd = d; best = j; }
      }
      assign[a] = best; dists[a] = Math.sqrt(bd);
      cnt[best]++; sum[best * 3] += lab[s]; sum[best * 3 + 1] += lab[s + 1]; sum[best * 3 + 2] += lab[s + 2];
    }
    for (let j = 0; j < k; j++) if (cnt[j]) {
      c[j * 3] = sum[j * 3] / cnt[j]; c[j * 3 + 1] = sum[j * 3 + 1] / cnt[j]; c[j * 3 + 2] = sum[j * 3 + 2] / cnt[j];
    }
  }
  const out = [];
  for (let j = 0; j < k; j++) {
    let count = 0, spread = 0;
    for (let a = 0; a < m; a++) if (assign[a] === j) { count++; spread += dists[a]; }
    out.push({ center: [c[j * 3], c[j * 3 + 1], c[j * 3 + 2]], count, spread: count ? spread / count : 0 });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Morphology                                                          */
/* ------------------------------------------------------------------ */

function morph(mask, w, h, r, dilate) {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        const s = xx < 0 || xx >= w ? (dilate ? 0 : 1) : mask[o + xx];
        if (s === want) { v = want; break; }
      }
      tmp[o + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        const s = yy < 0 || yy >= h ? (dilate ? 0 : 1) : tmp[yy * w + x];
        if (s === want) { v = want; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function keepMainComponents(mask, w, h) {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  const areas = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    const id = areas.length;
    let qh = 0, qt = 0, area = 0;
    q[qt++] = s; label[s] = id;
    while (qh < qt) {
      const i = q[qh++]; area++;
      const x = i % w;
      if (x > 0 && mask[i - 1] && label[i - 1] === -1) { label[i - 1] = id; q[qt++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && label[i + 1] === -1) { label[i + 1] = id; q[qt++] = i + 1; }
      if (i >= w && mask[i - w] && label[i - w] === -1) { label[i - w] = id; q[qt++] = i - w; }
      if (i < n - w && mask[i + w] && label[i + w] === -1) { label[i + w] = id; q[qt++] = i + w; }
    }
    areas.push(area);
  }
  if (!areas.length) return mask;
  const largest = Math.max(...areas);
  const keep = areas.map((a) => a >= Math.max(largest * 0.12, n * 0.0015));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (label[i] >= 0 && keep[label[i]]) out[i] = 1;
  return out;
}

function fillHoles(mask, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qt = 0;
  const seed = (i) => { if (!mask[i] && !seen[i]) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  let qh = 0;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < n - w) seed(i + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] || !seen[i] ? 1 : 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* Segmentation                                                        */
/* ------------------------------------------------------------------ */

function floodSegment(rgba, w, h) {
  const n = w * h;
  const lab = rgbaToLab(rgba, n);
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.012));

  const border = [];
  for (let y = 0; y < h; y++) {
    if (y < t || y >= h - t) { for (let x = 0; x < w; x++) border.push(y * w + x); }
    else { for (let x = 0; x < t; x++) { border.push(y * w + x); border.push(y * w + w - 1 - x); } }
  }
  const stride = Math.max(1, Math.floor(border.length / 5000));
  const samples = [];
  for (let i = 0; i < border.length; i += stride) samples.push(border[i]);

  const clusters = kmeansLab(lab, samples, 4).filter((c) => c.count >= samples.length * 0.06);
  let spread = 0, total = 0;
  for (const c of clusters) { spread += c.spread * c.count; total += c.count; }
  spread = total ? spread / total : 4;

  const T1 = Math.min(30, Math.max(9, spread * 2.4 + 7));
  const T1sq = T1 * T1;
  const loose = T1 * 2.1, looseSq = loose * loose;
  const T2 = Math.max(2.2, T1 * 0.26), T2sq = T2 * T2;
  const centers = clusters.map((c) => c.center);

  const dist = new Float32Array(n).fill(-1);
  const dBg = (i) => {
    let d = dist[i];
    if (d >= 0) return d;
    const q = i * 3, L = lab[q], A = lab[q + 1], B = lab[q + 2];
    d = Infinity;
    for (const c of centers) {
      const dl = L - c[0], da = A - c[1], db = B - c[2];
      const dd = dl * dl + da * da + db * db;
      if (dd < d) d = dd;
    }
    dist[i] = d;
    return d;
  };
  const dPix = (i, j) => {
    const a = i * 3, b = j * 3;
    const dl = lab[a] - lab[b], da = lab[a + 1] - lab[b + 1], db = lab[a + 2] - lab[b + 2];
    return dl * dl + da * da + db * db;
  };

  const bg = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (const i of border) if (!bg[i] && dBg(i) < T1sq * 1.8) { bg[i] = 1; q[qt++] = i; }

  const visit = (i, j) => {
    if (bg[j]) return;
    const d = dBg(j);
    if (d < T1sq || (d < looseSq && dPix(i, j) < T2sq)) { bg[j] = 1; q[qt++] = j; }
  };
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w;
    if (x > 0) visit(i, i - 1);
    if (x < w - 1) visit(i, i + 1);
    if (i >= w) visit(i, i - w);
    if (i < n - w) visit(i, i + w);
  }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1;
  return mask;
}

/**
 * Separate the garment from its backdrop.
 * Uses the photo's own alpha when present (pre-cut PNGs), otherwise a
 * border-seeded, gradient-aware flood fill in perceptual (Lab) space.
 * @returns {{mask: Uint8Array, method: 'alpha'|'flood'|'fallback', coverage: number}}
 */
export function segmentGarment(rgba, width, height) {
  const n = width * height;
  let transparent = 0;
  for (let p = 3; p < n * 4; p += 4) if (rgba[p] < 16) transparent++;

  let mask, method;
  if (transparent / n > 0.02) {
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    method = 'alpha';
  } else {
    mask = floodSegment(rgba, width, height);
    method = 'flood';
  }

  const r = Math.max(1, Math.round(Math.min(width, height) / 400));
  mask = morph(morph(mask, width, height, r, false), width, height, r, true); // open
  mask = keepMainComponents(mask, width, height);
  mask = morph(morph(mask, width, height, r, true), width, height, r, false); // close
  mask = fillHoles(mask, width, height);

  let on = 0;
  for (let i = 0; i < n; i++) on += mask[i];
  let coverage = on / n;
  if (coverage < 0.02 || coverage > 0.985) {
    mask = new Uint8Array(n).fill(1);
    method = 'fallback';
    coverage = 1;
  }
  return { mask, method, coverage: round(coverage) };
}

/* ------------------------------------------------------------------ */
/* Cut-out                                                             */
/* ------------------------------------------------------------------ */

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[o + Math.min(w - 1, Math.max(0, x + d))];
      tmp[o + x] = s / span;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x];
      out[y * w + x] = s / span;
    }
  }
  return out;
}

/**
 * Crop to the garment, feather the edge and bleed edge colours into the
 * transparent area (prevents dark halos under mip-mapping).
 * @returns {{rgba: Uint8ClampedArray, width: number, height: number, mask: Uint8Array, bbox: object}}
 */
export function composeCutout(rgba, width, height, mask) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) if (mask[o + x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = width - 1; maxY = height - 1; }
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.025) + 2;
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad), y1 = Math.min(height - 1, maxY + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cn = cw * ch;

  const cm = new Uint8Array(cn);
  const soft = new Float32Array(cn);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const v = mask[(y + y0) * width + (x + x0)];
    cm[y * cw + x] = v; soft[y * cw + x] = v;
  }
  const alpha = boxBlur(boxBlur(soft, cw, ch, 1), cw, ch, 1);

  const out = new Uint8ClampedArray(cn * 4);
  const known = new Uint8Array(cn);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x, s = ((y + y0) * width + (x + x0)) * 4, d = i * 4;
    const a = Math.round(alpha[i] * 255);
    out[d + 3] = a;
    if (cm[i]) { out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; known[i] = 1; }
  }
  // colour bleed: grow garment colours outward a few pixels
  let frontier = known;
  for (let pass = 0; pass < 8; pass++) {
    const next = frontier.slice();
    let changed = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (frontier[i]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
        const j = yy * cw + xx;
        if (frontier[j]) { r += out[j * 4]; g += out[j * 4 + 1]; b += out[j * 4 + 2]; c++; }
      }
      if (c) { out[i * 4] = r / c; out[i * 4 + 1] = g / c; out[i * 4 + 2] = b / c; next[i] = 1; changed++; }
    }
    frontier = next;
    if (!changed) break;
  }
  return { rgba: out, width: cw, height: ch, mask: cm, bbox: { x: x0, y: y0, w: cw, h: ch } };
}

/* ------------------------------------------------------------------ */
/* Silhouette analysis                                                 */
/* ------------------------------------------------------------------ */

function round(v, p = 4) { const f = 10 ** p; return Math.round(v * f) / f; }
function median(arr) {
  const a = arr.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function medianFilter(arr, r) {
  return arr.map((_, i) => median(arr.slice(Math.max(0, i - r), i + r + 1)));
}
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}
function fitLine(ys, xs) {
  const n = ys.length;
  if (n < 2) return { a: xs[0] ?? 0, b: 0 };
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sy += ys[i]; sx += xs[i]; syy += ys[i] * ys[i]; sxy += ys[i] * xs[i]; }
  const den = n * syy - sy * sy;
  if (Math.abs(den) < 1e-9) return { a: sx / n, b: 0 };
  const b = (n * sxy - sy * sx) / den;
  return { a: (sx - b * sy) / n, b };
}

function rowRuns(mask, w, y, minLen, mergeGap) {
  const runs = [];
  const o = y * w;
  let x = 0;
  while (x < w) {
    while (x < w && !mask[o + x]) x++;
    if (x >= w) break;
    const s = x;
    while (x < w && mask[o + x]) x++;
    const e = x - 1;
    const last = runs[runs.length - 1];
    if (last && s - last[1] - 1 <= mergeGap) last[1] = e;
    else runs.push([s, e]);
  }
  return runs.filter((r) => r[1] - r[0] + 1 >= minLen);
}

/**
 * Measure a cut-out garment: torso edges, armpits, sleeve axes, leg split.
 * Everything the 3D wrapper needs, in garment space (unit = texture height).
 */
export function analyzeSilhouette(mask, w, h) {
  const U = h;
  const R = Math.min(128, h);
  const minLen = Math.max(2, Math.round(w * 0.004));
  const gap = Math.max(1, Math.round(w * 0.008));

  let sx = 0, cnt = 0, top = -1, bottom = -1;
  for (let y = 0; y < h; y += 1) {
    let any = false;
    const o = y * w;
    for (let x = 0; x < w; x += 2) if (mask[o + x]) { sx += x; cnt++; any = true; }
    if (any) { if (top < 0) top = y; bottom = y; }
  }
  if (!cnt) return emptyGeometry(w, h);
  const cxPx = sx / cnt;
  const cx = cxPx / U;
  const topN = top / U, botN = (bottom + 1) / U, ext = botN - topN;

  const rows = [];
  for (let k = 0; k < R; k++) {
    const py = Math.min(h - 1, Math.round(((k + 0.5) / R) * h - 0.5));
    const runs = rowRuns(mask, w, py, minLen, gap).map(([l, r]) => [l / U, (r + 1) / U]);
    rows.push({ y: py / U, runs });
  }
  const gy = (y) => (y - topN) / ext;
  const inG = (r) => r.runs.length > 0 && gy(r.y) >= 0 && gy(r.y) <= 1;

  const centerRun = (runs) => {
    let best = null, bd = Infinity;
    for (const r of runs) {
      if (r[0] <= cx && r[1] >= cx) return r;
      const d = Math.min(Math.abs(r[0] - cx), Math.abs(r[1] - cx));
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  };
  const coversCenter = (runs) => runs.some((r) => r[0] <= cx && r[1] >= cx);

  /* ---- crotch (two legs below a shared waist) ---- */
  let crotchK = null;
  const waistCovered = rows.filter((r) => inG(r) && gy(r.y) < 0.15).every((r) => coversCenter(r.runs));
  if (waistCovered) {
    for (let k = 0; k < R; k++) {
      const r = rows[k];
      if (!inG(r) || gy(r.y) < 0.2 || gy(r.y) > 0.9) continue;
      const split = (row) => row.runs.length >= 2 && !coversCenter(row.runs);
      if (!split(r)) continue;
      const rest = rows.slice(k).filter((x) => inG(x) && gy(x.y) <= 0.98);
      const frac = rest.filter(split).length / Math.max(1, rest.length);
      if (frac >= 0.75 && rest.length >= 4) { crotchK = k; break; }
    }
  }

  /* ---- centre-run widths ---- */
  const cl = rows.map((r) => (inG(r) ? centerRun(r.runs)[0] : NaN));
  const cr = rows.map((r) => (inG(r) ? centerRun(r.runs)[1] : NaN));
  const clS = medianFilter(cl, 2);
  const crS = medianFilter(cr, 2);
  const width = clS.map((l, i) => crS[i] - l);

  /* ---- armpit (sharp width jump going up) ---- */
  let armpitK = null;
  if (crotchK === null) {
    const gIdx = rows.map((r, i) => (inG(r) ? i : -1)).filter((i) => i >= 0);
    const kFirst = gIdx[0], kLast = gIdx[gIdx.length - 1];
    let kStart = kLast;
    while (kStart > kFirst && gy(rows[kStart].y) > 0.9) kStart--;
    let trend = width[kStart];
    for (let k = kStart - 1; k >= kFirst && gy(rows[k].y) >= 0.03; k--) {
      const wk = width[k];
      if (!Number.isFinite(wk)) continue;
      const lim = trend * 1.16 + 0.012;
      const w1 = width[k - 1], w2 = width[k - 2];
      if (wk > lim && (w1 === undefined || w1 > lim) && (w2 === undefined || w2 > lim * 0.98)) { armpitK = k + 1; break; }
      trend = trend * 0.72 + wk * 0.28;
    }
    if (armpitK !== null && gy(rows[armpitK].y) > 0.85) armpitK = null; // a flared hem, not sleeves
  }

  /* ---- torso edges per row ---- */
  const tL = new Array(R).fill(NaN), tR = new Array(R).fill(NaN);
  for (let k = 0; k < R; k++) {
    if (!inG(rows[k])) continue;
    if (crotchK !== null && k >= crotchK) continue;
    const runs = rows[k].runs;
    if (!coversCenter(runs) && runs.length >= 2 && gy(rows[k].y) < 0.4) {
      // neckline / strap rows: the garment spans from the first to the last run
      tL[k] = runs[0][0]; tR[k] = runs[runs.length - 1][1];
    } else {
      tL[k] = clS[k]; tR[k] = crS[k];
    }
  }
  if (armpitK !== null) {
    const span = [];
    for (let k = armpitK; k < R && gy(rows[k].y) <= gy(rows[armpitK].y) + 0.22; k++) if (Number.isFinite(tL[k])) span.push(k);
    const ys = span.map((k) => rows[k].y);
    const lf = fitLine(ys, span.map((k) => tL[k]));
    const rf = fitLine(ys, span.map((k) => tR[k]));
    const baseW = median(span.map((k) => tR[k] - tL[k]));
    for (let k = 0; k < armpitK; k++) {
      if (!inG(rows[k])) continue;
      const y = rows[k].y;
      let l = lf.a + lf.b * y, r = rf.a + rf.b * y;
      const runs = rows[k].runs;
      l = Math.max(l, runs[0][0]); r = Math.min(r, runs[runs.length - 1][1]);
      if (r - l < baseW * 0.35) { const m = (l + r) / 2; l = m - baseW * 0.175; r = m + baseW * 0.175; }
      tL[k] = l; tR[k] = r;
    }
  }

  /* ---- legs ---- */
  const legs = new Array(R).fill(null);
  if (crotchK !== null) {
    for (let k = crotchK; k < R; k++) {
      const r = rows[k];
      if (!inG(r)) continue;
      const big = [...r.runs].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
      if (big.length === 2) legs[k] = big;
      else if (big.length === 1) legs[k] = [[big[0][0], cx], [cx, big[0][1]]];
    }
  }

  /* ---- sleeves ---- */
  const sleeves = { left: null, right: null };
  if (armpitK !== null) {
    const armY = rows[armpitK].y;
    const edgeAt = (y, side) => {
      const f = (y - rows[0].y) / (rows[1] ? rows[1].y - rows[0].y : 1);
      const k0 = Math.max(0, Math.min(R - 1, Math.floor(f))), k1 = Math.min(R - 1, k0 + 1);
      const arr = side < 0 ? tL : tR;
      const a = arr[k0], b = arr[k1], t = f - k0;
      if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * t;
      return Number.isFinite(a) ? a : b;
    };
    const rootY = topN + (armY - topN) * 0.5;
    for (const side of [-1, 1]) {
      const pts = [];
      const step = Math.max(1, Math.round(Math.min(w, h) / 220));
      const margin = 0.006;
      for (let py = top; py <= bottom; py += step) {
        const y = py / U;
        const e = edgeAt(y, side);
        if (!Number.isFinite(e)) continue;
        const o = py * w;
        for (let px = 0; px < w; px += step) {
          if (!mask[o + px]) continue;
          const x = px / U;
          if (side < 0 ? x < e - margin : x > e + margin) pts.push(x, y);
        }
      }
      const np = pts.length / 2;
      const totalApprox = (cnt * 2) / (step * step);
      if (np < Math.max(12, totalApprox * 0.006)) continue;
      const rx = edgeAt(rootY, side), ry = rootY;
      let mx = 0, my = 0;
      for (let i = 0; i < pts.length; i += 2) { mx += pts[i]; my += pts[i + 1]; }
      mx /= np; my /= np;
      let dx = mx - rx, dy = my - ry;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      const nx = -dy, ny = dx;
      const along = [], perp = [];
      for (let i = 0; i < pts.length; i += 2) {
        const px = pts[i] - rx, py = pts[i + 1] - ry;
        along.push(px * dx + py * dy);
        perp.push(px * nx + py * ny);
      }
      along.sort((a, b) => a - b); perp.sort((a, b) => a - b);
      const p5 = percentile(perp, 0.04), p95 = percentile(perp, 0.96);
      sleeves[side < 0 ? 'left' : 'right'] = {
        root: [round(rx), round(ry)],
        dir: [round(dx), round(dy)],
        offset: round((p5 + p95) / 2),
        width: round(Math.max(0.02, p95 - p5)),
        length: round(Math.max(0.02, percentile(along, 0.985))),
      };
    }
    if (!sleeves.left && !sleeves.right) armpitK = null;
  }

  /* ---- category guess ---- */
  const torsoW = median(tR.map((r, i) => r - tL[i]));
  let guess = 'top';
  if (crotchK !== null) {
    guess = (botN - rows[crotchK].y) / ext > 0.5 ? 'pants' : 'shorts';
  } else {
    const hw = ext / (torsoW || 1);
    if (armpitK !== null) guess = hw > 1.9 ? 'dress' : 'top';
    else if (hw > 1.9) guess = 'dress';
    else {
      const topRows = rows.filter((r) => inG(r) && gy(r.y) < 0.06);
      const botRows = rows.filter((r) => inG(r) && gy(r.y) > 0.88);
      const topW = median(topRows.map((r) => centerRun(r.runs)[1] - centerRun(r.runs)[0]));
      const botW = median(botRows.map((r) => centerRun(r.runs)[1] - centerRun(r.runs)[0]));
      const single = topRows.every((r) => r.runs.length === 1);
      guess = single && topW >= botW * 0.55 && botW > topW * 1.1 ? 'skirt' : 'top';
    }
  }

  return {
    version: SILHOUETTE_VERSION,
    width: w,
    height: h,
    aspect: round(w / h),
    top: round(topN),
    bottom: round(botN),
    centerX: round(cx),
    armpit: armpitK !== null ? round(rows[armpitK].y) : null,
    crotch: crotchK !== null ? round(rows[crotchK].y) : null,
    sleeves,
    guess,
    rows: rows.map((r, k) => ({
      y: round(r.y),
      t: Number.isFinite(tL[k]) ? [round(tL[k]), round(tR[k])] : null,
      legs: legs[k] ? legs[k].map(([l, rr]) => [round(l), round(rr)]) : null,
      runs: r.runs.map(([l, rr]) => [round(l), round(rr)]),
    })),
  };
}

function emptyGeometry(w, h) {
  return {
    version: SILHOUETTE_VERSION, width: w, height: h, aspect: round(w / h), top: 0, bottom: 1,
    centerX: round(w / h / 2), armpit: null, crotch: null, sleeves: { left: null, right: null }, guess: 'top',
    rows: [{ y: 0, t: [0, round(w / h)], legs: null, runs: [[0, round(w / h)]] }, { y: 1, t: [0, round(w / h)], legs: null, runs: [[0, round(w / h)]] }],
  };
}

/** One-call convenience used by both runtimes. */
export function processGarmentPixels(rgba, width, height) {
  const seg = segmentGarment(rgba, width, height);
  const cut = composeCutout(rgba, width, height, seg.mask);
  const geometry = analyzeSilhouette(cut.mask, cut.width, cut.height);
  geometry.segmentation = { method: seg.method, coverage: seg.coverage };
  return { cutout: cut, geometry };
}
