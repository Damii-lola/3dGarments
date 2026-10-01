/**
 * A loose garment stands off the body (drape.js) — so in a pose an arm resting at the side, or a hand on the hip or
 * behind the back, ends up inside the fabric's hang. Whatever of the body isn't under the garment (the arms, the
 * hands) pushes the fabric in: per garment vertex a factor on its hang (`drapeK`, 0 … 1) — the fabric comes in to the
 * limb's surface, the dent spread smoothly round it — recomputed after every pose.
 *
 *   const c = limbCollider(garment, bodyMesh, limbVerts, { pad });   c.update()   (after the skeleton moved)
 */
const CELL = 0.03;

/** typed-array skinning of rest points: out = bindInv · Σ w·boneMatrix · bind · p (w = 1: a point, 0: a direction) */
function skinner(mesh) {
  const bm = mesh.skeleton.boneMatrices, B = mesh.bindMatrix.elements, BI = mesh.bindMatrixInverse.elements, M = new Float64Array(16);
  return (si, sw, o, x, y, z, w, out) => {
    M.fill(0);
    for (let k = 0; k < 4; k++) { const b = sw[o + k]; if (!b) continue; const j = si[o + k] * 16; for (let c = 0; c < 16; c++) M[c] += bm[j + c] * b; }
    // bind · p
    const px = B[0] * x + B[4] * y + B[8] * z + B[12] * w, py = B[1] * x + B[5] * y + B[9] * z + B[13] * w, pz = B[2] * x + B[6] * y + B[10] * z + B[14] * w;
    const qx = M[0] * px + M[4] * py + M[8] * pz + M[12] * w, qy = M[1] * px + M[5] * py + M[9] * pz + M[13] * w, qz = M[2] * px + M[6] * py + M[10] * pz + M[14] * w;
    out[0] = BI[0] * qx + BI[4] * qy + BI[8] * qz + BI[12] * w; out[1] = BI[1] * qx + BI[5] * qy + BI[9] * qz + BI[13] * w; out[2] = BI[2] * qx + BI[6] * qy + BI[10] * qz + BI[14] * w;
  };
}

/**
 * @param garment  the layered garment (SkinnedMesh; attributes drape, drapeT, drapeW, drapeK)
 * @param body     the body's SkinnedMesh
 * @param limbs    body vertex indices that push (skin of the arms and hands)
 * @param pad      { [bodyIndex]: metres } the limb's own clearance there (a sleeve over it: its hang), else 6 mm
 */
