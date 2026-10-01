/**
 * A layered garment as a real 3D piece of fabric: the body-surface triangles it covers, refined along its outline and
 * cut exactly where the photo's outline runs (marching triangles on the texture's alpha), then given its thickness —
 * an outer face, an inner face (seen inside an open front, a collar, a sleeve end) and a rim along every edge.
 *
 * Every vertex is a weighted mix of body vertices (src: [[bodyIndex, weight] …]): its rest position, normal, skin
 * weights, shape morphs and bodysuit offset are mixed the same way, so it moves with the body exactly.
 *
 *   const shell = buildShell(g, pieces, { thick });
 *   pieces: [{ tris: [[a, b, c] body vertex triples], uvs: [[[u, v] × 3] …], alpha(u, v) → 0 … 1, group,
 *              seam?: Float32Array (per body vertex, > 0 on this piece's side of a seam: it's cut there too),
 *              raise?(u, v) → metres the outer face stands further out there (a folded hem, a collar, a rolled cuff) }]
 *   → { geometry (attributes: position, normal, uv, skinIndex, skinWeight, suitGap, suitNrm, shellOff, shellN; morphs;
 *       groups per piece: outer + inner = group*2, rim = group*2 + 1) }
 */
import * as THREE from 'three';

const ISO = 0.5;

/** mix two vertex records */
function mix(a, b, t) {
  const src = new Map();
  for (const [i, w] of a.src) src.set(i, (src.get(i) || 0) + w * (1 - t));
  for (const [i, w] of b.src) src.set(i, (src.get(i) || 0) + w * t);
  return { src: [...src].filter(([, w]) => w > 1e-6), uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t] };
}

