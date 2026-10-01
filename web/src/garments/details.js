/**
 * The garment's details, measured on the photo where the detail sheet (POST /api/ngl/details: the vision model, in
 * words) says they are — the model reads WHAT a garment has well, WHERE badly, so positions come from the pixels.
 *
 *   findButtons(parsed, mask, count) → [{ x, y, r, color }] in the parsed photo's pixels
 *     round spots of button size that stand out from the fabric around them, in a vertical line (a placket); the
 *     detail sheet's count picks how many (the clearest)
 */

export function findButtons(parsed, mask, count = 0, { buttonColor = null, mainColor = null } = {}) {
  const { w, h, rgba } = parsed;
  if (!count) return [];
  let top = h, bot = 0, left = w, right = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) { const x = i % w, y = (i / w) | 0; if (y < top) top = y; if (y > bot) bot = y; if (x < left) left = x; if (x > right) right = x; }
  const gh = bot - top, gw = right - left;
  if (gh < 50) return [];
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  // the fabric around each pixel: mean brightness of garment pixels in a box (~3 % of the garment's height)
  const R = Math.max(4, Math.round(gh * 0.03)), I = new Float64Array((w + 1) * (h + 1)), C = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y + 1) * (w + 1) + x + 1, m = mask[y * w + x] ? 1 : 0;
    I[k] = L[y * w + x] * m + I[k - 1] + I[k - w - 1] - I[k - w - 2]; C[k] = m + C[k - 1] + C[k - w - 1] - C[k - w - 2];
  }
  const box = (A, x0, y0, x1, y1) => A[y1 * (w + 1) + x1] - A[y0 * (w + 1) + x1] - A[y1 * (w + 1) + x0] + A[y0 * (w + 1) + x0];
  const hit = new Uint8Array(w * h);
  // lighter or darker than the fabric: the detail sheet's button colour against the garment's (light by default)
  const lum = (hx) => { const v = parseInt(hx.slice(1), 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255); };
  const pol = buttonColor && mainColor && lum(buttonColor) < lum(mainColor) ? -1 : 1;
  for (let y = top; y <= bot; y++) for (let x = left; x <= right; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const n = box(C, x0, y0, x1, y1);
    if (n < 10) continue;
    if (pol * (L[i] - box(I, x0, y0, x1, y1) / n) > 38) hit[i] = 1;
  }
  // a top-hat: what's still there after an opening the size of a big button is a large region (a tee seen through
  // an open front, a print) — taken away; buttons beside it stay as the bumps on its edge
  {
    const r = Math.max(2, Math.round(gh * 0.016));
    const filt = (src, keepAll) => {                       // separable square min (erode) / max (dilate)
      const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = keepAll ? 1 : 0;
        for (let q = -r; q <= r; q++) { const X = x + q, a = X >= 0 && X < w ? src[y * w + X] : 0; if (keepAll ? !a : a) { v = keepAll ? 0 : 1; break; } }
        t[y * w + x] = v;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = keepAll ? 1 : 0;
        for (let q = -r; q <= r; q++) { const Y = y + q, a = Y >= 0 && Y < h ? t[Y * w + x] : 0; if (keepAll ? !a : a) { v = keepAll ? 0 : 1; break; } }
        o[y * w + x] = v;
      }
      return o;
    };
    const opened = filt(filt(hit, true), false);
    for (let i = 0; i < w * h; i++) if (opened[i]) hit[i] = 0;
  }
  // round blobs of button size
  const rMin = gh * 0.004, rMax = gh * 0.03, seen = new Uint8Array(w * h), blobs = [];
  for (let s = 0; s < w * h; s++) {
    if (!hit[s] || seen[s]) continue;
    const st = [s], comp = [s]; seen[s] = 1;
    while (st.length) {
      const i = st.pop(), x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && hit[j] && !seen[j]) { seen[j] = 1; st.push(j); comp.push(j); }
    }
    if (comp.length < Math.PI * rMin * rMin || comp.length > Math.PI * rMax * rMax) continue;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0, cr = 0, cg = 0, cb = 0;
    for (const i of comp) {
      const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      sx += x; sy += y; cr += rgba[i * 4]; cg += rgba[i * 4 + 1]; cb += rgba[i * 4 + 2];
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, fill = comp.length / (bw * bh);
    if (fill < 0.55 || bw / bh < 0.6 || bw / bh > 1.65) continue;
    const n = comp.length;
    blobs.push({ x: sx / n, y: sy / n, r: Math.sqrt(n / Math.PI), color: [cr / n, cg / n, cb / n], size: n });
  }
  if (!blobs.length) return [];
  // the placket: the vertical line holding the most of them (within 2.5 % of the garment's width)
  let best = [];
  for (const b of blobs) {
    const line = blobs.filter((o) => Math.abs(o.x - b.x) < gw * 0.025);
    if (line.length > best.length || (line.length === best.length && line.reduce((s, o) => s + o.size, 0) > best.reduce((s, o) => s + o.size, 0))) best = line;
  }
  if (best.length < Math.min(2, count)) return [];
  // the same size, more or less: buttons on a placket match
  const rm = best.map((b) => b.r).sort((a, b) => a - b)[best.length >> 1];
  best = best.filter((b) => b.r > rm * 0.6 && b.r < rm * 1.6).sort((a, b) => a.y - b.y);
  return best.slice(0, Math.max(count, best.length <= count + 1 ? best.length : count));
}

