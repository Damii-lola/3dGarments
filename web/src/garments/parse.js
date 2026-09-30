/**
 * Clothes parsing: which pixels of a photo are which garment, for photos of a person wearing them
 * (shop photos, street photos), not only flat-lays on a plain backdrop.
 *
 * SegFormer-B2 trained on ATR human parsing (mattmdjaga/segformer_b2_clothes, MIT; ONNX by Xenova),
 * run in the browser with onnxruntime-web: 512² in → 18 class logits at 128², upsampled bilinearly
 * to the photo and argmax'd, then each garment's region is snapped to the photo's own edges (a colour
 * test against the region's own fabric along the uncertain band), so the cut-out follows the fabric.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { composeCutout, analyzeSilhouette } from '@shared/silhouette.js';
import { colorSignature } from '@shared/wardrobe.js';

export const LABELS = ['background', 'hat', 'hair', 'sunglasses', 'upper', 'skirt', 'pants', 'dress', 'belt',
  'shoe_l', 'shoe_r', 'face', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'bag', 'scarf'];

export const MODEL_URL = 'https://huggingface.co/Xenova/segformer_b2_clothes/resolve/main/onnx/model_quantized.onnx';
const S = 512, O = 128, NC = 18;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

let session = null;
async function getSession() {
  if (!session) {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    session = ort.InferenceSession.create(globalThis.__parseModelUrl || MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      .catch((e) => { session = null; throw e; });
  }
  return session;
}

/**
 * @param img  drawable (canvas / ImageBitmap / <img>)
 * @returns { w, h, rgba, label: Uint8Array(w·h), prob: Float32Array(w·h) (confidence of the label) }
 */
export async function parsePhoto(img, maxSide = 1024) {
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const rgba = cx.getImageData(0, 0, w, h).data;
  // model input: the photo squashed to 512² (as the processor does), normalised, CHW
  const s = document.createElement('canvas'); s.width = S; s.height = S;
  const sx = s.getContext('2d', { willReadFrequently: true });
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(c, 0, 0, S, S);
  const px = sx.getImageData(0, 0, S, S).data, input = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let ch = 0; ch < 3; ch++) input[ch * S * S + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  const sess = await getSession();
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
  const logits = out[sess.outputNames[0]].data;                   // [1, 18, 128, 128]
  // upsample (bilinear, pixel centres) + softmax argmax at the photo's resolution
  const label = new Uint8Array(w * h), prob = new Float32Array(w * h), l = new Float32Array(NC);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(O - 1, Math.max(0, ((y + 0.5) / h) * O - 0.5)), y0 = Math.floor(fy), y1 = Math.min(O - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(O - 1, Math.max(0, ((x + 0.5) / w) * O - 0.5)), x0 = Math.floor(fx), x1 = Math.min(O - 1, x0 + 1), tx = fx - x0;
      let best = 0, bv = -Infinity;
      for (let q = 0; q < NC; q++) {
        const b = q * O * O;
        const v = (logits[b + y0 * O + x0] * (1 - tx) + logits[b + y0 * O + x1] * tx) * (1 - ty) + (logits[b + y1 * O + x0] * (1 - tx) + logits[b + y1 * O + x1] * tx) * ty;
        l[q] = v; if (v > bv) { bv = v; best = q; }
      }
      let z = 0; for (let q = 0; q < NC; q++) z += Math.exp(l[q] - bv);
      label[y * w + x] = best; prob[y * w + x] = 1 / z;
    }
  }
  return { w, h, rgba, label, prob, canvas: c };
}

/** which garment regions a parsed photo holds: [{ zone, classes, share }] (share of the photo) */
export function garmentsIn(parsed) {
  const n = parsed.w * parsed.h, cnt = new Array(NC).fill(0);
  for (let i = 0; i < n; i++) cnt[parsed.label[i]]++;
  const share = (cls) => cls.reduce((a, q) => a + cnt[q], 0) / n;
  const out = [];
  if (cnt[7] / n > 0.02 && cnt[7] > cnt[4] + cnt[6]) out.push({ zone: 'full', classes: [4, 7, 5, 6, 8], share: share([7]) });
  else {
    if (share([4]) > 0.015) out.push({ zone: 'upper', classes: [4, 17], share: share([4]) });
    if (share([5, 6]) > 0.015) out.push({ zone: 'lower', classes: [5, 6, 8], share: share([5, 6]), kind: cnt[5] > cnt[6] ? 'skirt' : 'pants' });
  }
  return out;
}

/** the pixel mask of one garment zone: 'upper' | 'lower' | 'full' (clothes the network put in the
 *  other zone's class but that sit inside this one — a cargo pocket read as a top, a skirt read as a dress —
 *  are given to the zone they sit in) */
