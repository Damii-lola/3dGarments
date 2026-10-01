/**
 * Fabric painted back where something was taken off it (a hand, a necklace), in a fraction of a second, in plain JS:
 * multi-scale PatchMatch completion (Wexler et al. 2007 "space-time completion", with Barnes et al. 2009's
 * PatchMatch search). Every hole pixel is voted from the garment's own 7×7 patches that best continue what's
 * around it — so a plaid line, a knit rib or a print carries on through the gap — coarse to fine, so the large
 * structure is right before the detail is added.
 *
 *   fillFabric(rgba, W, H, hole, known) → rgba with the hole's pixels painted (in place)
 *     rgba   Uint8ClampedArray W·H·4
 *     hole   Uint8Array: 1 = paint this pixel
 *     known  Uint8Array: 1 = a pixel patches may be copied from (the garment's own fabric)
 */
const R = 3;                      // patch radius: 7×7

function down(L) {
  const { img, hole, known, W, H } = L;
  const w = Math.max(1, W >> 1), h = Math.max(1, H >> 1), o = new Float32Array(w * h * 3), oh = new Uint8Array(w * h), ok = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0, hh = 0, kk = 1;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const X = Math.min(W - 1, 2 * x + dx), Y = Math.min(H - 1, 2 * y + dy), i = Y * W + X;
      if (hole[i]) hh = 1; else { r += img[i * 3]; g += img[i * 3 + 1]; b += img[i * 3 + 2]; n++; }
      if (!known[i]) kk = 0;
    }
    // a coarse pixel is a hole when any under it is (a hole never shrinks away going down), fabric when all are
    const j = y * w + x;
    oh[j] = hh; ok[j] = kk && !hh ? 1 : 0;
    if (n) { o[j * 3] = r / n; o[j * 3 + 1] = g / n; o[j * 3 + 2] = b / n; }
  }
  return { img: o, hole: oh, known: ok, W: w, H: h };
}

/** holes filled by averaging in from their edges (the coarsest level's start) */
function diffuse(img, hole, W, H) {
  const k = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) k[i] = hole[i] ? 0 : 1;
  let front = [];
  for (let i = 0; i < W * H; i++) if (!k[i]) front.push(i);
  for (let it = 0; front.length && it < 4 * (W + H); it++) {
    const next = [], done = [];
    for (const i of front) {
      const x = i % W, y = (i / W) | 0; let r = 0, g = 0, b = 0, n = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && k[j]) { r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; n++; }
      if (n) { img[i * 3] = r / n; img[i * 3 + 1] = g / n; img[i * 3 + 2] = b / n; done.push(i); } else next.push(i);
    }
    for (const i of done) k[i] = 1;
    if (!done.length) break;
    front = next;
  }
}