export function buildShell(g, pieces, { thick = 0.0012, levels = 2, drape = null } = {}) {
  const V = [];                                    // vertex records { src, uv, a }
  const out = [];                                  // per piece: { tris: [local ids], group }
  for (const piece of pieces) {
    // inside: the photo's alpha, and where the piece has a seam (a sleeve's armhole) its own side of it — a scalar on
    // the body's vertices (> 0: this piece's side), mixed like everything else, so the seam is a smooth line too
    const seamOf = (src) => { let sv = 0; for (const [i, w] of src) sv += piece.seam[i] * w; return sv; };
    const alphaOf = (r) => { const a = piece.alpha(r.uv[0], r.uv[1]); return piece.seam ? Math.min(a, 0.5 + 4 * (r.sv ??= seamOf(r.src))) : a; };
    const key = new Map(), vid = (bodyIdx, uv) => {
      const k = `${bodyIdx}:${uv[0] >= 1 ? 1 : 0}`;
      let o = key.get(k);
      if (o === undefined) { o = V.length; key.set(k, o); const r = { src: [[bodyIdx, 1]], uv: uv.slice() }; r.a = alphaOf(r); V.push(r); }
      return o;
    };
    let tris = piece.tris.map((t, k) => t.map((b, c) => vid(b, piece.uvs[k][c])));
    // refined along the outline: triangles whose corners disagree (in / out) split in four, `levels` times
    const mid = new Map();
    const midOf = (p, q) => {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      let o = mid.get(k);
      if (o === undefined) { o = V.length; mid.set(k, o); const r = mix(V[p], V[q], 0.5); r.a = alphaOf(r); V.push(r); }
      return o;
    };
    for (let l = 0; l < levels; l++) {
      const next = [];
      for (const [p, q, r] of tris) {
        const ins = [p, q, r].map((i) => V[i].a >= ISO);
        // (also where the outer face steps up: a hem fold's, a collar's edge — so the step is smooth)
        let rs = 0;
        if (piece.raise) { const rr = [p, q, r].map((i) => (V[i].rz ??= piece.raise(V[i].uv[0], V[i].uv[1]))); rs = Math.max(...rr) - Math.min(...rr); }
        if (ins[0] === ins[1] && ins[1] === ins[2] && rs < 0.0005) { next.push([p, q, r]); continue; }
        const pq = midOf(p, q), qr = midOf(q, r), rp = midOf(r, p);
        next.push([p, pq, rp], [pq, q, qr], [rp, qr, r], [pq, qr, rp]);
      }
      // conforming: a triangle left whole beside a split one gets that edge's midpoint too (no T-junction: it would
      // open a hairline crack once the faces are pushed out and skinned)
      const has = (p, q) => mid.get(p < q ? `${p}_${q}` : `${q}_${p}`);
      tris = [];
      for (const [p, q, r] of next) {
        const m = [has(p, q), has(q, r), has(r, p)], c = [p, q, r];
        if (m.every((x) => x === undefined)) { tris.push([p, q, r]); continue; }
        // the polygon round the triangle with its midpoints, fanned from a corner whose two edges aren't both split
        const poly = [];
        for (let e = 0; e < 3; e++) { poly.push(c[e]); if (m[e] !== undefined) poly.push(m[e]); }
        let s0 = 0;
        for (let e = 0; e < 3; e++) if (m[e] === undefined || m[(e + 2) % 3] === undefined) { s0 = poly.indexOf(c[e]); break; }
        const rot = [...poly.slice(s0), ...poly.slice(0, s0)];
        for (let k = 1; k + 1 < rot.length; k++) tris.push([rot[0], rot[k], rot[k + 1]]);
      }
    }
    // cut on the outline (Sutherland–Hodgman against alpha ≥ ½; crossing points shared by both triangles of an edge)
    const cross = new Map();
    const crossOf = (p, q) => {
      const k = p < q ? `${p}x${q}` : `${q}x${p}`;
      let o = cross.get(k);
      if (o === undefined) {
        // where along the edge the photo's outline really is: bisection on the texture's alpha (a straight
        // interpolation of the ends' alphas puts it mid-edge across a sharp outline: a saw-tooth edge)
        const [lo, hi] = p < q ? [p, q] : [q, p], A0 = V[lo], A1 = V[hi], inLo = A0.a >= ISO;
        let t0 = 0, t1 = 1;
        for (let it = 0; it < 8; it++) {
          const tm = (t0 + t1) / 2, u = A0.uv[0] + (A1.uv[0] - A0.uv[0]) * tm, v = A0.uv[1] + (A1.uv[1] - A0.uv[1]) * tm;
          let a = piece.alpha(u, v);
          if (piece.seam) a = Math.min(a, 0.5 + 4 * ((A0.sv ??= seamOf(A0.src)) * (1 - tm) + (A1.sv ??= seamOf(A1.src)) * tm));
          if ((a >= ISO) === inLo) t0 = tm; else t1 = tm;
        }
        o = V.length; cross.set(k, o); const r = mix(A0, A1, (t0 + t1) / 2); r.a = ISO; V.push(r);
      }
      return o;
    };
    const kept = [];
    for (const tri of tris) {
      const ins = tri.map((i) => V[i].a >= ISO);
      if (ins.every(Boolean)) { kept.push(tri); continue; }
      if (!ins.some(Boolean)) continue;
      const poly = [];
      for (let e = 0; e < 3; e++) {
        const p = tri[e], q = tri[(e + 1) % 3], ip = ins[e], iq = ins[(e + 1) % 3];
        if (ip) poly.push(p);
        if (ip !== iq) poly.push(crossOf(p, q));
      }
      for (let k = 1; k + 1 < poly.length; k++) kept.push([poly[0], poly[k], poly[k + 1]]);
    }
    out.push({ tris: kept, group: piece.group });
  }

  /* ---- the vertices' attributes, mixed from the body's ---- */
  const A = g.attributes, P = A.position.array, N = A.normal.array, SG = A.suitGap?.array, SN = (A.suitNrm || A.normal).array;
  const SI = A.skinIndex.array, SW = A.skinWeight.array, MP = g.morphAttributes.position || [], MN = g.morphAttributes.normal || [];
  const used = new Set(); for (const p of out) for (const t of p.tris) for (const i of t) used.add(i);
  // layout: per piece: outer verts, inner verts, rim verts
  const srcS = [0], srcI = [], srcW = [];
  const pos = [], nrm = [], uv = [], si = [], sw = [], gap = [], sn = [], off = [], shN = [], dr = [], drT = [], drB = [], mpos = MP.map(() => []), mnrm = MN.map(() => []);
  const index = [], groups = [];
  const emit = (r, layer, rimN, raise = 0) => {
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0, gp = 0, sx = 0, sy = 0, sz = 0, ddx = 0, ddy = 0, ddz = 0, tdx = 0, tdy = 0, tdz = 0;
    const bones = new Map();
    for (const [i, w] of r.src) {
      x += P[i * 3] * w; y += P[i * 3 + 1] * w; z += P[i * 3 + 2] * w;
      if (drape) {
        ddx += drape.all[i * 3] * w; ddy += drape.all[i * 3 + 1] * w; ddz += drape.all[i * 3 + 2] * w;
        tdx += drape.torso[i * 3] * w; tdy += drape.torso[i * 3 + 1] * w; tdz += drape.torso[i * 3 + 2] * w;
      }
      nx += N[i * 3] * w; ny += N[i * 3 + 1] * w; nz += N[i * 3 + 2] * w;
      sx += SN[i * 3] * w; sy += SN[i * 3 + 1] * w; sz += SN[i * 3 + 2] * w;
      gp += (SG ? SG[i] : 0.0015) * w;
      for (let k = 0; k < 4; k++) { const b = SI[i * 4 + k], bw = SW[i * 4 + k] * w; if (bw > 0) bones.set(b, (bones.get(b) || 0) + bw); }
    }
    const top = [...bones].sort((p, q) => q[1] - p[1]).slice(0, 4), tw = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) { si.push(top[k] ? top[k][0] : 0); sw.push(top[k] ? top[k][1] / tw : 0); }
    torsoW(drB, top, drape);
    for (const [i, w] of r.src) { srcI.push(i); srcW.push(w); } srcS.push(srcI.length);
    const sl = Math.hypot(sx, sy, sz) || 1;
    pos.push(x, y, z); nrm.push(nx, ny, nz); uv.push(r.uv[0], r.uv[1]); gap.push(gp); sn.push(sx / sl, sy / sl, sz / sl);
    dr.push(ddx, ddy, ddz); drT.push(tdx, tdy, tdz);
    off.push(layer === 'inner' ? 0 : layer === 'rimIn' ? 0 : thick + raise);
    const sgn = layer === 'inner' ? -1 : 1;
    if (rimN) shN.push(rimN[0], rimN[1], rimN[2]); else shN.push(sgn * sx / sl, sgn * sy / sl, sgn * sz / sl);
    MP.forEach((m, t) => {
      let dx = 0, dy = 0, dz = 0; const a = m.array;
      for (const [i, w] of r.src) { dx += a[i * 3] * w; dy += a[i * 3 + 1] * w; dz += a[i * 3 + 2] * w; }
      mpos[t].push(dx, dy, dz);
    });
    MN.forEach((m, t) => {
      let dx = 0, dy = 0, dz = 0; const a = m.array;
      for (const [i, w] of r.src) { dx += a[i * 3] * w; dy += a[i * 3 + 1] * w; dz += a[i * 3 + 2] * w; }
      mnrm[t].push(dx, dy, dz);
    });
    return pos.length / 3 - 1;
  };
  for (const piece of out) {
    if (!piece.tris.length) continue;
    const loc = new Map(), inner = new Map();
    const lift = (r) => (piece.raise ? piece.raise(r.uv[0], r.uv[1]) : 0);
    const o = (i) => { let k = loc.get(i); if (k === undefined) { k = emit(V[i], 'outer', null, lift(V[i])); loc.set(i, k); } return k; };
    const inn = (i) => { let k = inner.get(i); if (k === undefined) { k = emit(V[i], 'inner'); inner.set(i, k); } return k; };
    const s0 = index.length;
    for (const [a, b, c] of piece.tris) index.push(o(a), o(b), o(c));
    for (const [a, b, c] of piece.tris) index.push(inn(a), inn(c), inn(b));          // the inside, facing in
    groups.push({ start: s0, count: index.length - s0, mat: piece.group * 2 });
    // the rim: every edge used by one triangle only, a wall from the outer face down to the inner one
    const edges = new Map();
    for (const t of piece.tris) for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3], k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const x = edges.get(k); if (x) x.n++; else edges.set(k, { a, b, n: 1 });
    }
    const s1 = index.length;
    for (const { a, b, n } of edges.values()) {
      if (n !== 1) continue;
      // outward across the edge: edge tangent × surface normal (the triangle lies to the edge's left, seen from outside)
      const pa = V[a], pb = V[b];
      const ra = emit(pa, 'outer', null, lift(pa)), rb = emit(pb, 'outer', null, lift(pb));
      const ex = pos[rb * 3] - pos[ra * 3], ey = pos[rb * 3 + 1] - pos[ra * 3 + 1], ez = pos[rb * 3 + 2] - pos[ra * 3 + 2];
      const nx = sn[ra * 3], ny = sn[ra * 3 + 1], nz = sn[ra * 3 + 2];
      let cx = ey * nz - ez * ny, cy = ez * nx - ex * nz, cz = ex * ny - ey * nx; const cl = Math.hypot(cx, cy, cz) || 1;
      cx /= cl; cy /= cl; cz /= cl;
      for (const k of [ra, rb]) shN.splice(k * 3, 3, cx, cy, cz);
      const ia = emit(pa, 'rimIn', [cx, cy, cz]), ib = emit(pb, 'rimIn', [cx, cy, cz]);
      index.push(ra, ib, rb, ra, ia, ib);
    }
    if (index.length > s1) groups.push({ start: s1, count: index.length - s1, mat: piece.group * 2 + 1 });
  }
  // the shading normals of the fabric as it hangs (the draped surface: its own folds, not the body's muscles)
  if (drape) {
    const tmp = new THREE.BufferGeometry(), dp = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i++) dp[i] = pos[i] + dr[i];
    tmp.setAttribute('position', new THREE.BufferAttribute(dp, 3)); tmp.setIndex(index); tmp.computeVertexNormals();
    const cn = tmp.attributes.normal.array;
    for (let i = 0; i < shN.length; i++) shN[i] = cn[i];
    tmp.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  setDrape(geo, dr, drT, drB);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setAttribute('suitGap', new THREE.Float32BufferAttribute(gap, 1));
  geo.setAttribute('suitNrm', new THREE.Float32BufferAttribute(sn, 3));
  geo.setAttribute('shellOff', new THREE.Float32BufferAttribute(off, 1));
  geo.setAttribute('shellN', new THREE.Float32BufferAttribute(shN, 3));
  geo.morphTargetsRelative = g.morphTargetsRelative;
  if (MP.length) geo.morphAttributes.position = mpos.map((a) => new THREE.Float32BufferAttribute(a, 3));
  if (MN.length) geo.morphAttributes.normal = mnrm.map((a) => new THREE.Float32BufferAttribute(a, 3));
  geo.setIndex(index);
  geo.userData.src = { start: Uint32Array.from(srcS), idx: Uint32Array.from(srcI), w: Float32Array.from(srcW), arm: drape ? drape.arm : null };
  for (const gr of groups) geo.addGroup(gr.start, gr.count, gr.mat);
  return geo;
}