export function zoneMask(parsed, zone) {
  const { w, h, label } = parsed, n = w * h;
  const up = new Uint8Array(n), lo = new Uint8Array(n), dr = new Uint8Array(n);
  let loTop = h, loBot = 0, upN = 0, loN = 0, drN = 0;
  for (let i = 0; i < n; i++) {
    const q = label[i];
    if (q === 4 || q === 17) { up[i] = 1; upN++; }
    else if (q === 5 || q === 6 || q === 8) { lo[i] = 1; loN++; const y = (i / w) | 0; if (y < loTop) loTop = y; if (y > loBot) loBot = y; }
    else if (q === 7) { dr[i] = 1; drN++; }
  }
  const pieces = (m) => {                          // connected pieces: [{ px: [...], top, bottom }]
    const seen = new Uint8Array(n), out = [], st = [];
    for (let s = 0; s < n; s++) {
      if (!m[s] || seen[s]) continue;
      const px = []; let top = h, bottom = 0; seen[s] = 1; st.push(s);
      while (st.length) {
        const i = st.pop(); px.push(i); const x = i % w, y = (i / w) | 0;
        if (y < top) top = y; if (y > bottom) bottom = y;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && m[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
      out.push({ px, top, bottom });
    }
    return out;
  };
  if (loN) {                                       // "top" pieces that start well inside the trousers / skirt are part of them
    const lh = loBot - loTop;
    for (const p of pieces(up)) if (p.top > loTop + 0.12 * lh) for (const i of p.px) { up[i] = 0; lo[i] = 1; }
  }
  if (zone === 'full') { for (let i = 0; i < n; i++) up[i] |= lo[i] | dr[i]; return up; }
  if (zone === 'lower') {
    if (!loN || drN > loN) for (let i = 0; i < n; i++) lo[i] |= dr[i];   // a skirt read as a dress
    return lo;
  }
  if (!upN || drN > upN) for (let i = 0; i < n; i++) up[i] |= dr[i];
  return up;
}

/**
 * One garment cut out of a parsed photo: its region (largest piece + anything close to it), edges
 * snapped to the photo, holes where arms / hair / a bag hide it left transparent (the texture fills
 * them from the fabric around).
 * @returns { cut: canvas, geometry, signature, mask, bbox }
 */
export function cutGarment(parsed, zone) {
  const { w, h, rgba, prob } = parsed;
  let mask = zoneMask(parsed, zone);
  mask = largestPieces(mask, w, h, 0.08);
  mask = snapToEdges(mask, rgba, w, h, prob);
  mask = largestPieces(mask, w, h, 0.08);
  const cut = composeCutout(rgba, w, h, mask);
  const geometry = analyzeSilhouette(cut.mask, cut.width, cut.height);
  geometry.segmentation = { method: 'segformer-clothes', coverage: cut.mask.reduce((a, v) => a + v, 0) / (cut.width * cut.height) };
  const canvas = document.createElement('canvas');
  canvas.width = cut.width; canvas.height = cut.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cut.rgba.buffer, cut.rgba.byteOffset, cut.rgba.byteLength), cut.width, cut.height), 0, 0);
  return { cut: canvas, geometry, signature: colorSignature(cut.rgba, cut.width, cut.height), mask, bbox: cut.bbox };
}

/** keep connected pieces at least `frac` of the largest one */
function largestPieces(mask, w, h, frac) {
  const n = w * h, comp = new Int32Array(n).fill(-1), sizes = [], st = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const id = sizes.length; let top = 0, cnt = 0;
    st[top++] = s; comp[s] = id;
    while (top) {
      const i = st[--top]; cnt++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && comp[i - 1] < 0) { comp[i - 1] = id; st[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && comp[i + 1] < 0) { comp[i + 1] = id; st[top++] = i + 1; }
      if (y > 0 && mask[i - w] && comp[i - w] < 0) { comp[i - w] = id; st[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && comp[i + w] < 0) { comp[i + w] = id; st[top++] = i + w; }
    }
    sizes.push(cnt);
  }
  const big = Math.max(0, ...sizes), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (comp[i] >= 0 && sizes[comp[i]] >= frac * big) out[i] = 1;
  return out;
}

/**
 * The network sees the photo at 128² logits: its boundary is ~±4 px off at 1024. Along a band around the
 * boundary, each pixel goes to whichever side its colour is closer to (the garment's colours just inside vs the
 * other side's just outside, both sampled locally), so the edge lands on the photo's real edge.
 */
