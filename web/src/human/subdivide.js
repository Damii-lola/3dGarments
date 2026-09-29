/**
 * One level of Catmull–Clark subdivision for the body, precomputed as a sparse
 * stencil matrix: every subdivided vertex is a fixed weighted sum of coarse
 * vertices, so any body shape is subdivided with one cheap mat-vec per reshape.
 *
 *   face point   F = average of the quad's corners
 *   edge point   E = (a + b + F1 + F2) / 4            boundary: (a + b) / 2
 *   vertex point V = (Q + 2R + (n − 3)P) / n           boundary: ¾P + ⅛(b1 + b2)
 *
 * UVs are interpolated linearly per face (seam aware), skin weights are the
 * stencil-weighted blend of the coarse weights (top 4 kept).
 * Coarse vertices that are not body (lashes, teeth…) pass through unchanged.
 */

/**
 * @param src      Uint16Array  coarse render vertex → coarse vertex
 * @param uv       Float32Array coarse render uvs
 * @param body     Uint32Array  coarse body triangles (pairs = fan-triangulated quads a,b,c / a,c,d)
 * @param N        coarse vertex count
 * @param extras   { name: Uint32Array coarse render triangles } — carried over unsubdivided
 * @param skin     { index: Uint8Array N×4, weight: Uint16Array N×4 (65535 = 1) }
 */
