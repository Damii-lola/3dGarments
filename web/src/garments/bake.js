/**
 * The garment's texture, baked in pattern space: every panel gets its own area of the atlas at its real
 * size (the UVs ARE the flat pattern, so the fabric's grain, stripes and knit ribs run the way they were
 * cut), and every texel is filled from the photos:
 *
 *   photo   where the garment shows in the photo: the texel's point on the draped garment, seen from the
 *           front (back photo: from behind), lands on the photo — prints, logos, pockets, seams, exactly
 *           where they are. Only well inside the cut-out (never its rim: that's backdrop / skin / arm).
 *   fabric  everywhere the photo can't see (the back without a back photo, the sides, a sleeve behind an
 *           arm, a hem out of frame): the garment's own fabric, a clean patch cut from the photo (the most
 *           typical, print-free square), repeated at the photo's real scale along the panel's grain.
 *
 * The two blend over a few pixels, so there is no line where the photo ends.
 */
import { prepareFabric } from './fabric.js';
import { makeCollider } from './cloth.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** city-block-ish (3-4 chamfer) distance, in pixels, from each opaque pixel to the nearest transparent one */
function insideDistance(data, w, h) {
  const D = new Float32Array(w * h), INF = 1e6;
  for (let i = 0; i < w * h; i++) D[i] = data[i * 4 + 3] > 128 ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!D[i]) continue;
    let d = D[i];
    if (x > 0) d = Math.min(d, D[i - 1] + 1); else d = Math.min(d, 1);
    if (y > 0) { d = Math.min(d, D[i - w] + 1); if (x > 0) d = Math.min(d, D[i - w - 1] + 1.414); if (x < w - 1) d = Math.min(d, D[i - w + 1] + 1.414); } else d = Math.min(d, 1);
    D[i] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!D[i]) continue;
    let d = D[i];
    if (x < w - 1) d = Math.min(d, D[i + 1] + 1); else d = Math.min(d, 1);
    if (y < h - 1) { d = Math.min(d, D[i + w] + 1); if (x < w - 1) d = Math.min(d, D[i + w + 1] + 1.414); if (x > 0) d = Math.min(d, D[i + w - 1] + 1.414); } else d = Math.min(d, 1);
    D[i] = d;
  }
  return D;
}

/** the photo's garment: top/bottom rows, and its centre + width over a band of heights (fractions) */
function photoFrame(ph, D, band) {
  const { w, h } = ph;
  let top = h, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (D[y * w + x] > 0) { if (y < top) top = y; bottom = y; break; }
  // per row in the band: the widest run (the torso / the waist, not a sleeve or a hand)
  const cs = [], ws = [];
  for (let y = Math.round(top + band[0] * (bottom - top)); y <= top + band[1] * (bottom - top); y++) {
    let best = null, x = 0;
    while (x < w) {
      while (x < w && !D[y * w + x]) x++;
      const s = x; while (x < w && D[y * w + x]) x++;
      if (x > s && (!best || x - s > best[1] - best[0])) best = [s, x];
    }
    if (best) { cs.push((best[0] + best[1]) / 2); ws.push(best[1] - best[0]); }
  }
  const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
  return { top, bottom, cx: med(cs), width: med(ws) };
}

/** the garment's most typical clean square of fabric (no print, no rim), in photo pixels */
function fabricPatch(ph, D) {
  const { w, h, data } = ph;
  // the garment's dominant colour: median of the well-inside pixels
  const rs = [], gs = [], bs = [];
  for (let i = 0; i < w * h; i += 7) if (D[i] > 4) { rs.push(data[i * 4]); gs.push(data[i * 4 + 1]); bs.push(data[i * 4 + 2]); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1] ?? 128;
  const dom = [med(rs), med(gs), med(bs)];
  let maxW = 0; for (let i = 0; i < w * h; i++) maxW = Math.max(maxW, D[i]);
  for (let side = Math.round(Math.min(220, Math.max(24, maxW * 0.9))); side >= 12; side = Math.round(side * 0.75)) {
    const r = side * 0.72, cands = [];
    for (let y = Math.ceil(side / 2); y < h - side / 2; y += Math.max(2, side >> 2)) for (let x = Math.ceil(side / 2); x < w - side / 2; x += Math.max(2, side >> 2)) {
      if (D[y * w + x] < r) continue;
      // score: mean colour distance to the dominant colour + the share of pixels far off it (a print, a
      // logo, a chain, a seam: the patch repeats, so anything unusual in it would repeat too)
      let sd = 0, n = 0, off = 0;
      const st = Math.max(1, side >> 5);
      for (let yy = y - side / 2; yy < y + side / 2; yy += st) for (let xx = x - side / 2; xx < x + side / 2; xx += st) {
        const i = (Math.round(yy) * w + Math.round(xx)) * 4;
        const d = Math.hypot(data[i] - dom[0], data[i + 1] - dom[1], data[i + 2] - dom[2]);
        sd += d; if (d > 70) off++; n++;
      }
      cands.push({ x, y, s: sd / n + 400 * (off / n) });
    }
    if (cands.length) { const b = cands.sort((p, q) => p.s - q.s)[0]; return { x0: b.x - side / 2, y0: b.y - side / 2, side }; }
  }
  return null;
}

