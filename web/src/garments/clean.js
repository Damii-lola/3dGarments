/**
 * The garment as it is, without what isn't part of it: the photo's garment is kept exactly (colours, print,
 * logos, seams, pockets), but
 *
 *   occluders   what lies on it or in front of it — necklaces, chains, jewellery, a bag or its strap, hands,
 *               hair, a watch, a cup, a phone — found by two AIs: the clothes-parsing model (hands, hair, bag:
 *               parse.js) and CLIPSeg (open-vocabulary segmentation: it finds whatever it is told to look for)
 *   inpainting  those areas painted back with the garment's own fabric by LaMa (big-lama, Apache-2.0), which
 *               continues prints, plaid lines and knit ribs through the gap
 *   wrinkles    the shading of folds and creases taken out (it belongs to how the garment hung on that person,
 *               not to the fabric): log-luminance split into a smooth shading layer (edge-aware, so a print's
 *               edges stay with the print) and the fabric's own colour; the cloth simulation makes our folds
 *
 * @returns { cut: canvas (RGBA, the clean garment), geometry, mask, bbox, removed: share of the garment repainted }
 */
import { AutoTokenizer, AutoProcessor, RawImage } from '@huggingface/transformers';
import { composeCutout, analyzeSilhouette } from '@shared/silhouette.js';
import { ort, modelSession } from './models.js';
import { fillFabric } from './fill.js';

const CLIPSEG = 'Xenova/clipseg-rd64-refined';
export const LAMA_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx';
const CLIPSEG_URL = `https://huggingface.co/${CLIPSEG}/resolve/main/onnx/model_quantized.onnx`;
/** what the vision model says lies on the garments (NGL "on_garment") → what CLIPSeg is told to look for */
export const PROMPTS = {
  necklace: ['a necklace', 'a chain necklace'], chain: ['a thin metal chain', 'a gold chain'], pendant: ['a pendant', 'a cross pendant'],
  bag: ['a handbag'], bag_strap: ['a bag strap', 'a shoulder strap'], hand: ['a hand', 'fingers'], bracelet: ['a bracelet', 'bangles'],
  watch: ['a wristwatch'], ring: ['a ring'], long_hair: ['long hair'], cup: ['a cup', 'a drink'], phone: ['a phone'],
  sunglasses: ['sunglasses'], scarf: ['a scarf'], belt: ['a belt'],
};
const FABRIC = ['clothing fabric', 'a printed t-shirt', 'trousers'];
/** garments worn under another, as CLIPSeg finds them */
const UNDER = { tank: ['a white tank top', 'a tank top', 'an undershirt'], top: ['a top worn underneath'], shirt: ['a shirt worn underneath'],
  sweater: ['a sweater worn underneath'], hoodie: ['a hoodie worn underneath'] };

let clip = null;
// transformers.js prepares the text and the image; the model itself runs on our onnxruntime-web (the stable
// build parse.js uses — transformers.js's own bundled runtime crashes some browsers)
function loadClip() {
  clip ||= Promise.all([AutoTokenizer.from_pretrained(CLIPSEG), AutoProcessor.from_pretrained(CLIPSEG),
    modelSession(globalThis.__clipsegUrl || CLIPSEG_URL)]).catch((e) => { clip = null; throw e; });
  return clip;
}
const loadLama = () => modelSession(globalThis.__lamaUrl || LAMA_URL);

const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** the region's holes (anything enclosed by the garment) filled: a hand or chain on it is inside it */
function fillHoles(mask, w, h) {
  const out = new Uint8Array(w * h), st = [];
  const push = (i) => { if (!mask[i] && !out[i]) { out[i] = 2; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const i = st.pop(), x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < w * h; i++) out[i] = out[i] === 2 ? 0 : 1;
  return out;
}
function dilate(m, w, h, r) {
  let a = m;
  for (let k = 0; k < r; k++) {
    const b = a.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (a[i]) continue;
      if ((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w])) b[i] = 1;
    }
    a = b;
  }
  return a;
}

/** CLIPSeg: per pixel of the crop, is it one of OCCLUDERS rather than the garment's fabric? (Uint8Array, crop size) */
async function findOccluders(crop, OCC) {
  const W = crop.width, H = crop.height, out = new Uint8Array(W * H);
  const tiles = [[0, 0, W, H]];
  const tw = Math.round(W * 0.6), th = Math.round(H * 0.6);
  for (const fy of [0, 1]) for (const fx of [0, 1]) tiles.push([fx ? W - tw : 0, fy ? H - th : 0, tw, th]);
  for (const [x0, y0, w, h] of tiles) {
    const t = canvasOf(w, h); t.getContext('2d').drawImage(crop, x0, y0, w, h, 0, 0, w, h);
    const m = await occludersIn(t, OCC);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) out[(y + y0) * W + x + x0] = 1;
  }
  return out;
}