/**
 * Small rigid pieces riding on a garment (buttons): each item hangs on an anchor (a mix of body vertices — its skin
 * weights, morphs and bodysuit offset), its vertices placed around it in the anchor's tangent plane.
 *   items: [{ src: [[bodyIndex, w] …], verts: [{ d: [dx, dy, dz] rest-space offset, off: metres out along the normal,
 *            n: [nx, ny, nz] shading normal, uv: [u, v] }], tris: [[a, b, c] local] }]
 */
/** the hang (drape.js): `drape` its share on the skin weights (the sleeves), `drapeT` the torso's on the vertex's
 *  torso bones alone (`drapeW`: its skin weights with the arms' taken out) */
function setDrape(geo, all, torso, w) {
  const rest = Float32Array.from(all, (v, k) => v - torso[k]);
  geo.setAttribute('drape', new THREE.Float32BufferAttribute(rest, 3));
  geo.setAttribute('drapeT', new THREE.Float32BufferAttribute(torso, 3));
  geo.setAttribute('drapeW', new THREE.Float32BufferAttribute(w, 4));
  geo.setAttribute('drapeK', new THREE.Float32BufferAttribute(new Float32Array(all.length / 3).fill(1), 1));   // collide.js
}
/**
 * The body's skin weights changed (human.js applyArmpit: the armpit's weights follow the arm's elevation): every
 * vertex's bones re-mixed from the body vertices it was made of, as the body has them now
 */
