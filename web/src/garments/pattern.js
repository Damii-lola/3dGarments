/**
 * Sewing pattern from photos: the garment's front and back, as the flat pieces they are.
 *
 * The cut-out's outline (front ∪ back, aligned) is meshed at a real-world spacing (equilateral
 * triangles, ~1.5 cm) — the same mesh twice: the front piece and the back piece. Their shared outline
 * is sewn together, except where the garment opens: the neck, armholes of a sleeveless garment, the
 * sleeve cuffs, the hem, a waistband, trouser hems. Nothing is invented: every point of each piece
 * is a point of its photo (UV), and every length is the photo's, at the garment's scale.
 */

/** bounding box of a photo's opaque pixels, in garment units */
function bbox(ph) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const { w, h, data } = ph;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (data[(y * w + x) * 4 + 3] > 128) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0: x0 / h, x1: x1 / h, y0: y0 / h, y1: y1 / h };
}

/**
 * @param F front Photo, B back Photo (seen from behind) — may be derived from the front
 * @param s metres per garment unit (front)
 * @param opts { h: spacing (m), kind: 'upper' | 'lower' | 'full' }
 * @returns { n, pos2: Float32Array (gx, gy per vertex), tris, backXY(gx, gy) → [bx, by],
 *            boundary: [{ v, nx, ny }], sewn: Set<v>, alphaF, alphaB }
 */