async function occludersIn(crop, OCCLUDERS) {
  const [tok, proc, sess] = await loadClip();
  const texts = [...OCCLUDERS, ...FABRIC], n = texts.length;
  const ti = tok(texts, { padding: true, truncation: true });
  const im = new RawImage(crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data, crop.width, crop.height, 4).rgb();
  const pv = (await proc(im)).pixel_values;                      // [1, 3, 352, 352]
  const rep = new Float32Array(pv.data.length * n);
  for (let t = 0; t < n; t++) rep.set(pv.data, t * pv.data.length);
  const i64 = (x) => new ort.Tensor('int64', BigInt64Array.from(Array.from(x.data, (v) => BigInt(v))), x.dims);
  const feeds = { pixel_values: new ort.Tensor('float32', rep, [n, ...pv.dims.slice(1)]) };
  for (const k of sess.inputNames) if (k === 'input_ids') feeds.input_ids = i64(ti.input_ids); else if (k === 'attention_mask') feeds.attention_mask = i64(ti.attention_mask);
  const res = await sess.run(feeds);
  const logits = res.logits || res[sess.outputNames[0]];
  const [, S1, S2] = logits.dims, L = logits.data, sig = (v) => 1 / (1 + Math.exp(-v));
  const occ = new Float32Array(S1 * S2), fab = new Float32Array(S1 * S2);
  for (let q = 0; q < S1 * S2; q++) {
    let a = 0, f = 0;
    for (let t = 0; t < OCCLUDERS.length; t++) a = Math.max(a, sig(L[t * S1 * S2 + q]));
    for (let t = OCCLUDERS.length; t < n; t++) f = Math.max(f, sig(L[t * S1 * S2 + q]));
    occ[q] = a; fab[q] = f;
  }
  // back to crop size (bilinear), thresholded: clearly an occluder and more so than fabric
  const W = crop.width, H = crop.height, out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(S2 - 1.001, Math.max(0, ((x + 0.5) / W) * S2 - 0.5)), fy = Math.min(S1 - 1.001, Math.max(0, ((y + 0.5) / H) * S1 - 0.5));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const bl = (A) => (A[y0 * S2 + x0] * (1 - tx) + A[y0 * S2 + x0 + 1] * tx) * (1 - ty) + (A[(y0 + 1) * S2 + x0] * (1 - tx) + A[(y0 + 1) * S2 + x0 + 1] * tx) * ty;
    const a = bl(occ), f = bl(fab);
    out[y * W + x] = a > 0.45 && a > f + 0.08 ? 1 : 0;
  }
  return out;
}

/** LaMa at 512²: crop (canvas) + hole mask (crop size) → canvas with the holes painted */
export async function inpaint(crop, hole) {
  const S = 512, W = crop.width, H = crop.height;
  const s = canvasOf(S, S), sx = s.getContext('2d', { willReadFrequently: true });
  sx.drawImage(crop, 0, 0, S, S);
  const px = sx.getImageData(0, 0, S, S).data;
  const img = new Float32Array(3 * S * S), msk = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) img[c * S * S + i] = px[i * 4 + c] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) msk[y * S + x] = hole[Math.min(H - 1, ((y + 0.5) / S * H) | 0) * W + Math.min(W - 1, ((x + 0.5) / S * W) | 0)] ? 1 : 0;
  // the network must not see what it's removing: the holes blanked in its input (as LaMa was trained)
  for (let i = 0; i < S * S; i++) if (msk[i]) for (let c = 0; c < 3; c++) img[c * S * S + i] = 0;
  const sess = await loadLama();
  const [iName, mName] = sess.inputNames.includes('mask') ? ['image', 'mask'] : sess.inputNames;
  const out = await sess.run({ [iName]: new ort.Tensor('float32', img, [1, 3, S, S]), [mName]: new ort.Tensor('float32', msk, [1, 1, S, S]) });
  const ot = out[sess.outputNames[0]], o = ot.data;
  { let mn = 1e9, mxx = -1e9; for (let i = 0; i < o.length; i += 13) { mn = Math.min(mn, o[i]); mxx = Math.max(mxx, o[i]); } globalThis.__lamaDbg = { dims: ot.dims, type: ot.type, mn, mx: mxx, holes: msk.reduce((a, v) => a + v, 0) }; }
  let mx = 0; for (let i = 0; i < o.length; i += 97) mx = Math.max(mx, o[i]);
  const k = mx > 2 ? 1 : 255;
  const res = sx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { for (let c = 0; c < 3; c++) res.data[i * 4 + c] = o[c * S * S + i] * k; res.data[i * 4 + 3] = 255; }
  sx.putImageData(res, 0, 0);
  if (globalThis.__lamaDump) { const q = canvasOf(S, S), qx = q.getContext('2d'), qi = qx.createImageData(S, S); for (let i = 0; i < S * S; i++) { for (let c = 0; c < 3; c++) qi.data[i * 4 + c] = img[c * S * S + i] * 255; qi.data[i * 4 + 3] = 255; } qx.putImageData(qi, 0, 0); globalThis.__lamaDump = { input: q.toDataURL(), output: s.toDataURL() }; }
  // painted pixels only, at crop resolution; everything else stays the photo's own
  const back = canvasOf(W, H), bx = back.getContext('2d', { willReadFrequently: true });
  bx.drawImage(s, 0, 0, W, H);
  const P = bx.getImageData(0, 0, W, H), C = crop.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) if (!hole[i]) for (let c = 0; c < 4; c++) P.data[i * 4 + c] = C.data[i * 4 + c];
  bx.putImageData(P, 0, 0);
  return back;
}