/** shelf-pack panels (metres) → texel rectangles */
function pack(boxes, maxW = 2048, maxH = 2048) {
  for (let ppm = 1000; ppm > 50; ppm *= 0.9) {
    const pad = 6, rects = [];
    let x = pad, y = pad, rowH = 0, W = 0;
    const order = boxes.map((b, i) => i).sort((a, b) => (boxes[b].h - boxes[a].h));
    let ok = true;
    for (const i of order) {
      const bw = Math.ceil(boxes[i].w * ppm) + 2, bh = Math.ceil(boxes[i].h * ppm) + 2;
      if (bw + 2 * pad > maxW) { ok = false; break; }
      if (x + bw + pad > maxW) { x = pad; y += rowH + pad; rowH = 0; }
      rects[i] = { x, y, w: bw, h: bh };
      x += bw + pad; rowH = Math.max(rowH, bh); W = Math.max(W, x);
    }
    const H = y + rowH + pad;
    if (ok && H <= maxH) return { rects, ppm, W: Math.min(maxW, 1 << Math.ceil(Math.log2(W))), H: 1 << Math.ceil(Math.log2(H)) };
  }
  throw new Error('pattern too large to texture');
}

/**
 * @param g { N, X (draped, display pose), tris, P2 (panel coords, metres), panels: [{ name, base, count, grain: 'u'|'v' }],
 *            lower: bool (a skirt / trousers: framed on the waist, not the torso) }
 * @param photos { front: Photo, back?: Photo }
 * @returns { map (canvas), normal (canvas), uv: Float32Array(N·2), W, H, ppm }
 */