export function buildSubdivision(src, uv, body, N, extras, skin) {
  const Q = body.length / 6;
  const quads = new Uint32Array(Q * 4); // render ids
  for (let q = 0; q < Q; q++) {
    const t = q * 6;
    quads[q * 4] = body[t]; quads[q * 4 + 1] = body[t + 1]; quads[q * 4 + 2] = body[t + 2]; quads[q * 4 + 3] = body[t + 5];
  }
  const O = (r) => src[r];

  /* ---------- topology: edges, vertex → faces / edges ---------- */
  const edgeId = new Map();
  const edgeA = [], edgeB = [], edgeF = [];
  const faceEdges = new Uint32Array(Q * 4);
  for (let q = 0; q < Q; q++) {
    for (let i = 0; i < 4; i++) {
      const a = O(quads[q * 4 + i]), b = O(quads[q * 4 + ((i + 1) & 3)]);
      const key = a < b ? a * N + b : b * N + a;
      let e = edgeId.get(key);
      if (e === undefined) { e = edgeA.length; edgeId.set(key, e); edgeA.push(Math.min(a, b)); edgeB.push(Math.max(a, b)); edgeF.push([]); }
      edgeF[e].push(q);
      faceEdges[q * 4 + i] = e;
    }
  }
  const E = edgeA.length;
  const vFaces = new Map(), vEdges = new Map();
  const push = (m, k, v) => { let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(v); };
  for (let q = 0; q < Q; q++) for (let i = 0; i < 4; i++) push(vFaces, O(quads[q * 4 + i]), q);
  for (let e = 0; e < E; e++) { push(vEdges, edgeA[e], e); push(vEdges, edgeB[e], e); }

  /* ---------- stencils ---------- */
  const N2 = N + Q + E;
  const rows = new Array(N2);
  const acc = (m, v, w) => m.set(v, (m.get(v) || 0) + w);
  const faceRow = (q) => { const m = new Map(); for (let i = 0; i < 4; i++) acc(m, O(quads[q * 4 + i]), 0.25); return m; };
  const addRow = (m, row, k) => { for (const [v, w] of row) acc(m, v, w * k); };
  for (let q = 0; q < Q; q++) rows[N + q] = faceRow(q);
  for (let e = 0; e < E; e++) {
    const m = new Map(), fs = edgeF[e];
    if (fs.length === 2) {
      acc(m, edgeA[e], 0.25); acc(m, edgeB[e], 0.25);
      addRow(m, rows[N + fs[0]], 0.25); addRow(m, rows[N + fs[1]], 0.25);
    } else {
      acc(m, edgeA[e], 0.5); acc(m, edgeB[e], 0.5);
    }
    rows[N + Q + e] = m;
  }
  for (let v = 0; v < N; v++) {
    const fs = vFaces.get(v);
    if (!fs) { rows[v] = new Map([[v, 1]]); continue; }
    const es = vEdges.get(v);
    const boundary = es.filter((e) => edgeF[e].length < 2);
    const m = new Map();
    if (boundary.length >= 2) {
      acc(m, v, 0.75);
      for (const e of boundary.slice(0, 2)) acc(m, edgeA[e] === v ? edgeB[e] : edgeA[e], 0.125);
    } else {
      const n = fs.length;
      for (const q of fs) addRow(m, rows[N + q], 1 / (n * n));               // Q / n
      for (const e of es) { acc(m, edgeA[e], 1 / (n * es.length)); acc(m, edgeB[e], 1 / (n * es.length)); } // 2R / n
      acc(m, v, (n - 3) / n);
    }
    rows[v] = m;
  }
  const ptr = new Uint32Array(N2 + 1);
  let nnz = 0;
  for (let i = 0; i < N2; i++) { ptr[i] = nnz; nnz += rows[i].size; }
  ptr[N2] = nnz;
  const idx = new Uint32Array(nnz), w = new Float32Array(nnz);
  for (let i = 0, k = 0; i < N2; i++) for (const [v, x] of rows[i]) { idx[k] = v; w[k] = x; k++; }

  /* ---------- render vertices (uv seams split) + faces ---------- */
  const rSrc = [], rU = [], rV = [];
  const keyed = new Map();
  const rv = (key, subV, u, v) => {
    let r = keyed.get(key);
    if (r === undefined) { r = rSrc.length; keyed.set(key, r); rSrc.push(subV); rU.push(u); rV.push(v); }
    return r;
  };
  const corner = (r) => rv(`c${r}`, O(r), uv[r * 2], uv[r * 2 + 1]);
  const tris = [];
  for (let q = 0; q < Q; q++) {
    const R = [0, 1, 2, 3].map((i) => quads[q * 4 + i]);
    let fu = 0, fv = 0;
    for (const r of R) { fu += uv[r * 2] / 4; fv += uv[r * 2 + 1] / 4; }
    const f = rv(`f${q}`, N + q, fu, fv);
    const ep = R.map((r, i) => {
      const s = R[(i + 1) & 3];
      const k = r < s ? `${r}_${s}` : `${s}_${r}`;
      return rv(`e${k}`, N + Q + faceEdges[q * 4 + i], (uv[r * 2] + uv[s * 2]) / 2, (uv[r * 2 + 1] + uv[s * 2 + 1]) / 2);
    });
    for (let i = 0; i < 4; i++) {
      const a = corner(R[i]), b = ep[i], c = f, d = ep[(i + 3) & 3];
      tris.push(a, b, c, a, c, d); // same winding as the parent quad
    }
  }
  const index = { body: Uint32Array.from(tris) };
  for (const [name, t] of Object.entries(extras)) index[name] = Uint32Array.from(t, (r) => corner(r));

  const R2 = rSrc.length;
  const renderSrc = Uint32Array.from(rSrc);
  const renderUV = new Float32Array(R2 * 2);
  for (let r = 0; r < R2; r++) { renderUV[r * 2] = rU[r]; renderUV[r * 2 + 1] = rV[r]; }

  /* ---------- skin weights per render vertex ---------- */
  const skinIndex = new Uint16Array(R2 * 4), skinWeight = new Float32Array(R2 * 4);
  const bw = new Map();
  for (let r = 0; r < R2; r++) {
    bw.clear();
    const s = renderSrc[r];
    for (let k = ptr[s]; k < ptr[s + 1]; k++) {
      const v = idx[k];
      for (let j = 0; j < 4; j++) {
        const x = skin.weight[v * 4 + j];
        if (x) acc(bw, skin.index[v * 4 + j], (x / 65535) * w[k]);
      }
    }
    const top = [...bw].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((a, [, x]) => a + x, 0) || 1;
    top.forEach(([b, x], j) => { skinIndex[r * 4 + j] = b; skinWeight[r * 4 + j] = x / tot; });
  }

  /** coarse body triangle id (fan pairs) → the 8 child triangles' index offsets */
  const childTris = (coarseTri) => { const q = coarseTri >> 1; return [0, 1, 2, 3, 4, 5, 6, 7].map((k) => q * 8 + k); };

  return { N2, ptr, idx, w, renderSrc, renderUV, index, skinIndex, skinWeight, childTris, quads: Q };
}

/** out[i] = Σ w · W[idx] for each subdivided vertex (xyz). */
export function applyStencil(sub, W, out) {
  const { ptr, idx, w, N2 } = sub;
  for (let i = 0; i < N2; i++) {
    let x = 0, y = 0, z = 0;
    for (let k = ptr[i]; k < ptr[i + 1]; k++) {
      const o = idx[k] * 3, c = w[k];
      x += W[o] * c; y += W[o + 1] * c; z += W[o + 2] * c;
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
}