/** wrinkle shading out: an edge-aware smooth layer of log-luminance (at 1/4 size) divided out, the garment's
 *  own mean kept. Prints' edges are sharp (they stay); fold shading is soft (it goes). */
function flattenWrinkles(rgba, mask, W, H, strength = 0.85) {
  const D = 4, w = Math.ceil(W / D), h = Math.ceil(H / D);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = lin(i);
  const Lf = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) Lf[i] = Math.log(1e-3 + 0.2126 * LUT[rgba[i * 4]] + 0.7152 * LUT[rgba[i * 4 + 1]] + 0.0722 * LUT[rgba[i * 4 + 2]]);
  // downsample (garment pixels only)
  const L = new Float32Array(w * h), M = new Float32Array(w * h);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!mask[i]) continue; const j = ((y / D) | 0) * w + ((x / D) | 0); L[j] += Lf[i]; M[j]++; }
  for (let j = 0; j < w * h; j++) if (M[j]) L[j] /= M[j];
  // bilateral: spatial ~ fold width (4 % of the garment's height), range 0.35 in log-luminance (a print's contrast
  // is usually larger than a fold's, so its edges aren't smoothed across)
  const rs = Math.max(2, Math.round(0.04 * h)), sr2 = 2 * 0.35 * 0.35, ss2 = 2 * (rs / 2) ** 2;
  const S = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x; if (!M[j]) continue;
    let a = 0, wsum = 0;
    for (let dy = -rs; dy <= rs; dy += 1) for (let dx = -rs; dx <= rs; dx += 1) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const k = Y * w + X; if (!M[k]) continue;
      const d = L[k] - L[j], wt = Math.exp(-(dx * dx + dy * dy) / ss2 - (d * d) / sr2);
      a += wt * L[k]; wsum += wt;
    }
    S[j] = a / wsum;
  }
  // the garment's overall level (median of the shading layer)
  const vals = []; for (let j = 0; j < w * h; j++) if (M[j]) vals.push(S[j]);
  vals.sort((p, q) => p - q);
  const mid = vals[vals.length >> 1] ?? 0;
  const toS = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!mask[i]) continue;
    // bilinear read of the shading layer
    const fx = Math.min(w - 1.001, Math.max(0, x / D - 0.5)), fy = Math.min(h - 1.001, Math.max(0, y / D - 0.5));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const at = (X, Y) => (M[Y * w + X] ? S[Y * w + X] : mid);
    const s = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    const g = Math.exp(Math.max(-0.9, Math.min(0.9, (mid - s) * strength)));
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = toS(LUT[rgba[i * 4 + c]] * g);
  }
}

/** the wearer's skin inside the garment's outline (a midriff through an open shirt, a neckline): pixels with
 *  the chroma of the person's own skin (sampled from the face / arms / legs the parsing model found), unless the
 *  garment itself is that colour */