/** one level: EM (search + vote) over the hole's patches, the nearest-neighbour field nnf (source centre per target) */
function complete(img, hole, src, W, H, nnf, iters, rnd) {
  // targets: every patch centre whose patch touches the hole
  const T = [];
  const isT = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (hole[i]) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const j = Y * W + X; if (!isT[j]) { isT[j] = 1; }
    }
  }
  for (let i = 0; i < W * H; i++) if (isT[i]) T.push(i);
  const S = []; for (let i = 0; i < W * H; i++) if (src[i]) S.push(i);
  if (!S.length || !T.length) return nnf;
  const dist = (p, q, best) => {
    const px = p % W, py = (p / W) | 0, qx = q % W, qy = (q / W) | 0;
    let d = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) {
      const Y = py + dy; if (Y < 0 || Y >= H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const X = px + dx; if (X < 0 || X >= W) continue;
        const a = (Y * W + X) * 3, b = ((qy + dy) * W + qx + dx) * 3;
        const e0 = img[a] - img[b], e1 = img[a + 1] - img[b + 1], e2 = img[a + 2] - img[b + 2];
        d += e0 * e0 + e1 * e1 + e2 * e2; n++;
        if (d > best * n) return Infinity;   // (per-pixel mean already worse)
      }
    }
    return d / n;
  };
  const NF = nnf || new Int32Array(W * H).fill(-1), D = new Float32Array(W * H).fill(Infinity);
  for (const p of T) { if (NF[p] < 0 || !src[NF[p]]) NF[p] = S[(rnd() * S.length) | 0]; D[p] = dist(p, NF[p], Infinity); }
  const out = new Float32Array(W * H * 3), wsum = new Float32Array(W * H);
  for (let it = 0; it < iters; it++) {
    // search: propagation from the scan-order neighbours + random search around the current match
    for (let pass = 0; pass < 2; pass++) {
      const dir = (it * 2 + pass) % 2 ? -1 : 1;
      for (let t = dir > 0 ? 0 : T.length - 1; t >= 0 && t < T.length; t += dir) {
        const p = T[t], px = p % W;
        for (const nb of [p - dir, p - dir * W]) {
          if (nb < 0 || nb >= W * H || !isT[nb] || (nb === p - dir && Math.abs((nb % W) - px) !== 1)) continue;
          const q = NF[nb] + (p - nb);
          if (q < 0 || q >= W * H || !src[q] || Math.abs((q % W) - (NF[nb] % W)) > 1) continue;
          const d = dist(p, q, D[p]); if (d < D[p]) { D[p] = d; NF[p] = q; }
        }
        let rad = Math.max(W, H);
        const cx = NF[p] % W, cy = (NF[p] / W) | 0;
        while (rad >= 1) {
          const X = Math.round(cx + (rnd() * 2 - 1) * rad), Y = Math.round(cy + (rnd() * 2 - 1) * rad);
          if (X >= 0 && Y >= 0 && X < W && Y < H) {
            const q = Y * W + X;
            if (src[q]) { const d = dist(p, q, D[p]); if (d < D[p]) { D[p] = d; NF[p] = q; } }
          }
          rad >>= 1;
        }
      }
    }
    // vote: each hole pixel = the weighted mean of what the patches over it say it is
    out.fill(0); wsum.fill(0);
    for (const p of T) {
      const q = NF[p], px = p % W, py = (p / W) | 0, qx = q % W, qy = (q / W) | 0;
      const wt = Math.exp(-D[p] / 200);
      for (let dy = -R; dy <= R; dy++) {
        const Y = py + dy; if (Y < 0 || Y >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const X = px + dx; if (X < 0 || X >= W) continue;
          const a = Y * W + X; if (!hole[a]) continue;
          const b = ((qy + dy) * W + qx + dx) * 3;
          out[a * 3] += img[b] * wt; out[a * 3 + 1] += img[b + 1] * wt; out[a * 3 + 2] += img[b + 2] * wt; wsum[a] += wt;
        }
      }
    }
    for (let a = 0; a < W * H; a++) if (hole[a] && wsum[a] > 0) for (let c = 0; c < 3; c++) img[a * 3 + c] = out[a * 3 + c] / wsum[a];
    for (const p of T) D[p] = dist(p, NF[p], Infinity);
  }
  return NF;
}

/** patch centres whose whole 7×7 patch is known fabric */
function sources(known, W, H) {
  const s = new Uint8Array(W * H);
  for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
    let ok = 1;
    for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R; dx++) if (!known[(y + dy) * W + x + dx]) { ok = 0; break; }
    s[y * W + x] = ok;
  }
  return s;
}

export function fillFabric(rgba, W, H, hole, known) {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const img0 = new Float32Array(W * H * 3), k0 = new Uint8Array(W * H), h0 = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { h0[i] = hole[i] ? 1 : 0; k0[i] = known[i] && !hole[i] ? 1 : 0; for (let c = 0; c < 3; c++) img0[i * 3 + c] = rgba[i * 4 + c]; }
  const levels = [{ img: img0, hole: h0, known: k0, W, H }];
  while (levels.length < 6 && Math.min(levels.at(-1).W, levels.at(-1).H) > 48) levels.push(down(levels.at(-1)));
  let nnf = null, prev = null;
  for (let l = levels.length - 1; l >= 0; l--) {
    const L = levels[l], n = L.W * L.H;
    if (!prev) diffuse(L.img, L.hole, L.W, L.H);
    else {
      // the coarser level's answer (its pixels and its matches) is the start here
      const P = prev;
      for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
        const i = y * L.W + x; if (!L.hole[i]) continue;
        const j = Math.min(P.H - 1, y >> 1) * P.W + Math.min(P.W - 1, x >> 1);
        for (let c = 0; c < 3; c++) L.img[i * 3 + c] = P.img[j * 3 + c];
      }
      const up = new Int32Array(n).fill(-1);
      for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
        const j = Math.min(P.H - 1, y >> 1) * P.W + Math.min(P.W - 1, x >> 1), q = nnf[j];
        if (q < 0) continue;
        const X = Math.min(L.W - 1, 2 * (q % P.W) + (x & 1)), Y = Math.min(L.H - 1, 2 * ((q / P.W) | 0) + (y & 1));
        up[y * L.W + x] = Y * L.W + X;
      }
      nnf = up;
    }
    // patches are copied from the garment's own fabric only
    nnf = complete(L.img, L.hole, sources(L.known, L.W, L.H), L.W, L.H, nnf, l === 0 ? 3 : 5, rnd);
    prev = L;
  }
  for (let i = 0; i < W * H; i++) if (hole[i]) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(img0[i * 3 + c])));
  return rgba;
}
