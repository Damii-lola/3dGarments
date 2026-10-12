/**
 * Garment scanner: a photo of a garment -> the TEXTURE for a template garment's UV atlas.
 *
 *  1. cut the garment out of the photo (shared/silhouette.js, the same code the API runs)
 *  2. line the template's FRONT silhouette up with the photo's silhouette, row by row
 *     (so a boxy tee and a fitted tee both land on the same template: widths are normalised per row)
 *  3. for every texel of the template's UV atlas, find the 3D point it belongs to, project that point
 *     into the photo and copy the colour
 *  4. what the photo cannot show (back, inside of the sleeves) comes from an optional back photo,
 *     otherwise it is the fabric's dominant colour
 *  5. pad the islands so mip-mapping does not bleed the background in
 *
 * This is the deterministic, no-AI core. An AI step (match the photo to a template, invent the back,
 * clean up prints) plugs in before step 1 and after step 4.
 */
import { processPhoto } from '../garments/local.js';
import { analyzeSilhouette } from '@shared/silhouette.js';

/** what the scanner needs of a template: rest positions, normals, UVs, triangles (glTF UVs: v runs down) */
export function templateOf(garment) {
  return { pos: garment.base, nrm: garment.baseN, uv: garment.geometry.attributes.uv.array, index: garment.index };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** the template seen from the front (orthographic), run through the SAME silhouette analyser as the photos */
function templateView(T, rows = 512) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < T.pos.length; i += 3) { x0 = Math.min(x0, T.pos[i]); x1 = Math.max(x1, T.pos[i]); y0 = Math.min(y0, T.pos[i + 1]); y1 = Math.max(y1, T.pos[i + 1]); }
  const h = rows, w = Math.max(8, Math.round(rows * (x1 - x0) / (y1 - y0))), sx = w / (x1 - x0), sy = h / (y1 - y0);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 1;
  for (let t = 0; t < T.index.length; t += 3) {
    g.beginPath();
    for (let k = 0; k < 3; k++) { const v = T.index[t + k] * 3, X = (T.pos[v] - x0) * sx, Y = (y1 - T.pos[v + 1]) * sy; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.closePath(); g.fill(); g.stroke();
  }
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  const geometry = analyzeSilhouette(m, w, h);
  // 3D (x, y metres) -> the analyser's garment space (unit = raster height, y down)
  const toG = (x, y, o) => { o[0] = (x - x0) * sx / h; o[1] = (y1 - y) * sy / h; };
  return { geometry, toG, w, h };
}

/** median torso edges [left, right] over the middle of the garment (analyser units) */
function torsoEdges(G) {
  const ext = G.bottom - G.top, L = [], R = [];
  for (const r of G.rows) {
    if (!r.t) continue;
    const gy = (r.y - G.top) / ext;
    if (gy >= 0.3 && gy <= 0.9) { L.push(r.t[0]); R.push(r.t[1]); }
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return L.length ? [med(L), med(R)] : [G.centerX - 0.25, G.centerX + 0.25];
}

/** connected pieces of the template (front, back, sleeves) and what each one is */
function templatePieces(T) {
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

/** dominant fabric colour of a cut-out: per-channel median of the garment pixels in the middle of the garment */
function fabricColour(px, w, h, mask) {
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const cx0 = x0 + (x1 - x0) * 0.25, cx1 = x1 - (x1 - x0) * 0.25, cy0 = y0 + (y1 - y0) * 0.3, cy1 = y1 - (y1 - y0) * 0.1;
  const ch = [[], [], []];
  for (let y = Math.floor(cy0); y < cy1; y += 2) for (let x = Math.floor(cx0); x < cx1; x += 2) {
    if (!mask[y * w + x]) continue;
    for (let c = 0; c < 3; c++) ch[c].push(px[(y * w + x) * 4 + c]);
  }
  const med = (a) => { if (!a.length) return 200; a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(ch[0]), med(ch[1]), med(ch[2])];
}

/** one prepared photo: pixels, mask, per-row extents, fabric colour */
async function preparePhoto(src) {
  const p = await processPhoto(src);
  const cut = p.cut, w = cut.width, h = cut.height;
  const px = cut.getContext('2d').getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
  let top = h, bot = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] >= 128) { mask[y * w + x] = 1; if (y < top) top = y; if (y > bot) bot = y; }
  // interior of the garment: the edge band (anti-aliased, blended with the background) must never be sampled
  // only FULLY opaque pixels count as solid garment (feathered edge pixels keep some background colour)
  let er = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) er[i] = px[i * 4 + 3] >= 250 ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    const nx = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      nx[i] = er[i] && er[i - 1] && er[i + 1] && er[i - w] && er[i + w] ? 1 : 0;
    }
    er = nx;
  }
  return { w, h, px, mask, er, top, bot: bot + 1, fabric: fabricColour(px, w, h, mask), geometry: p.geometry, cut };
}