function skinIn(parsed, bx, by, W, H, sil, gm) {
  const { w: PW, rgba, label } = parsed;
  const SK = new Set([11, 12, 13, 14, 15]);
  const ch = (i) => { const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], s = r + g + b + 1; return [r / s, g / s, s / 3]; };
  let n = 0, mr = 0, mg = 0; const rs = [], gs = [];
  for (let i = 0; i < label.length; i += 3) if (SK.has(label[i])) { const [r, g] = ch(i); rs.push(r); gs.push(g); }
  if (rs.length < 200) return null;
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  mr = med(rs.slice()); mg = med(gs.slice());
  const mad = (a, m) => med(a.map((v) => Math.abs(v - m))) * 1.48 + 0.004;
  const sr = mad(rs, mr), sg = mad(gs, mg);
  const ls = []; for (let i = 0; i < label.length; i += 3) if (SK.has(label[i])) ls.push(ch(i)[2]);
  const ml = med(ls);
  // skin: its chroma, clearly coloured (not a grey / black / white thread), near the person's own brightness
  const isSkin = (i) => {
    const R = rgba[i * 4], G = rgba[i * 4 + 1], B = rgba[i * 4 + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mx < 30 || (mx - mn) / mx < 0.18) return false;
    const [r, g, l] = ch(i);
    return l > ml * 0.45 && l < ml * 1.9 && ((r - mr) / sr) ** 2 + ((g - mg) / sg) ** 2 < 3;
  };
  // a skin-coloured garment (nude, beige): most of it matches — then nothing is taken (an open shirt showing a
  // midriff can be a third skin inside its outline and still isn't skin-coloured)
  let gin = 0, gsk = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (gm[y * W + x]) { gin++; if (isSkin((y + by) * PW + x + bx)) gsk++; }
  if (gsk > 0.6 * gin) return null;
  const raw = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (sil[i] && isSkin((y + by) * PW + x + bx)) raw[i] = 1; }
  // solid patches only (≥ 0.4 % of the garment): skin, not speckle in a pattern
  const out = new Uint8Array(W * H), seen = new Uint8Array(W * H), min = 0.004 * sil.reduce((a, v) => a + v, 0);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!raw[s0] || seen[s0]) continue;
    const comp = [s0], st = [s0]; seen[s0] = 1;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && raw[j] && !seen[j]) { seen[j] = 1; st.push(j); comp.push(j); }
    }
    if (comp.length >= min) for (const i of comp) { out[i] = 1; n++; }
  }
  return out;
}

/** thin jewellery (a chain, a necklace's strands) the segmenter sees too coarsely: in the garment's upper half,
 *  thin long lines whose COLOUR differs from the fabric around them (a knit's ribs or a plaid's lines differ in
 *  brightness, not colour, and aren't taken) */