export function reskin(geo, g) {
  const S = geo.userData.src; if (!S) return;
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, dw = geo.attributes.drapeW;
  const bones = new Map(), arm = S.arm ? { arm: S.arm } : null, tmp = [];
  for (let v = 0; v + 1 < S.start.length; v++) {
    bones.clear();
    for (let k = S.start[v]; k < S.start[v + 1]; k++) {
      const i = S.idx[k], w = S.w[k];
      for (let c = 0; c < 4; c++) { const b = SI[i * 4 + c], bw = SW[i * 4 + c] * w; if (bw > 0) bones.set(b, (bones.get(b) || 0) + bw); }
    }
    const top = [...bones].sort((p, q) => q[1] - p[1]).slice(0, 4), tw = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (let c = 0; c < 4; c++) { si.array[v * 4 + c] = top[c] ? top[c][0] : 0; sw.array[v * 4 + c] = top[c] ? top[c][1] / tw : 0; }
    if (dw) { tmp.length = 0; torsoW(tmp, top, arm); for (let c = 0; c < 4; c++) dw.array[v * 4 + c] = tmp[c]; }
  }
  si.needsUpdate = sw.needsUpdate = true;
  if (dw) dw.needsUpdate = true;
}

function torsoW(out, top, drape) {
  const w = [0, 1, 2, 3].map((k) => (top[k] && !(drape && drape.arm[top[k][0]]) ? top[k][1] : 0)), s = w[0] + w[1] + w[2] + w[3];
  if (s > 0) out.push(w[0] / s, w[1] / s, w[2] / s, w[3] / s); else out.push(...w.map((_, k) => (top[k] ? top[k][1] : 0)));
}