/**
 * Colour of each row of a photo's garment: per-channel median over the solid pixels of the torso columns.
 * Keeps plain fabric and horizontal stripes, drops a localised print (a chest logo is a few % of a row).
 * This is what the BACK of the garment looks like when only a front photo exists.
 */
function rowColours(P, tL, tR) {
  const x0 = Math.round(tL * P.h + (tR - tL) * P.h * 0.1), x1 = Math.round(tR * P.h - (tR - tL) * P.h * 0.1);
  const rows = new Array(P.h).fill(null);
  for (let y = 0; y < P.h; y++) {
    const r = [], g = [], b = [];
    for (let x = x0; x < x1; x += 2) { const i = y * P.w + x; if (!P.er[i]) continue; r.push(P.px[i * 4]); g.push(P.px[i * 4 + 1]); b.push(P.px[i * 4 + 2]); }
    if (r.length > 10) { const m = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; }; rows[y] = [m(r), m(g), m(b)]; }
  }
  // fill gaps from the nearest valid row
  let last = null;
  for (let y = 0; y < P.h; y++) { if (rows[y]) last = rows[y]; else if (last) rows[y] = last; }
  last = null;
  for (let y = P.h - 1; y >= 0; y--) { if (rows[y]) last = rows[y]; else if (last) rows[y] = last; }
  return rows;
}

/** colour at (x, y) of a prepared photo; false where there is no garment. Edge-band pixels borrow the nearest interior colour. */
function sample(P, x, y, out) {
  if (x < 0 || y < 0 || x > P.w - 1 || y > P.h - 1) return false;
  const xi = Math.round(x), yi = Math.round(y), idx = yi * P.w + xi;
  if (!P.mask[idx]) return false;
  let sx = xi, sy = yi;
  if (!P.er[idx]) {                                   // edge band: search outward for solid garment
    let found = false;
    for (let r = 1; r <= 5 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = xi + dx, yy = yi + dy;
        if (xx < 0 || yy < 0 || xx >= P.w || yy >= P.h || !P.er[yy * P.w + xx]) continue;
        sx = xx; sy = yy; found = true; break;
      }
    }
    if (!found) return false;                         // a sliver with no solid garment nearby: use the fabric colour instead
  }
  const o = (sy * P.w + sx) * 4;
  out[0] = P.px[o]; out[1] = P.px[o + 1]; out[2] = P.px[o + 2];
  return true;
}

/**
 * @param T       template (templateOf(garment))
 * @param front   photo of the front (URL / Blob / image)
 * @param opts    { back: photo of the back, size: atlas size (2048), padding: px }
 * @returns { canvas, report }
 */