export function thinJewellery(px, sil, W, H) {
  const Y = new Float32Array(W * H), Cb = new Float32Array(W * H), Cr = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b; Cb[i] = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b; Cr[i] = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
  }
  // the fabric around each pixel: box mean of garment pixels (radius ~4 % of the height)
  const R = Math.max(4, Math.round(H * 0.04));
  const box = (A) => {
    const I = new Float64Array((W + 1) * (H + 1)), C = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y + 1) * (W + 1) + x + 1, m = sil[y * W + x];
      I[k] = (m ? A[y * W + x] : 0) + I[k - 1] + I[k - W - 1] - I[k - W - 2]; C[k] = m + C[k - 1] + C[k - W - 1] - C[k - W - 2];
    }
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      const f = (A2) => A2[y1 * (W + 1) + x1] - A2[y0 * (W + 1) + x1] - A2[y1 * (W + 1) + x0] + A2[y0 * (W + 1) + x0];
      out[y * W + x] = f(I) / Math.max(1, f(C));
    }
    return out;
  };
  // white top-hat: brightness minus its opening (min then max over a small disc) — what's left are features
  // narrower than the disc and BRIGHTER than around them: a chain, a necklace's strands (a rib, a seam, a fold's
  // shadow is darker, and isn't)
  const r = Math.max(2, Math.round(H / 140));
  const filt = (A, fn) => {
    const t = new Float32Array(W * H), o = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = A[y * W + x]; for (let d = -r; d <= r; d++) { const X = x + d; if (X >= 0 && X < W) v = fn(v, A[y * W + X]); } t[y * W + x] = v; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = t[y * W + x]; for (let d = -r; d <= r; d++) { const Yy = y + d; if (Yy >= 0 && Yy < H) v = fn(v, t[Yy * W + x]); } o[y * W + x] = v; }
    return o;
  };
  const opened = filt(filt(Y, Math.min), Math.max);
  const mb = box(Cb), mr = box(Cr);
  // not at the garment's own edge (its outline is a brightness step too)
  const inner = new Uint8Array(W * H), e = 2;
  for (let y = e; y < H - e; y++) for (let x = e; x < W - e; x++) {
    let ok = 1;
    for (let d = -e; d <= e && ok; d += e) for (let q = -e; q <= e; q += e) if (!sil[(y + d) * W + x + q]) { ok = 0; break; }
    inner[y * W + x] = ok;
  }
  let top = H, bot = 0;
  for (let i = 0; i < W * H; i++) if (sil[i]) { const y = (i / W) | 0; if (y < top) top = y; if (y > bot) bot = y; }
  const yMax = top + 0.55 * (bot - top);
  const out0 = new Uint8Array(W * H);
  for (let y = top; y <= yMax; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    // …and another colour than the fabric around it (a knit's ridge or a fold's highlight is the fabric's own hue)
    if (inner[i] && Y[i] - opened[i] > 16 && Math.hypot(Cb[i] - mb[i], Cr[i] - mr[i]) > 6) out0[i] = 1;
  }
  // hysteresis: a strand continues where it's fainter (connected to a sure one, still brighter and a little off
  // the fabric's colour)
  const weak = (i) => inner[i] && Y[i] - opened[i] > 9 && Math.hypot(Cb[i] - mb[i], Cr[i] - mr[i]) > 4.5;
  { const st = []; for (let i = 0; i < W * H; i++) if (out0[i]) st.push(i);
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Yy = y + dy; if (X < 0 || Yy < 0 || X >= W || Yy >= H) continue;
        const j = Yy * W + X; if (!out0[j] && Yy <= yMax + 0.1 * (bot - top) && weak(j)) { out0[j] = 1; st.push(j); }
      }
    } }
  // thin, long pieces only
  const out = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!out0[s0] || seen[s0]) continue;
    const comp = [s0], st = [s0]; seen[s0] = 1; let x0 = W, x1 = 0, y0 = H, y1 = 0;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Yy = y + dy; if (X < 0 || Yy < 0 || X >= W || Yy >= H) continue;
        const j = Yy * W + X; if (out0[j] && !seen[j]) { seen[j] = 1; st.push(j); comp.push(j); }
      }
    }
    const len = Math.hypot(x1 - x0, y1 - y0);
    // a necklace hangs in a curve or runs across; a straight vertical line is the fabric's own (a rib, a seam, a fold)
    const vertical = (x1 - x0) < 0.18 * (y1 - y0);
    if (!vertical && len > 0.05 * H && comp.length / len < Math.max(3, 0.014 * H)) for (const i of comp) out[i] = 1;
  }
  return out;
}

/** a garment worn under this one, seen through its open front (a tank in an open shirt), without CLIPSeg: the
 *  garment's colours clustered (k-means, Lab), thin lines opened away (a plaid's white lines aren't a tank), and a
 *  solid region of one colour that runs down the centre front from the neckline — where an open front shows what's
 *  under it — taken (a print's letters sit beside the centre, not down it from the neck) */