export function buildAnchored(g, items, drape = null) {
  const A = g.attributes, P = A.position.array, SG = A.suitGap?.array, SN = (A.suitNrm || A.normal).array;
  const SI = A.skinIndex.array, SW = A.skinWeight.array, MP = g.morphAttributes.position || [], MN = g.morphAttributes.normal || [];
  const srcS = [0], srcI = [], srcW = [];
  const pos = [], uv = [], si = [], sw = [], gap = [], sn = [], off = [], shN = [], dr = [], drT = [], drB = [], mpos = MP.map(() => []), mnrm = MN.map(() => []), index = [];
  for (const it of items) {
    let x = 0, y = 0, z = 0, gp = 0, sx = 0, sy = 0, sz = 0, ddx = 0, ddy = 0, ddz = 0, tdx = 0, tdy = 0, tdz = 0; const bones = new Map();
    for (const [i, w] of it.src) {
      if (drape) {
        ddx += drape.all[i * 3] * w; ddy += drape.all[i * 3 + 1] * w; ddz += drape.all[i * 3 + 2] * w;
        tdx += drape.torso[i * 3] * w; tdy += drape.torso[i * 3 + 1] * w; tdz += drape.torso[i * 3 + 2] * w;
      }
      x += P[i * 3] * w; y += P[i * 3 + 1] * w; z += P[i * 3 + 2] * w; gp += (SG ? SG[i] : 0.0015) * w;
      sx += SN[i * 3] * w; sy += SN[i * 3 + 1] * w; sz += SN[i * 3 + 2] * w;
      for (let k = 0; k < 4; k++) { const b = SI[i * 4 + k], bw = SW[i * 4 + k] * w; if (bw > 0) bones.set(b, (bones.get(b) || 0) + bw); }
    }
    const top = [...bones].sort((p, q) => q[1] - p[1]).slice(0, 4), tw = top.reduce((s, [, w]) => s + w, 0) || 1;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const md = MP.map((m) => { let dx = 0, dy = 0, dz = 0; for (const [i, w] of it.src) { dx += m.array[i * 3] * w; dy += m.array[i * 3 + 1] * w; dz += m.array[i * 3 + 2] * w; } return [dx, dy, dz]; });
    const mn = MN.map((m) => { let dx = 0, dy = 0, dz = 0; for (const [i, w] of it.src) { dx += m.array[i * 3] * w; dy += m.array[i * 3 + 1] * w; dz += m.array[i * 3 + 2] * w; } return [dx, dy, dz]; });
    const base = pos.length / 3;
    for (const v of it.verts) {
      pos.push(x + v.d[0], y + v.d[1], z + v.d[2]); uv.push(v.uv[0], v.uv[1]); gap.push(gp); sn.push(sx / sl, sy / sl, sz / sl);
      dr.push(ddx, ddy, ddz); drT.push(tdx, tdy, tdz);
      off.push(v.off); shN.push(v.n[0], v.n[1], v.n[2]);
      for (let k = 0; k < 4; k++) { si.push(top[k] ? top[k][0] : 0); sw.push(top[k] ? top[k][1] / tw : 0); }
      torsoW(drB, top, drape);
      for (const [i, w] of it.src) { srcI.push(i); srcW.push(w); } srcS.push(srcI.length);
      md.forEach((d, t) => mpos[t].push(...d)); mn.forEach((d, t) => mnrm[t].push(...d));
    }
    for (const t of it.tris) index.push(base + t[0], base + t[1], base + t[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(shN, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  setDrape(geo, dr, drT, drB);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setAttribute('suitGap', new THREE.Float32BufferAttribute(gap, 1));
  geo.setAttribute('suitNrm', new THREE.Float32BufferAttribute(sn, 3));
  geo.setAttribute('shellOff', new THREE.Float32BufferAttribute(off, 1));
  geo.setAttribute('shellN', new THREE.Float32BufferAttribute(shN, 3));
  geo.morphTargetsRelative = g.morphTargetsRelative;
  if (MP.length) geo.morphAttributes.position = mpos.map((a) => new THREE.Float32BufferAttribute(a, 3));
  if (MN.length) geo.morphAttributes.normal = mnrm.map((a) => new THREE.Float32BufferAttribute(a, 3));
  geo.setIndex(index);
  geo.userData.src = { start: Uint32Array.from(srcS), idx: Uint32Array.from(srcI), w: Float32Array.from(srcW), arm: drape ? drape.arm : null };
  return geo;
}