function snapToEdges(mask, rgba, w, h, prob) {
  const R = Math.max(3, Math.round(Math.max(w, h) / 160));
  // distance (in px, city-block) to the boundary, both sides, up to R
  const n = w * h, dIn = new Uint8Array(n).fill(255), dOut = new Uint8Array(n).fill(255);
  const q = [];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    const m = mask[i];
    if ((x > 0 && mask[i - 1] !== m) || (x < w - 1 && mask[i + 1] !== m) || (y > 0 && mask[i - w] !== m) || (y < h - 1 && mask[i + w] !== m)) {
      (m ? dIn : dOut)[i] = 0; q.push(i);
    }
  }
  for (let head = 0; head < q.length; head++) {
    const i = q[head], x = i % w, y = (i / w) | 0, m = mask[i], D = m ? dIn : dOut, d = D[i];
    if (d >= 2 * R) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || mask[j] !== m || D[j] <= d + 1) continue;
      D[j] = d + 1; q.push(j);
    }
  }
  // local colour means: garment ring (R..2R inside), outside ring (R..2R outside), on a coarse grid
  const G = 2 * R, gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  const acc = new Float64Array(gw * gh * 8);
  for (let i = 0; i < n; i++) {
    const inRing = mask[i] && dIn[i] >= R && dIn[i] < 2 * R, outRing = !mask[i] && dOut[i] >= R && dOut[i] < 2 * R;
    if (!inRing && !outRing) continue;
    const g = (((i / w) | 0) / G | 0) * gw + ((i % w) / G | 0), o = g * 8 + (inRing ? 0 : 4);
    acc[o] += rgba[i * 4]; acc[o + 1] += rgba[i * 4 + 1]; acc[o + 2] += rgba[i * 4 + 2]; acc[o + 3]++;
  }
  const mean = (gx, gy, side) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = gx + dx, Y = gy + dy;
      if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
      const o = (Y * gw + X) * 8 + side;
      r += acc[o]; g += acc[o + 1]; b += acc[o + 2]; c += acc[o + 3];
    }
    return c > 4 ? [r / c, g / c, b / c] : null;
  };
  const out = mask.slice();
  for (let i = 0; i < n; i++) {
    if (dIn[i] >= R && dOut[i] >= R) continue;
    const gx = (i % w) / G | 0, gy = ((i / w) | 0) / G | 0;
    const A = mean(gx, gy, 0), B = mean(gx, gy, 4);
    if (!A || !B) continue;
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const da = (r - A[0]) ** 2 + (g - A[1]) ** 2 + (b - A[2]) ** 2, db = (r - B[0]) ** 2 + (g - B[1]) ** 2 + (b - B[2]) ** 2;
    const sep = (A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2;
    if (sep < 900) continue;                                  // the two sides look alike: trust the network
    out[i] = da < db ? 1 : 0;
  }
  // a pass of majority smoothing (no single-pixel speckle)
  const sm = out.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (dIn[i] >= R && dOut[i] >= R) continue;
    let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += out[i + dy * w + dx];
    sm[i] = c >= 5 ? 1 : 0;
  }
  return sm;
}

/**
 * Where a skirt's / trousers' hem falls, measured on the wearer in the photo (the AI's words are a guess;
 * this is what the photo shows): the hem's height between the garment's waist and the floor (the shoes,
 * or the bottom of the feet), as the NGL length word. null when the photo can't tell (legs cut off).
 */
export function measuredLowerLength(parsed, mask) {
  const { w, h, label } = parsed;
  let top = h, hem = -1, shoeTop = h, shoeBot = -1, legBot = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, q = label[i];
    if (mask[i]) { if (y < top) top = y; if (y > hem) hem = y; }
    if (q === 9 || q === 10) { if (y < shoeTop) shoeTop = y; if (y > shoeBot) shoeBot = y; }
    if (q === 12 || q === 13) if (y > legBot) legBot = y;
  }
  if (hem < 0) return null;
  let floor;
  if (shoeBot > 0 && shoeBot < h - 2) floor = shoeBot;                 // the soles
  else if (legBot > 0 && legBot < h - 0.02 * h && legBot > hem) floor = legBot;   // bare feet
  else return null;
  if (shoeBot > 0 && hem > shoeTop + 0.35 * (shoeBot - shoeTop)) return 'floor';
  const r = (hem - top) / Math.max(1, floor - top);
  // on a body, waist → floor: mid-thigh ≈ 0.3, knee ≈ 0.55, mid-calf ≈ 0.75, ankle ≈ 0.92
  return r < 0.2 ? 'micro' : r < 0.3 ? 'mini' : r < 0.45 ? 'above_knee' : r < 0.6 ? 'knee' : r < 0.72 ? 'below_knee'
    : r < 0.86 ? 'midi' : r < 0.97 ? 'ankle' : 'floor';
}