export function underIn(px, sil, W, H) {
  const lab = (i) => {
    const f = (v) => { v /= 255; v = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return v; };
    const r = f(px[i * 4]), g = f(px[i * 4 + 1]), b = f(px[i * 4 + 2]);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
  };
  const idx = []; for (let i = 0; i < W * H; i++) if (sil[i]) idx.push(i);
  if (idx.length < 500) return null;
  const L = new Float32Array(W * H * 3);
  for (const i of idx) { const c = lab(i); L[i * 3] = c[0]; L[i * 3 + 1] = c[1]; L[i * 3 + 2] = c[2]; }
  // k-means, k = 5, on a sample
  const K = 5, smp = idx.filter((_, n) => n % Math.max(1, Math.floor(idx.length / 6000)) === 0);
  const C = []; for (let k = 0; k < K; k++) { const i = smp[Math.floor((k + 0.5) / K * smp.length)]; C.push([L[i * 3], L[i * 3 + 1], L[i * 3 + 2]]); }
  const near = (i) => { let b = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = (L[i * 3] - C[k][0]) ** 2 + (L[i * 3 + 1] - C[k][1]) ** 2 + (L[i * 3 + 2] - C[k][2]) ** 2; if (d < bd) { bd = d; b = k; } } return b; };
  for (let it = 0; it < 8; it++) {
    const acc = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (const i of smp) { const k = near(i), a = acc[k]; a[0] += L[i * 3]; a[1] += L[i * 3 + 1]; a[2] += L[i * 3 + 2]; a[3]++; }
    for (let k = 0; k < K; k++) if (acc[k][3]) C[k] = [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]];
  }
  const lab8 = new Int8Array(W * H).fill(-1); for (const i of idx) lab8[i] = near(i);
  let top = H, bot = 0, x0 = W, x1 = 0;
  for (const i of idx) { const x = i % W, y = (i / W) | 0; if (y < top) top = y; if (y > bot) bot = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  const gh = bot - top, cxm = (x0 + x1) / 2, r = Math.max(3, Math.round(gh / 60));
  let best = null;
  for (let k = 0; k < K; k++) {
    let m = new Uint8Array(W * H); for (const i of idx) if (lab8[i] === k) m[i] = 1;
    // opening: erode then dilate by r (thin lines gone, solid regions back to their size)
    const er = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let ok = m[y * W + x]; for (let d = -r; d <= r && ok; d++) { const X = x + d, Y = y + d; if (X < 0 || X >= W || !m[y * W + X] || Y < 0 || Y >= H || !m[Y * W + x]) ok = 0; }
      er[y * W + x] = ok;
    }
    m = dilate(er, W, H, r);
    // the component on the centre front, just under the neckline
    let seed = -1;
    for (let y = top; y < top + 0.3 * gh && seed < 0; y++) for (let dx = -Math.round(0.04 * W); dx <= Math.round(0.04 * W); dx++) { const i = y * W + Math.round(cxm + dx); if (m[i] && sil[i]) { seed = i; break; } }
    if (seed < 0) continue;
    const comp = [seed], seen = new Uint8Array(W * H), st = [seed]; seen[seed] = 1;
    while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && m[j] && sil[j] && !seen[j]) { seen[j] = 1; st.push(j); comp.push(j); } }
    // tall down the centre (≥ 30 % of the garment's height), a modest share (3–35 %), and narrower than the garment
    let cy0 = H, cy1 = 0, cxa = W, cxb = 0; for (const i of comp) { const x = i % W, y = (i / W) | 0; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; if (x < cxa) cxa = x; if (x > cxb) cxb = x; }
    const share = comp.length / idx.length;
    if (cy1 - cy0 < 0.3 * gh || share < 0.03 || share > 0.35 || cxb - cxa > 0.6 * (x1 - x0)) continue;
    // and not the garment's own main colour
    let own = 0; for (const i of idx) if (lab8[i] === k) own++;
    if (own > 0.45 * idx.length) continue;
    if (!best || comp.length > best.length) best = comp;
  }
  if (!best) return null;
  const out = new Uint8Array(W * H); for (const i of best) out[i] = 1;
  return out;
}

/**
 * @param parsed  parsePhoto() result (the whole photo)
 * @param cut     cutGarment() result for this garment
 * @param opts    { onGarment: NGL on_garment words (what the vision model saw on the garments), under: the other garments
 *                  the vision model saw in this zone (a tank under an open shirt: an opening, never this garment's fabric),
 *                  wrinkles: true, onStep,
 *                  search: CLIPSeg looks for what the vision model named (139 MB model, seconds per prompt) — off in the app:
 *                    the clothes parser already finds hands / arms / hair / bags, the jewellery detector chains,
 *                  painter: 'patch' (fill.js, PatchMatch: instant) | 'lama' (LaMa: 208 MB, ~10× slower) }
 */