export function buildPattern(F, B, s, { h = 0.015, kind = 'upper' } = {}) {
  const geo = F.geometry;
  const bf = bbox(F), bb = bbox(B);
  // front coords → back photo coords (seen from behind: mirrored)
  const backXY = (gx, gy) => [
    bb.x1 - ((gx - bf.x0) / ((bf.x1 - bf.x0) || 1)) * (bb.x1 - bb.x0),
    bb.y0 + ((gy - bf.y0) / ((bf.y1 - bf.y0) || 1)) * (bb.y1 - bb.y0),
  ];
  const aF = (gx, gy) => F.alpha(gx, gy), aB = (gx, gy) => { const [x, y] = backXY(gx, gy); return B.alpha(x, y); };
  const inside = (gx, gy) => aF(gx, gy) > 0.5 || aB(gx, gy) > 0.5;

  /* ---- triangular grid over the outline ---- */
  const hu = h / s, hv = hu * 0.8660254;
  const x0 = bf.x0 - hu, y0 = bf.y0 - hv;
  const cols = Math.ceil((bf.x1 - bf.x0) / hu) + 3, rows = Math.ceil((bf.y1 - bf.y0) / hv) + 3;
  const id = new Int32Array(cols * rows).fill(-1);
  const P = [];
  const at = (i, j) => [x0 + (i + (j & 1 ? 0.5 : 0)) * hu, y0 + j * hv];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const [gx, gy] = at(i, j);
    if (inside(gx, gy)) { id[j * cols + i] = P.length / 2; P.push(gx, gy); }
  }
  const T = [];
  const V = (i, j) => (i >= 0 && i < cols && j >= 0 && j < rows ? id[j * cols + i] : -1);
  const tri = (a, b, c) => { if (a >= 0 && b >= 0 && c >= 0) T.push(a, b, c); };
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) {
    if (j & 1) { tri(V(i, j), V(i + 1, j + 1), V(i + 1, j)); tri(V(i, j), V(i, j + 1), V(i + 1, j + 1)); }
    else { tri(V(i, j), V(i, j + 1), V(i + 1, j)); tri(V(i + 1, j), V(i, j + 1), V(i + 1, j + 1)); }
  }

  /* ---- keep the largest connected piece ---- */
  const nv0 = P.length / 2, parent = Int32Array.from({ length: nv0 }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < T.length; t += 3) { const a = find(T[t]); parent[find(T[t + 1])] = a; parent[find(T[t + 2])] = a; }
  const count = new Map();
  for (let t = 0; t < T.length; t++) { const r = find(T[t]); count.set(r, (count.get(r) || 0) + 1); }
  const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const remap = new Int32Array(nv0).fill(-1), pos2 = [];
  const tris = [];
  for (let t = 0; t < T.length; t += 3) {
    if (find(T[t]) !== main) continue;
    for (let q = 0; q < 3; q++) { const v = T[t + q]; if (remap[v] < 0) { remap[v] = pos2.length / 2; pos2.push(P[v * 2], P[v * 2 + 1]); } tris.push(remap[v]); }
  }
  const n = pos2.length / 2;

  /* ---- outline: boundary edges and outward normals ---- */
  const edges = new Map();
  const ek = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
    const a = tris[t + q], b = tris[t + ((q + 1) % 3)], c = tris[t + ((q + 2) % 3)], k = ek(a, b);
    const e = edges.get(k);
    if (e) e.count++; else edges.set(k, { a, b, c, count: 1 });
  }
  const nrm = new Float32Array(n * 2), isB = new Uint8Array(n);
  for (const { a, b, c, count: k } of edges.values()) {
    if (k !== 1) continue;
    const ex = pos2[b * 2] - pos2[a * 2], ey = pos2[b * 2 + 1] - pos2[a * 2 + 1];
    let px = -ey, py = ex;
    const mx = (pos2[a * 2] + pos2[b * 2]) / 2 - pos2[c * 2], my = (pos2[a * 2 + 1] + pos2[b * 2 + 1]) / 2 - pos2[c * 2 + 1];
    if (px * mx + py * my < 0) { px = -px; py = -py; }
    for (const v of [a, b]) { nrm[v * 2] += px; nrm[v * 2 + 1] += py; isB[v] = 1; }
  }

  /* ---- which parts of the outline are openings ---- */
  const cx = geo.centerX, top = geo.top, bottom = geo.bottom;
  const sleeves = [geo.sleeves?.left, geo.sleeves?.right].filter(Boolean);
  // the neck: where the top edge dips below its hull (a scoop), else the middle of a straight top edge
  const tops = F.columnTops();
  let nx0 = Infinity, nx1 = -Infinity;
  for (let x = 0; x < F.w; x++) {
    if (tops[x] < 0) continue;
    const gx = x / F.h, env = F.topEdge(gx);
    if (tops[x] / F.h - env > 0.012 && Math.abs(gx - cx) < 0.25 * (bf.x1 - bf.x0)) { nx0 = Math.min(nx0, gx); nx1 = Math.max(nx1, gx); }
  }
  const torsoW = (() => { const t = F.torsoAt(top + 0.35 * (bottom - top)); return t ? t[1] - t[0] : bf.x1 - bf.x0; })();
  const neckHalf = nx1 > nx0 ? Math.max(cx - nx0, nx1 - cx) + 0.01 : 0.2 * torsoW;
  // armhole depth of a sleeveless piece: where the body is widest in its upper part
  let armY = geo.armpit;
  if (armY == null) {
    let best = 0;
    for (let gy = top; gy < top + 0.4 * (bottom - top); gy += 0.005) { const t = F.torsoAt(gy); if (t && t[1] - t[0] > best) { best = t[1] - t[0]; armY = gy; } }
    armY ??= top + 0.25 * (bottom - top);
  }
  // strapless: the first rows are one piece across the middle (no straps / shoulders)
  const r0 = F.rows.find((r) => r.y >= top + 0.01 && r.runs.length);
  const strapless = !sleeves.length && r0 && r0.runs.length === 1 && r0.runs[0][0] < cx && r0.runs[0][1] > cx;
  const sewn = new Set(), boundary = [];
  for (let v = 0; v < n; v++) {
    if (!isB[v]) continue;
    const l = Math.hypot(nrm[v * 2], nrm[v * 2 + 1]) || 1, ux = nrm[v * 2] / l, uy = nrm[v * 2 + 1] / l;
    const gx = pos2[v * 2], gy = pos2[v * 2 + 1];
    let open = false;
    if (kind === 'lower') {
      if (uy < -0.5 && gy < top + 0.04) open = true;                     // waistband
      if (uy > 0.5 && gy > bottom - 0.04) open = true;                   // hems
    } else {
      if (uy < -0.3 && Math.abs(gx - cx) < neckHalf && gy < armY) open = true;           // neck
      if (strapless && uy < -0.3 && gy < armY) open = true;                              // strapless top edge
      if (uy > 0.5 && gy > bottom - 0.04) open = true;                                   // hem(s)
      for (const sl of sleeves) {                                                        // cuffs
        const t = (gx - sl.root[0]) * sl.dir[0] + (gy - sl.root[1]) * sl.dir[1];
        if (t > 0.75 * sl.length && ux * sl.dir[0] + uy * sl.dir[1] > 0.35) open = true;
      }
      if (!sleeves.length && gy < armY + 0.01 && Math.abs(gx - cx) > neckHalf * 0.8 && Math.abs(ux) > 0.35 && Math.sign(ux) === Math.sign(gx - cx)) open = true;   // armholes
    }
    boundary.push({ v, nx: ux, ny: uy, open });
    if (!open) sewn.add(v);
  }
  return { n, pos2: Float32Array.from(pos2), tris: Uint32Array.from(tris), backXY, boundary, sewn, alphaF: aF, alphaB: aB, hu };
}