export async function scanToTexture(T, front, opts = {}) {
  const S = opts.size || 2048, pad = opts.padding ?? 8, t0 = performance.now(), lapT = { t: t0 }, ms = {};
  const lap = (k) => { const t = performance.now(); ms[k] = Math.round(t - lapT.t); lapT.t = t; };
  const F = await preparePhoto(front); lap('photo');
  const B = opts.back ? await preparePhoto(opts.back) : null; lap('backPhoto');

  /* mapping: template front-view point (analyser units) -> photo pixel.
     Torso pieces: box to box (torso edges x, garment top/bottom y). Sleeves: along each sleeve's own axis. */
  const TV = templateView(T), GT = TV.geometry, Pc = templatePieces(T);
  const tT = torsoEdges(GT);
  const photoMap = (P, mirror) => {
    const G = P.geometry, U = P.h, tP = torsoEdges(G);
    const torso = (gx, gy, o) => {
      const yn = (gy - GT.top) / (GT.bottom - GT.top);
      let xn = (gx - tT[0]) / (tT[1] - tT[0]);
      if (mirror) xn = 1 - xn;
      o[0] = (tP[0] + xn * (tP[1] - tP[0])) * U; o[1] = (G.top + yn * (G.bottom - G.top)) * U;
      return true;
    };
    const sleeve = (gx, gy, sideT, o) => {
      const sT = sideT > 0 ? GT.sleeves.right : GT.sleeves.left;
      const sP = (mirror ? -sideT : sideT) > 0 ? G.sleeves.right : G.sleeves.left;
      if (!sT || !sP) return false;
      const dx = gx - sT.root[0], dy = gy - sT.root[1];
      const along = (dx * sT.dir[0] + dy * sT.dir[1]) / sT.length;
      const across = (dx * -sT.dir[1] + dy * sT.dir[0] - sT.offset) / sT.width;
      let a = along, c = across;
      // seen from behind the sleeve is mirrored: across flips
      if (mirror) c = -c;
      const al = a * sP.length, cr = sP.offset + c * sP.width;
      o[0] = (sP.root[0] + sP.dir[0] * al - sP.dir[1] * cr) * U; o[1] = (sP.root[1] + sP.dir[1] * al + sP.dir[0] * cr) * U;
      return true;
    };
    return { torso, sleeve };
  };
  const mapFront = photoMap(F, false), mapBack = B ? photoMap(B, true) : null;
  const tF = torsoEdges(F.geometry), frontRows = rowColours(F, tF[0], tF[1]);
  lap('mapping');

  /* rasterise the UV triangles; for each texel interpolate position + normal */
  const img = new Uint8ClampedArray(S * S * 4), filled = new Uint8Array(S * S);
  const fab = F.fabric, bfab = B ? B.fabric : F.fabric;
  const col = [0, 0, 0], pp = [0, 0], gg = [0, 0];
  let frontTexels = 0, backTexels = 0, fallbackTexels = 0, inferredTexels = 0;
  const { pos, nrm, uv, index } = T;
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t], ib = index[t + 1], ic = index[t + 2];
    const ax = uv[ia * 2] * S, ay = uv[ia * 2 + 1] * S, bx = uv[ib * 2] * S, by = uv[ib * 2 + 1] * S, cx = uv[ic * 2] * S, cy = uv[ic * 2 + 1] * S;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      const X3 = pos[ia * 3] * w1 + pos[ib * 3] * w2 + pos[ic * 3] * w3, Y3 = pos[ia * 3 + 1] * w1 + pos[ib * 3 + 1] * w2 + pos[ic * 3 + 1] * w3;
      const NZ = nrm[ia * 3 + 2] * w1 + nrm[ib * 3 + 2] * w2 + nrm[ic * 3 + 2] * w3;
      const pc = Pc.piece[ia], kind = Pc.kind[pc];
      TV.toG(X3, Y3, gg);
      // which photo does this texel come from?
      let useBack = kind === 'back' || (kind === 'sleeve' && NZ <= -0.12);
      let ok = false, from = 0;
      const M = useBack ? mapBack : mapFront, PH = useBack ? B : F;
      if (M) {
        const mapped = kind === 'sleeve' ? M.sleeve(gg[0], gg[1], Pc.side[pc], pp) : M.torso(gg[0], gg[1], pp);
        if (mapped) { ok = sample(PH, pp[0], pp[1], col); from = useBack ? 2 : 1; }
      }
      const o = (y * S + x) * 4;
      if (opts.debug === 'map') { if (ok) { img[o] = Math.min(255, pp[0] / (from === 1 ? F.w : B.w) * 255); img[o + 1] = Math.min(255, pp[1] / (from === 1 ? F.h : B.h) * 255); img[o + 2] = from === 1 ? 0 : 255; } else { img[o] = img[o + 1] = img[o + 2] = 0; } img[o + 3] = 255; filled[y * S + x] = 1; continue; }
      if (opts.debug) { const c = ok ? (from === 1 ? [0, 190, 0] : [200, 200, 0]) : [0, 60, 220]; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255; filled[y * S + x] = 1; if (ok) { if (from === 1) frontTexels++; else backTexels++; } else fallbackTexels++; continue; }
      if (ok) { img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; if (from === 1) frontTexels++; else backTexels++; }
      else if (useBack && !B) {
        // no back photo: the back is the front's row colours (plain fabric / stripes survive, prints do not)
        const m = kind === 'sleeve' ? mapFront.sleeve(gg[0], gg[1], Pc.side[pc], pp) : mapFront.torso(gg[0], gg[1], pp);
        const f = (m && frontRows[Math.min(F.h - 1, Math.max(0, Math.round(pp[1])))]) || fab;
        img[o] = f[0]; img[o + 1] = f[1]; img[o + 2] = f[2]; inferredTexels++;
      }
      else { const f = useBack && B ? bfab : fab; img[o] = f[0]; img[o + 1] = f[1]; img[o + 2] = f[2]; fallbackTexels++; }
      img[o + 3] = 255; filled[y * S + x] = 1;
    }
  }

  lap('raster');
  /* pad the islands: copy the nearest filled texel outward a few pixels (stops background bleeding in when mip-mapped) */
  {
    const N4 = [1, -1, S, -S];
    let cand = [];
    for (let i = 0; i < S * S; i++) {
      if (filled[i]) continue;
      const x = i % S;
      if ((x < S - 1 && filled[i + 1]) || (x > 0 && filled[i - 1]) || (i >= S && filled[i - S]) || (i < S * (S - 1) && filled[i + S])) cand.push(i);
    }
    for (let pass = 0; pass < pad && cand.length; pass++) {
      const next = [], set = new Set();
      for (const i of cand) {
        const x = i % S; let r = 0, g = 0, b = 0, n = 0;
        for (let k = 0; k < 4; k++) {
          const j = i + N4[k];
          if (j < 0 || j >= S * S || (k < 2 && ((k === 0 && x === S - 1) || (k === 1 && x === 0))) || !filled[j]) continue;
          const o = j * 4; r += img[o]; g += img[o + 1]; b += img[o + 2]; n++;
        }
        if (n) { const o = i * 4; img[o] = r / n; img[o + 1] = g / n; img[o + 2] = b / n; img[o + 3] = 255; set.add(i); }
      }
      for (const i of set) {
        filled[i] = 1;
        const x = i % S;
        for (let k = 0; k < 4; k++) {
          const j = i + N4[k];
          if (j < 0 || j >= S * S || (k === 0 && x === S - 1) || (k === 1 && x === 0) || filled[j]) continue;
          next.push(j);
        }
      }
      cand = next;
    }
  }
  lap('pad');
  // anything still empty (outside every island) gets the fabric colour so no black shows anywhere
  for (let i = 0; i < S * S; i++) if (!filled[i]) { img[i * 4] = fab[0]; img[i * 4 + 1] = fab[1]; img[i * 4 + 2] = fab[2]; img[i * 4 + 3] = 255; }

  const canvas = document.createElement('canvas'); canvas.width = canvas.height = S;
  canvas.getContext('2d').putImageData(new ImageData(img, S, S), 0, 0);
  lap('finish');
  const total = frontTexels + backTexels + fallbackTexels + inferredTexels || 1;
  return {
    canvas,
    cutout: F.cut, geometry: F.geometry,
    report: {
      ms: Math.round(performance.now() - t0), stages: ms, size: S,
      fromFrontPhoto: +(frontTexels / total).toFixed(3), fromBackPhoto: +(backTexels / total).toFixed(3), fallbackFabric: +(fallbackTexels / total).toFixed(3), backInferredFromFront: +(inferredTexels / total).toFixed(3),
      fabricRGB: fab.map(Math.round), photoGuess: F.geometry.guess, photoSleeves: { left: !!F.geometry.sleeves.left, right: !!F.geometry.sleeves.right },
      segmentation: F.geometry.segmentation,
    },
  };
}