export async function cleanGarment(parsed, cut, { onGarment = [], under = [], occluders = true, wrinkles = true, search = false, painter = 'patch', onStep = () => {} } = {}) {
  const { w: PW, h: PH, rgba, label } = parsed;
  const { x: bx, y: by, w: W, h: H } = cut.bbox;
  // the garment's full silhouette (its holes are things on it) and the photo crop around it
  const gm = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gm[y * W + x] = cut.mask[(y + by) * PW + (x + bx)];
  const sil = fillHoles(gm, W, H);
  const crop = canvasOf(W, H), cx = crop.getContext('2d', { willReadFrequently: true });
  const cd = cx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((y + by) * PW + (x + bx)) * 4, d = (y * W + x) * 4; for (let c = 0; c < 4; c++) cd.data[d + c] = c === 3 ? 255 : rgba[s + c]; }
  cx.putImageData(cd, 0, 0);

  let hole = new Uint8Array(W * H), removed = 0;
  const opening = new Uint8Array(W * H);            // not garment at all (an open front): cut out, not painted
  const offGarment = new Uint8Array(W * H);         // an occluder's part outside the garment: painted over too, so the painter can't continue it
  if (occluders) {
    // the parsing model's hands / arms / hair / face / bag / sunglasses inside the silhouette
    const OCC = new Set([2, 3, 11, 14, 15, 16]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!sil[i]) continue;
      if (!gm[i] || OCC.has(label[(y + by) * PW + (x + bx)])) hole[i] = 1;
    }
    // the wearer's skin inside the outline: a patch reaching the garment's edge is an OPENING (an open shirt's
    // front, a cut-out) — taken out of the garment; one enclosed by fabric is covered skin — painted over
    const openOrPaint = (m) => {
      const seen = new Uint8Array(W * H);
      for (let s0 = 0; s0 < W * H; s0++) {
        if (!m[s0] || seen[s0] || !sil[s0]) continue;
        const comp = [s0], st = [s0]; seen[s0] = 1; let edge = false;
        while (st.length) {
          const i = st.pop(), x = i % W, y = (i / W) | 0;
          for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
            if (j < 0 || !sil[j]) { edge = true; continue; }
            if (m[j] && !seen[j]) { seen[j] = 1; st.push(j); comp.push(j); }
          }
        }
        for (const i of comp) if (edge) opening[i] = 1; else hole[i] = 1;
      }
    };
    const sk = skinIn(parsed, bx, by, W, H, sil, gm);
    if (sk) openOrPaint(sk);
    // another garment seen through this one (a tank top in an open shirt's front): the same — an opening where it
    // reaches the edge, painted over where fabric encloses it. Whatever is on it (a pendant) goes with it
    if (!search && under.length) {
      const u = underIn(cx.getImageData(0, 0, W, H).data, sil, W, H);
      if (u) openOrPaint(dilate(u, W, H, Math.max(2, Math.round(Math.max(W, H) / 150))));
    }
    if (search && under.length) {
      onStep(`Separating the ${under.join(', ')} underneath…`);
      try {
        const u = await findOccluders(crop, under.flatMap((t) => UNDER[t] || [`a ${t.replace(/_/g, ' ')}`]));
        let n = 0; for (let i = 0; i < W * H; i++) if (u[i] && sil[i]) n++;
        // a reading that takes most of the garment is the garment itself (the words are close): ignored
        if (n > 20 && n < 0.35 * sil.reduce((a, v) => a + v, 0)) openOrPaint(dilate(u, W, H, Math.max(2, Math.round(Math.max(W, H) / 150))));
      } catch (e) { console.warn('CLIPSeg unavailable:', e.message); }
    }
    if (onGarment.some((w) => /necklace|chain|pendant/.test(w))) {
      // a necklace is taken with a band around it: LaMa continues any bit of a strand it can still see
      const j = dilate(thinJewellery(cx.getImageData(0, 0, W, H).data, sil, W, H), W, H, Math.max(4, Math.round(H / 60)));
      for (let i = 0; i < W * H; i++) if (j[i]) { hole[i] = 1; }
    }
    const prompts = search ? [...new Set(onGarment.flatMap((w) => PROMPTS[w] || []))] : [];
    if (prompts.length) {
      onStep(`Looking for the ${onGarment.join(', ').replace(/_/g, ' ')} on the garment…`);
      try {
        // thin things (a chain) have soft edges the painter would continue: taken a little wider
        const o = dilate(await findOccluders(crop, prompts), W, H, Math.max(2, Math.round(Math.max(W, H) / 120)));
        for (let i = 0; i < W * H; i++) if (o[i]) { hole[i] = 1; offGarment[i] = !sil[i]; }
      } catch (e) { console.warn('CLIPSeg unavailable:', e.message); }
    }
    hole = dilate(hole, W, H, Math.max(2, Math.round(Math.max(W, H) / 200)));
    for (let i = 0; i < W * H; i++) { if (!sil[i] && !offGarment[i]) hole[i] = 0; else if (hole[i] && sil[i]) removed++; }
    if (removed > 20) {
      onStep('Painting the fabric back where they were…');
      try {
        // the painter sees only the garment: everything outside it (skin, background, the rest of a necklace
        // running over the neck) is replaced by the garment's own colours grown outward — nothing there to continue
        const ctxImg = cx.getImageData(0, 0, W, H), d = ctxImg.data;
        const known = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) known[i] = sil[i] && !hole[i] ? 1 : 0;
        let front = [];
        for (let i = 0; i < W * H; i++) if (!known[i]) { const x = i % W, y = (i / W) | 0; if ((x > 0 && known[i - 1]) || (x < W - 1 && known[i + 1]) || (y > 0 && known[i - W]) || (y < H - 1 && known[i + W])) front.push(i); }
        const queued = new Uint8Array(W * H); for (const i of front) queued[i] = 1;
        while (front.length) {
          const next = [], done = [];
          for (const i of front) {
            const x = i % W, y = (i / W) | 0; let r = 0, g = 0, b = 0, k = 0;
            for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && known[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; k++; }
            if (!k) continue;
            if (!sil[i]) { d[i * 4] = r / k; d[i * 4 + 1] = g / k; d[i * 4 + 2] = b / k; }
            done.push(i);
            for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !known[j] && !queued[j]) { queued[j] = 1; next.push(j); }
          }
          for (const i of done) known[i] = 1;
          front = next;
        }
        const context = canvasOf(W, H); context.getContext('2d').putImageData(ctxImg, 0, 0);
        let P;
        if (painter === 'lama') P = (await inpaint(context, hole)).getContext('2d').getImageData(0, 0, W, H).data;
        else P = fillFabric(ctxImg.data, W, H, hole, sil);
        // only the garment's painted pixels are taken back
        const C = cx.getImageData(0, 0, W, H);
        for (let i = 0; i < W * H; i++) if (hole[i] && sil[i]) for (let c = 0; c < 3; c++) C.data[i * 4 + c] = P[i * 4 + c];
        cx.putImageData(C, 0, 0);
      } catch (e) { console.warn('LaMa unavailable:', e.message); removed = 0; }
    }
  }
  // openings leave the garment (a little grown, so no rim of skin stays)
  const op = dilate(opening, W, H, 2);
  for (let i = 0; i < W * H; i++) if (op[i]) sil[i] = 0;
  // the clean garment: the whole silhouette, from the (painted) crop
  const px = cx.getImageData(0, 0, W, H).data;
  if (wrinkles) { onStep('Smoothing out the wrinkles…'); flattenWrinkles(px, sil, W, H); }
  const comp = composeCutout(px, W, H, sil);
  const geometry = analyzeSilhouette(comp.mask, comp.width, comp.height);
  const out = canvasOf(comp.width, comp.height);
  out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(comp.rgba.buffer, comp.rgba.byteOffset, comp.rgba.byteLength), comp.width, comp.height), 0, 0);
  const fullMask = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sil[y * W + x]) fullMask[(y + by) * PW + (x + bx)] = 1;
  return { cut: out, geometry, mask: fullMask, bbox: { x: bx + comp.bbox.x, y: by + comp.bbox.y, w: comp.width, h: comp.height },
    removed: removed / Math.max(1, sil.reduce((a, v) => a + v, 0)), hole, crop };
}