/**
 * A close-up photo of a button (shops add one): the button itself, cut out as the 3D buttons' face — its real colour,
 * holes, thread and sheen instead of a drawn one. The roundest big spot that stands out from what's around it.
 *   buttonFace(image) → { canvas (128², the face filling it), color: [r, g, b], r: its radius as a share of the photo's
 *   width } | null
 */
export function buttonFace(image) {
  const k = Math.min(1, 640 / Math.max(image.width, image.height)), w = Math.round(image.width * k), h = Math.round(image.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(image, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  // local contrast: brighter or darker than the box around it (≈ 2 button radii)
  const R = Math.round(w * 0.06), I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const q = (y + 1) * (w + 1) + xx + 1; I[q] = L[y * w + xx] + I[q - 1] + I[q - w - 1] - I[q - w - 2]; }
  const mean = (x0, y0, x1, y1) => (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / Math.max(1, (x1 - x0) * (y1 - y0));
  let best = null;
  for (const pol of [1, -1]) {
    const hit = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const m = mean(Math.max(0, xx - R), Math.max(0, y - R), Math.min(w, xx + R + 1), Math.min(h, y + R + 1));
      if (pol * (L[y * w + xx] - m) > 28) hit[y * w + xx] = 1;
    }
    const seen = new Uint8Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!hit[s] || seen[s]) continue;
      const st = [s], comp = []; seen[s] = 1;
      while (st.length) {
        const i = st.pop(); comp.push(i);
        const X = i % w, Y = (i / w) | 0;
        for (const j of [X > 0 ? i - 1 : -1, X < w - 1 ? i + 1 : -1, Y > 0 ? i - w : -1, Y < h - 1 ? i + w : -1]) if (j >= 0 && hit[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
      let x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0;
      for (const i of comp) { const X = i % w, Y = (i / w) | 0; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); sx += X; sy += Y; }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, r = (bw + bh) / 4;
      // a button: round (a filled disc, holes and all, fills ≥ 60 % of its box), 1.5 … 15 % of the photo across,
      // not touching the photo's edge (text, icons, a cut-off shape)
      if (r < w * 0.015 || r > w * 0.15 || bw / bh < 0.75 || bw / bh > 1.33 || x0 < 2 || y0 < 2 || x1 > w - 3 || y1 > h - 3) continue;
      const fill = comp.length / (Math.PI * r * r);
      if (fill < 0.6 || fill > 1.15) continue;
      const score = r * fill;
      if (!best || score > best.score) best = { score, cx: sx / comp.length, cy: sy / comp.length, r };
    }
  }
  if (!best) return null;
  // the face: the disc a little inside its outline (the outline's shadow stays on the fabric)
  const out = document.createElement('canvas'); out.width = out.height = 128;
  const o = out.getContext('2d', { willReadFrequently: true }), rr = best.r * 0.97 / k;
  o.drawImage(image, best.cx / k - rr, best.cy / k - rr, rr * 2, rr * 2, 0, 0, 128, 128);
  const d = o.getImageData(0, 0, 128, 128).data;
  let cr = 0, cg = 0, cb = 0, n = 0;
  for (let y = 0; y < 128; y++) for (let xx = 0; xx < 128; xx++) if ((xx - 63.5) ** 2 + (y - 63.5) ** 2 < 50 ** 2) { const i = (y * 128 + xx) * 4; cr += d[i]; cg += d[i + 1]; cb += d[i + 2]; n++; }
  return { canvas: out, color: [cr / n, cg / n, cb / n], r: best.r / w };
}
