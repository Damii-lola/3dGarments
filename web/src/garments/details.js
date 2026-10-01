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