/** who wears the clothes, from the photo itself: CLIPSeg's "a man" vs "a woman" over the person (every pixel
 *  the clothes-parsing model didn't call background) → 'male' | 'female' | null (too close to call) */
export async function wearerSex(parsed) {
  const { w, h, label, canvas } = parsed;
  const [tok, proc, sess] = await loadClip();
  const texts = ['a man', 'a woman', "a man's body", "a woman's body"], n = texts.length;
  const ti = tok(texts, { padding: true, truncation: true });
  const im = new RawImage(canvas.getContext('2d').getImageData(0, 0, w, h).data, w, h, 4).rgb();
  const pv = (await proc(im)).pixel_values;
  const rep = new Float32Array(pv.data.length * n);
  for (let t = 0; t < n; t++) rep.set(pv.data, t * pv.data.length);
  const i64 = (x) => new ort.Tensor('int64', BigInt64Array.from(Array.from(x.data, (v) => BigInt(v))), x.dims);
  const feeds = { pixel_values: new ort.Tensor('float32', rep, [n, ...pv.dims.slice(1)]) };
  for (const k of sess.inputNames) if (k === 'input_ids') feeds.input_ids = i64(ti.input_ids); else if (k === 'attention_mask') feeds.attention_mask = i64(ti.attention_mask);
  const res = await sess.run(feeds), L = (res.logits || res[sess.outputNames[0]]);
  const [, S1, S2] = L.dims, d = L.data;
  let m = 0, f = 0, c = 0;
  for (let y = 0; y < S1; y++) for (let x = 0; x < S2; x++) {
    const px = Math.min(w - 1, ((x + 0.5) / S2 * w) | 0), py = Math.min(h - 1, ((y + 0.5) / S1 * h) | 0);
    if (!label[py * w + px]) continue;
    const q = y * S2 + x, P = S1 * S2;
    m += d[q] + d[2 * P + q]; f += d[P + q] + d[3 * P + q]; c++;
  }
  if (!c) return null;
  const diff = (m - f) / (2 * c);                  // mean logit difference
  return diff > 0.15 ? 'male' : diff < -0.15 ? 'female' : null;
}