export function bakeGarment(g, photos, detail = null) {
  const { N, X, tris, P2, panels } = g;
  /* ---- layout ---- */
  const boxes = panels.map((p) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = p.base; k < p.base + p.count; k++) { x0 = Math.min(x0, P2[k * 2]); x1 = Math.max(x1, P2[k * 2]); y0 = Math.min(y0, P2[k * 2 + 1]); y1 = Math.max(y1, P2[k * 2 + 1]); }
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  });
  const { rects, ppm, W, H } = pack(boxes);
  const uvPx = new Float32Array(N * 2), panelIdx = new Int32Array(N);
  panels.forEach((p, i) => {
    for (let k = p.base; k < p.base + p.count; k++) {
      uvPx[k * 2] = rects[i].x + 1 + (P2[k * 2] - boxes[i].x0) * ppm;
      uvPx[k * 2 + 1] = rects[i].y + 1 + (boxes[i].y0 + boxes[i].h - P2[k * 2 + 1]) * ppm;    // panel y up → rows down
      panelIdx[k] = i;
    }
  });

  /* ---- the photos: de-lit colour + relief, where the garment is, how it's framed ---- */
  const prep = (ph) => {
    const c = document.createElement('canvas'); c.width = ph.w; c.height = ph.h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(ph.canvas, 0, 0);
    const D = insideDistance(ph.data, ph.w, ph.h);
    const nc = prepareFabric(c, [{ x: 0, w: ph.w, h: ph.h }], { bleed: 24 });
    return { w: ph.w, h: ph.h, D, col: cx.getImageData(0, 0, ph.w, ph.h).data, nrm: nc.getContext('2d').getImageData(0, 0, ph.w, ph.h).data, data: ph.data };
  };
  const F = prep(photos.front), B = photos.back ? prep(photos.back) : null;

  // vertex normals of the draped garment (which way each point faces)
  const VN = new Float32Array(N * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const e1 = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], e2 = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) { VN[v] += n[0]; VN[v + 1] += n[1]; VN[v + 2] += n[2]; }
  }
  for (let k = 0; k < N; k++) { const l = Math.hypot(VN[k * 3], VN[k * 3 + 1], VN[k * 3 + 2]) || 1; VN[k * 3] /= l; VN[k * 3 + 1] /= l; VN[k * 3 + 2] /= l; }

  // the garment in 3D, framed the way the photo frames it: top → bottom, centre, width over the same band
  const band = g.lower ? [0.04, 0.2] : [0.55, 0.85];
  let yTop = -Infinity, yBot = Infinity;
  for (let k = 0; k < N; k++) { yTop = Math.max(yTop, X[k * 3 + 1]); yBot = Math.min(yBot, X[k * 3 + 1]); }
  const width3 = (() => {
    const ws = [];
    for (let f = band[0]; f <= band[1]; f += 0.03) {
      const y = yTop - f * (yTop - yBot); let x0 = Infinity, x1 = -Infinity;
      for (let k = 0; k < N; k++) if (Math.abs(X[k * 3 + 1] - y) < 0.01 && !panels[panelIdx[k]].limb) { x0 = Math.min(x0, X[k * 3]); x1 = Math.max(x1, X[k * 3]); }
      if (x1 > x0) ws.push(x1 - x0);
    }
    ws.sort((a, b) => a - b); return ws[ws.length >> 1] || 0.4;
  })();
  const frame = (P) => {
    if (!P) return null;
    const f = photoFrame(P, P.D, band);
    const sy = (f.bottom - f.top) / (yTop - yBot);
    const sx = Math.max(0.75 * sy, Math.min(1.3 * sy, (f.width || sy * width3) / width3));
    return { ...f, sx, sy };
  };
  const fF = frame(F), fB = frame(B);
  const patch = fabricPatch(F, F.D);

  /* ---- bake ---- */
  const map = new Uint8ClampedArray(W * H * 4), nmap = new Uint8ClampedArray(W * H * 4);
  const sample = (P, arr, x, y, out, o) => {                // bilinear
    x = Math.max(0, Math.min(P.w - 1.001, x)); y = Math.max(0, Math.min(P.h - 1.001, y));
    const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
    for (let c = 0; c < 3; c++) {
      const i = (y0 * P.w + x0) * 4 + c;
      out[o + c] = (arr[i] * (1 - tx) + arr[i + 4] * tx) * (1 - ty) + (arr[i + P.w * 4] * (1 - tx) + arr[i + P.w * 4 + 4] * tx) * ty;
    }
  };
  const Dat = (P, x, y) => P.D[Math.max(0, Math.min(P.h - 1, Math.round(y))) * P.w + Math.max(0, Math.min(P.w - 1, Math.round(x)))];
  /* ---- the 3D model's surface (TRELLIS.2, fitted on the same body): its texture covers every side the photo
     can't see (the back, the sleeves, the sides) — its colours matched to the photo's (per channel mean/std,
     from points both see), since the generated texture can drift in tone ---- */
  let dAt = null;
  if (detail) {
    const iw = detail.image.width, ih = detail.image.height, dc = document.createElement('canvas');
    dc.width = iw; dc.height = ih;
    const dx = dc.getContext('2d', { willReadFrequently: true }); dx.drawImage(detail.image, 0, 0);
    const dpx = dx.getImageData(0, 0, iw, ih).data, dn = detail.pts.length / 3;
    const dcol = makeCollider(detail.pts, new Float32Array(detail.pts.length), 0.03);
    const raw = (x, y, z, out) => {
      const c = dcol.nearest(x, y, z); if (c < 0) return false;
      if (Math.hypot(detail.pts[c * 3] - x, detail.pts[c * 3 + 1] - y, detail.pts[c * 3 + 2] - z) > 0.05) return false;
      const u = Math.min(iw - 1, Math.max(0, Math.round(detail.uv[c * 2] * iw))), v = Math.min(ih - 1, Math.max(0, Math.round(detail.uv[c * 2 + 1] * ih)));
      const i = (v * iw + u) * 4; out[0] = dpx[i]; out[1] = dpx[i + 1]; out[2] = dpx[i + 2];
      return true;
    };
    // colour match: points on the front both the photo and the model see
    const sA = [[], [], []], sB = [[], [], []], t = [0, 0, 0], pc = [0, 0, 0];
    for (let k = 0; k < N; k += 3) {
      if (!panels[panelIdx[k]].front || !fF) continue;
      const ix = fF.cx + X[k * 3] * fF.sx, iy = fF.top + (yTop - X[k * 3 + 1]) * fF.sy;
      if (Dat(F, ix, iy) < 6 || !raw(X[k * 3], X[k * 3 + 1], X[k * 3 + 2], t)) continue;
      sample(F, F.col, ix, iy, pc, 0);
      for (let c = 0; c < 3; c++) { sA[c].push(t[c]); sB[c].push(pc[c]); }
    }
    const ms = (a) => { const m = a.reduce((p, q) => p + q, 0) / (a.length || 1); return [m, Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / (a.length || 1)) || 1]; };
    const fit = [0, 1, 2].map((c) => { const [ma, sa] = ms(sA[c]), [mb, sb] = ms(sB[c]); const g = Math.max(0.3, Math.min(4, sb / sa)); return sA[c].length > 30 ? [g, mb - ma * g] : [1, 0]; });
    // what this garment's fabric looks like (the photo, well inside the cut-out): a colour the 3D model has that
    // the garment never has (the wearer's skin, a bag, the background it guessed) is not taken
    const gc = [], gs = [];
    { const acc = [[], [], []];
      for (let i = 0; i < F.w * F.h; i += 5) if (F.D[i] > 5) for (let c = 0; c < 3; c++) acc[c].push(F.col[i * 4 + c]);
      for (let c = 0; c < 3; c++) { const [m, sd] = ms(acc[c]); gc.push(m); gs.push(sd); } }
    const tol = Math.max(45, 2.5 * Math.hypot(gs[0], gs[1], gs[2]));
    dAt = (x, y, z, out) => {
      const keep = [out[0], out[1], out[2]];
      if (!raw(x, y, z, out)) return false;
      for (let c = 0; c < 3; c++) out[c] = Math.max(0, Math.min(255, out[c] * fit[c][0] + fit[c][1]));
      if (Math.hypot(out[0] - gc[0], out[1] - gc[1], out[2] - gc[2]) > tol) { out[0] = keep[0]; out[1] = keep[1]; out[2] = keep[2]; return false; }
      return true;
    };
  }

  const tileAt = (u, v, out, o, arr) => {               // u, v: metres along the fabric (v = grain)
    if (!patch) { sample(F, arr, F.w / 2, F.h / 2, out, o); return; }
    const s = patch.side, m = (t) => { t = ((t % (2 * s)) + 2 * s) % (2 * s); return t < s ? t : 2 * s - t - 0.001; };
    sample(F, arr, patch.x0 + m(u * fF.sy), patch.y0 + m(v * fF.sy), out, o);
  };
  const cA = [0, 0, 0], cB = [0, 0, 0], nA = [0, 0, 0], nB = [0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2], p = panels[panelIdx[a]];
    const ax = uvPx[a * 2], ay = uvPx[a * 2 + 1], bx = uvPx[b * 2], by = uvPx[b * 2 + 1], cx = uvPx[c * 2], cy = uvPx[c * 2 + 1];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const X0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), X1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
    const Y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), Y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    for (let py = Y0; py <= Y1; py++) for (let px = X0; px <= X1; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      const l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den, l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const o = (py * W + px) * 4;
      if (map[o + 3]) continue;
      const I = (arr, k) => arr[a * 3 + k] * l1 + arr[b * 3 + k] * l2 + arr[c * 3 + k] * l3;
      const x = I(X, 0), y = I(X, 1), nz = I(VN, 2);
      // fabric: panel coords along its grain
      const pu = P2[a * 2] * l1 + P2[b * 2] * l2 + P2[c * 2] * l3, pv = P2[a * 2 + 1] * l1 + P2[b * 2 + 1] * l2 + P2[c * 2 + 1] * l3;
      const [gu, gv] = p.grain === 'u' ? [pv, pu] : [pu, -pv];
      tileAt(gu, gv, cA, 0, F.col); tileAt(gu, gv, nA, 0, F.nrm);
      if (dAt) dAt(x, y, I(X, 2), cA);                     // the 3D model's look where it has one
      // photo: front (or back) view of this point
      let w = 0;
      const view = p.front ? (fF && { P: F, f: fF, sgn: 1 }) : (fB && { P: B, f: fB, sgn: -1 });
      if (view) {
        const { P, f, sgn } = view;
        const ix = f.cx + sgn * x * f.sx, iy = f.top + (yTop - y) * f.sy;
        w = smooth(1.5, 6, Dat(P, ix, iy)) * smooth(0.12, 0.4, Math.abs(nz));
        if (w > 0) { sample(P, P.col, ix, iy, cB, 0); sample(P, P.nrm, ix, iy, nB, 0); }
      }
      for (let k = 0; k < 3; k++) { map[o + k] = cA[k] + (cB[k] - cA[k]) * w; nmap[o + k] = nA[k] + (nB[k] - nA[k]) * w; }
      map[o + 3] = nmap[o + 3] = 255;
    }
  }
  // edge dilation (mip-mapping never reaches the empty atlas)
  for (let pass = 0; pass < 6; pass++) {
    const src = map.slice(), nsrc = nmap.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4; if (src[o + 3]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X2 = x + dx, Y2 = y + dy; if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
        const j = (Y2 * W + X2) * 4; if (!src[j + 3]) continue;
        for (let k = 0; k < 4; k++) { map[o + k] = src[j + k]; nmap[o + k] = nsrc[j + k]; }
        break;
      }
    }
  }
  const toCanvas = (arr) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(arr, W, H), 0, 0); return c; };
  const uv = new Float32Array(N * 2);
  for (let k = 0; k < N; k++) { uv[k * 2] = uvPx[k * 2] / W; uv[k * 2 + 1] = uvPx[k * 2 + 1] / H; }
  return { map: toCanvas(map), normal: toCanvas(nmap), uv, W, H, ppm, patch, frame: fF };
}