export function limbCollider(garment, body, limbs, pad = {}) {
  const geo = garment.geometry, A = geo.attributes, n = A.position.count;
  const P = A.position.array, MP = () => A.morphPos?.array, D = A.drape.array, DT = A.drapeT.array, DW = A.drapeW.array;
  const SI = A.skinIndex.array, SW = A.skinWeight.array, K = A.drapeK;
  const bg = body.geometry, BP = bg.attributes.position.array, BSI = bg.attributes.skinIndex.array, BSW = bg.attributes.skinWeight.array;
  // only the vertices that hang off the body at all
  const act = [];
  // (the torso's hang: a sleeve hangs off its own arm — the arm doesn't push it)
  for (let i = 0; i < n; i++) { const t = Math.hypot(DT[i * 3], DT[i * 3 + 1], DT[i * 3 + 2]); if (t > 0.003 && t > Math.hypot(D[i * 3], D[i * 3 + 1], D[i * 3 + 2])) act.push(i); }
  // neighbours on the garment (for the dent's smoothing)
  const idx = geo.index.array, deg = new Uint32Array(n + 1);
  for (let t = 0; t < idx.length; t++) deg[idx[t] + 1] += 2;
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const nb = new Uint32Array(deg[n]), fill = deg.slice(0, n);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
  const limbPad = Float32Array.from(limbs, (i) => pad[i] ?? 0.006);

  return {
    update() {
      body.skeleton.update(); garment.skeleton.update();
      body.userData.cpuMorphUpdate?.(); garment.userData.cpuMorphUpdate?.();
      const skinB = skinner(body), skinG = skinner(garment), bmp = bg.attributes.morphPos?.array, gmp = MP();
      // the limbs, posed, in a hash of 3 cm cells
      const L = new Float32Array(limbs.length * 3), o = [0, 0, 0], cells = new Map();
      limbs.forEach((i, k) => {
        skinB(BSI, BSW, i * 4, BP[i * 3] + (bmp ? bmp[i * 3] : 0), BP[i * 3 + 1] + (bmp ? bmp[i * 3 + 1] : 0), BP[i * 3 + 2] + (bmp ? bmp[i * 3 + 2] : 0), 1, o);
        L[k * 3] = o[0]; L[k * 3 + 1] = o[1]; L[k * 3 + 2] = o[2];
        const key = `${Math.floor(o[0] / CELL)},${Math.floor(o[1] / CELL)},${Math.floor(o[2] / CELL)}`;
        let c = cells.get(key); if (!c) cells.set(key, (c = [])); c.push(k);
      });
      const k0 = new Float32Array(n).fill(1), b = [0, 0, 0], f = [0, 0, 0], t = [0, 0, 0];
      let hit = 0;
      for (const i of act) {
        const x = P[i * 3] + (gmp ? gmp[i * 3] : 0), y = P[i * 3 + 1] + (gmp ? gmp[i * 3 + 1] : 0), z = P[i * 3 + 2] + (gmp ? gmp[i * 3 + 2] : 0);
        skinG(SI, SW, i * 4, x, y, z, 1, b);
        skinG(SI, SW, i * 4, x + D[i * 3], y + D[i * 3 + 1], z + D[i * 3 + 2], 1, f);
        skinG(SI, DW, i * 4, DT[i * 3], DT[i * 3 + 1], DT[i * 3 + 2], 0, t);
        f[0] += t[0]; f[1] += t[1]; f[2] += t[2];
        const ox = f[0] - b[0], oy = f[1] - b[1], oz = f[2] - b[2], len = Math.hypot(ox, oy, oz);
        if (len < 0.002) continue;
        const ux = ox / len, uy = oy / len, uz = oz / len;
        // the limb points near the fabric's hang: one inside it (between the body and where the fabric hangs, within
        // its pad of that line) brings the fabric in to just outside of it
        const cx = Math.floor(f[0] / CELL), cy = Math.floor(f[1] / CELL), cz = Math.floor(f[2] / CELL);
        let kk = 1;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const c = cells.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!c) continue;
          for (const q of c) {
            const px = L[q * 3] - b[0], py = L[q * 3 + 1] - b[1], pz = L[q * 3 + 2] - b[2], s = px * ux + py * uy + pz * uz;
            if (s <= 0) continue;
            const pad0 = limbPad[q];
            if (s > len + pad0) continue;
            const d2 = (px - s * ux) ** 2 + (py - s * uy) ** 2 + (pz - s * uz) ** 2, r = 0.012 + pad0;
            if (d2 > r * r) continue;
            kk = Math.min(kk, Math.max(0, (s - pad0 - 0.004) / len));
          }
        }
        if (kk < 1) { k0[i] = kk; hit++; }
      }
      // the dent spread: only ever lowered, toward the neighbours' mean (a smooth hollow, not a pinch)
      let k = k0;
      if (hit) for (let it = 0; it < 14; it++) {
        const nk = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let m = 0; const a = deg[i], e = deg[i + 1];
          for (let j = a; j < e; j++) m += k[nb[j]];
          nk[i] = e > a ? Math.min(k[i], 0.5 * k[i] + 0.5 * m / (e - a) + 0.04) : k[i];
        }
        k = nk;
      }
      let changed = false;
      for (let i = 0; i < n; i++) if (K.array[i] !== k[i]) { K.array[i] = k[i]; changed = true; }
      if (changed) K.needsUpdate = true;
      return hit;
    },
  };
}


