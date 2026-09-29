/**
 * Body shape: anatomical morph targets built from the model itself at load time, and real
 * measurements of the result (weight from volume, tape-measure girths).
 *
 * Every target is a displacement field in the bind (rest) mesh, unit influence = a strong but
 * believable version of the feature; influences may be negative. Fields are placed with the skin
 * weights (which bone a vertex follows) and landmarks found on the mesh (breast apexes, glute
 * apexes, waist, hips, crotch), then smoothed over the surface so nothing creases. Clothing
 * (_PART 4) follows the nearest skin, so the underwear stays on whatever the body does.
 *
 *   belly   abdomen forward (lower belly, navel)        waist   torso girth at the natural waist
 *   bust    breasts (female) / pecs (male)              chest   ribcage breadth
 *   glutes  projection + lift                           hips    pelvis / upper-thigh breadth
 *   thighs  thigh girth, most on the inner thigh        fat     body fat, sex-specific distribution
 *   muscle  definition (surface detail) + muscle volume core    abdominal definition only
 *
 * Space: metres, y up, facing +z, left = +x, feet on y = 0.
 */

export const SHAPE_TARGETS = ['belly', 'waist', 'bust', 'chest', 'glutes', 'hips', 'thighs', 'fat', 'muscle', 'core'];
export const DENSITY = 1010; // kg/m³, whole body (lungs included)

/** Math.hypot is slow in hot loops */
const hyp = (...v) => { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 1 at c, falling to 0 at c − down and c + up (raised cosine) */
const bump = (x, c, down, up) => {
  const d = x < c ? (c - x) / down : (x - c) / up;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};

/** @param bindPos bind-pose world position of every bone (Body.bindPos) */
export function buildShape(mesh, bones, sex, bindPosArr) {
  const g = mesh.geometry;
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
  const part = g.attributes._part.array, index = g.index.array;
  const N = pos.length / 3;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const bi = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const bindPos = (n) => bindPosArr[bi[n]].clone();

  /* ---------------- per-vertex bone groups ---------------- */
  const GROUP = { pelvis: 'T', spine_01: 'T', spine_02: 'T', spine_03: 'T', neck_01: 'N', head: 'H', clavicle_l: 'C', clavicle_r: 'C',
    upperarm_l: 'U', upperarm_r: 'U', lowerarm_l: 'F', lowerarm_r: 'F', thigh_l: 'TL', thigh_r: 'TR', calf_l: 'K', calf_r: 'K' };
  const groupOf = bones.map((b) => GROUP[b.name] || (/^(hand|thumb|index|middle|ring|pinky)/.test(b.name) ? 'P' : /^(foot|ball)/.test(b.name) ? 'X' : 'O'));
  const W = {}; for (const k of ['T', 'N', 'H', 'C', 'U', 'F', 'TL', 'TR', 'K', 'P', 'X']) W[k] = new Float32Array(N);
  const dom = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    let best = -1, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k), b = si.getComponent(i, k);
      if (!w) continue;
      const G = groupOf[b];
      if (W[G]) W[G][i] += w;
      if (w > bw) { bw = w; best = b; }
    }
    dom[i] = Math.max(0, best);
  }
  const domGroup = (i) => groupOf[dom[i]];
  const skin = (i) => part[i] === 0;

  /* ---------------- mesh topology (skin only) ---------------- */
  const deg = new Uint32Array(N + 1);
  const T = index.length / 3;
  const skinTri = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    if (skin(a) && skin(b) && skin(c)) { skinTri[t] = 1; deg[a] += 2; deg[b] += 2; deg[c] += 2; }
  }
  const start = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) start[i + 1] = start[i] + deg[i];
  const nb = new Uint32Array(start[N]), fill = start.slice(0, N);
  for (let t = 0; t < T; t++) {
    if (!skinTri[t]) continue;
    const v = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    for (let k = 0; k < 3; k++) { const a = v[k]; nb[fill[a]++] = v[(k + 1) % 3]; nb[fill[a]++] = v[(k + 2) % 3]; }
  }
  /** uniform Laplacian smoothing of a per-vertex field with `dim` components (skin only) */
  const inv = new Float32Array(N);
  for (let i = 0; i < N; i++) inv[i] = start[i + 1] > start[i] ? 1 / (start[i + 1] - start[i]) : 0;
  const smoothField = (f, dim, iters, lambda = 0.5) => {
    let a = f, b = new Float32Array(f.length);
    for (let it = 0; it < iters; it++) {
      if (dim === 3) {
        for (let i = 0; i < N; i++) {
          const s0 = start[i], e = start[i + 1], o = i * 3;
          if (e === s0) { b[o] = a[o]; b[o + 1] = a[o + 1]; b[o + 2] = a[o + 2]; continue; }
          let x = 0, y = 0, z = 0;
          for (let j = s0; j < e; j++) { const q = nb[j] * 3; x += a[q]; y += a[q + 1]; z += a[q + 2]; }
          const k = inv[i];
          b[o] = a[o] + lambda * (x * k - a[o]); b[o + 1] = a[o + 1] + lambda * (y * k - a[o + 1]); b[o + 2] = a[o + 2] + lambda * (z * k - a[o + 2]);
        }
      } else {
        for (let i = 0; i < N; i++) {
          const s0 = start[i], e = start[i + 1];
          if (e === s0) { b[i] = a[i]; continue; }
          let x = 0;
          for (let j = s0; j < e; j++) x += a[nb[j]];
          b[i] = a[i] + lambda * (x * inv[i] - a[i]);
        }
      }
      [a, b] = [b, a];
    }
    return a;
  };
  // numeric spatial hash (2 cm cells) — string keys are the slow part otherwise
  const cellKey = (x, y, z) => ((Math.floor(x / 0.02) + 512) * 1024 + (Math.floor(y / 0.02) + 512)) * 1024 + (Math.floor(z / 0.02) + 512);

  /* ---------------- landmarks ---------------- */
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < N; i++) if (skin(i)) { yMin = Math.min(yMin, pos[i * 3 + 1]); yMax = Math.max(yMax, pos[i * 3 + 1]); }
  const H = yMax - yMin;
  const neckY = bindPos('neck_01').y;
  const torso = (i) => W.T[i] > 0.5 && skin(i);

  // torso centre line (z) per 1 cm slice
  const bins = Math.ceil(H / 0.01) + 1;
  const zLo = new Float32Array(bins).fill(Infinity), zHi = new Float32Array(bins).fill(-Infinity);
  for (let i = 0; i < N; i++) {
    if (!torso(i) || W.T[i] < 0.8) continue;
    const k = Math.round((pos[i * 3 + 1] - yMin) / 0.01);
    zLo[k] = Math.min(zLo[k], pos[i * 3 + 2]); zHi[k] = Math.max(zHi[k], pos[i * 3 + 2]);
  }
  let zc = new Float32Array(bins);
  let last = 0;
  for (let k = 0; k < bins; k++) if (Number.isFinite(zLo[k])) { last = (zLo[k] + zHi[k]) / 2; zc[k] = last; } else zc[k] = NaN;
  for (let k = 0; k < bins; k++) if (Number.isNaN(zc[k])) zc[k] = last; // (filled below from neighbours)
  for (let k = 1; k < bins; k++) if (!Number.isFinite(zLo[k]) && Number.isFinite(zc[k - 1])) zc[k] = zc[k - 1];
  for (let it = 0; it < 6; it++) { const c = zc.slice(); for (let k = 1; k < bins - 1; k++) zc[k] = (c[k - 1] + c[k] + c[k + 1]) / 3; }
  const zCentre = (y) => zc[Math.min(bins - 1, Math.max(0, Math.round((y - yMin) / 0.01)))];

  const pick = (filter, score) => {
    let best = -1, bs = -Infinity;
    for (let i = 0; i < N; i++) if (filter(i)) { const s = score(i); if (s > bs) { bs = s; best = i; } }
    return best;
  };
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const inY = (i, a, b) => pos[i * 3 + 1] >= yMin + a * H && pos[i * 3 + 1] <= yMin + b * H;
  // breast / pec apex per side: the most forward torso point in the chest band
  const F = sex === 'female';
  const apex = [1, -1].map((s) => P(pick((i) => torso(i) && inY(i, F ? 0.68 : 0.72, F ? 0.8 : 0.79) && s * pos[i * 3] > 0.04 && s * pos[i * 3] < 0.13, (i) => pos[i * 3 + 2])));
  const underY = apex[0][1] - (F ? 0.085 : 0.06) * H / 1.73;
  // glute apex per side: the most backward point of the hip band
  const glute = [1, -1].map((s) => P(pick((i) => skin(i) && (W.T[i] + W.TL[i] + W.TR[i]) > 0.6 && inY(i, 0.43, 0.58) && s * pos[i * 3] > 0.03, (i) => -pos[i * 3 + 2])));
  // crotch: lowest pelvis point near the midline
  const crotchY = pos[pick((i) => torso(i) && Math.abs(pos[i * 3]) < 0.02 && inY(i, 0.38, 0.6), (i) => -pos[i * 3 + 1]) * 3 + 1];
  // natural waist: the narrowest torso between hips and ribs; hips: the widest point below it
  const torsoVerts = [];
  for (let i = 0; i < N; i++) if (torso(i)) torsoVerts.push(i);
  const halfWidth = (filter, y) => {
    let m = 0, n = 0;
    for (const i of torsoVerts) if (Math.abs(pos[i * 3 + 1] - y) < 0.006) { m = Math.max(m, Math.abs(pos[i * 3])); n++; }
    return n >= 8 ? m : 0;
  };
  let waistY = yMin + 0.62 * H, wBest = Infinity;
  for (let y = yMin + 0.585 * H; y < Math.min(yMin + 0.67 * H, underY - 0.04); y += 0.005) {
    const w = halfWidth(torso, y);
    if (w > 0 && w < wBest) { wBest = w; waistY = y; }
  }
  const hipY = (glute[0][1] + glute[1][1]) / 2; // hips are taped over the fullest part of the seat
  const L = { H, yMin, neckY, apex, underY, glute, crotchY, waistY, hipY, sex, female: F };

  /* ---------------- skin under clothing (no surface-detail changes there: they'd poke through) ---------------- */
  const covered = new Float32Array(N);
  {
    const grid = new Map();
    for (let i = 0; i < N; i++) if (!skin(i)) {
      const k = cellKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]);
    }
    for (let i = 0; i < N; i++) {
      if (!skin(i) || !grid.size) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      let best = Infinity;
      for (let a = -0.02; a <= 0.021; a += 0.02) for (let b = -0.02; b <= 0.021; b += 0.02) for (let c = -0.02; c <= 0.021; c += 0.02) {
        const l = grid.get(cellKey(x + a, y + b, z + c));
        if (l) for (const j of l) { const dx = pos[j * 3] - x, dy = pos[j * 3 + 1] - y, dz = pos[j * 3 + 2] - z; best = Math.min(best, dx * dx + dy * dy + dz * dz); }
      }
      covered[i] = 1 - smooth(0.012, 0.03, Math.sqrt(best));
    }
  }

  /* ---------------- fields ---------------- */
  const D = Object.fromEntries(SHAPE_TARGETS.map((k) => [k, new Float32Array(N * 3)]));
  const nS = smoothField(Float32Array.from(nrm), 3, 10);
  for (let i = 0; i < N; i++) { const l = hyp(nS[i * 3], nS[i * 3 + 1], nS[i * 3 + 2]) || 1; nS[i * 3] /= l; nS[i * 3 + 1] /= l; nS[i * 3 + 2] /= l; }
  // surface detail: position minus its smoothed self (muscle / core definition)
  const detail = (() => {
    const s = smoothField(Float32Array.from(pos), 3, 14);
    const d = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) d[i] = pos[i] - s[i];
    return d;
  })();
  const scalar = { fat: new Float32Array(N), mvol: new Float32Array(N), def: new Float32Array(N), coreDef: new Float32Array(N) };
  const thighA = { l: bindPos('thigh_l'), r: bindPos('thigh_r') }, thighB = { l: bindPos('calf_l'), r: bindPos('calf_r') };
  const shoulderY = bindPos('upperarm_l').y;
  const joints = ['calf_l', 'calf_r', 'lowerarm_l', 'lowerarm_r', 'foot_l', 'foot_r'].map(bindPos);
  const underBust = underY;

  for (let i = 0; i < N; i++) {
    if (!skin(i)) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const side = x >= 0 ? 0 : 1, sg = x >= 0 ? 1 : -1;
    const zcy = zCentre(y), dz = z - zcy, r = hyp(x, dz) || 1;
    const cosF = dz / r;                                   // 1 front, −1 back, 0 at the sides
    const front = Math.max(0, cosF), back = Math.max(0, -cosF), sideW = 1 - Math.abs(cosF);
    const wT = W.T[i], wTh = W.TL[i] + W.TR[i];
    const o = i * 3;
    const add = (k, dx, dy, dz2) => { D[k][o] += dx; D[k][o + 1] += dy; D[k][o + 2] += dz2; };

    // belly: lower abdomen forward, peaking just below the navel
    // (rises from the pubic line, fullest just below the navel, fades into the ribs; wraps to the flanks)
    const span = underBust - crotchY;
    const sB = bump(y, crotchY + 0.47 * span, 0.5 * span, 0.72 * span);
    const bellyW = wT * sB * (Math.pow(front, 1.1) * 0.85 + 0.15 * sideW * sideW);
    if (bellyW > 0) { const ux = x / r * 0.5, uz = dz / r * 0.5 + 0.5, ul = hyp(ux, uz); add('belly', 0.065 * bellyW * ux / ul, -0.01 * bellyW * smooth(crotchY + 0.6 * span, crotchY + 0.2 * span, y), 0.065 * bellyW * uz / ul); }

    // waist: radial girth around the natural waist
    const sW = bump(y, waistY, 0.09 * H, 0.08 * H) * wT;
    if (sW > 0) add('waist', x * 0.16 * sW, 0, dz * 0.13 * sW);

    // chest: ribcage breadth (sideways), with the breasts carried along
    const sC = bump(y, apex[0][1] + 0.01, 0.12 * H / 1.73, 0.1 * H / 1.73) * Math.max(wT, W.C[i] * 0.5);
    if (sC > 0) add('chest', x * 0.12 * sC, 0, 0);

    // bust: scale each breast (pec) around its base on the chest wall
    for (const a of apex) {
      const R = F ? [0.1, 0.095, 0.1] : [0.095, 0.075, 0.08];
      const d = hyp((x - a[0]) / R[0], (y - a[1]) / R[1], (z - a[2]) / R[2]);
      const w = (1 - smooth(0.25, 1, d)) * smooth(-0.02, 0.03, dz) * Math.max(wT, W.C[i]);
      if (w <= 0) continue;
      const base = [a[0] * 0.92, a[1] + 0.006, a[2] - (F ? 0.08 : 0.035)];
      const k = F ? 0.42 : 0.4;
      add('bust', (x - base[0]) * k * w, (y - base[1]) * k * w - (F ? 0.018 : 0.004) * w, (z - base[2]) * k * w);
    }

    // glutes: rounder and higher
    {
      const a = glute[side];
      const d = hyp((x - a[0]) / 0.11, (y - a[1]) / 0.12, (z - a[2]) / 0.1);
      const w = (1 - smooth(0.3, 1, d)) * smooth(0.0, -0.04, dz) * Math.min(1, wT + wTh);
      if (w > 0) {
        const base = [a[0] * 0.9, a[1] + 0.005, a[2] + 0.08];
        add('glutes', (x - base[0]) * 0.34 * w, (y - base[1]) * 0.34 * w + 0.014 * w, (z - base[2]) * 0.34 * w);
      }
    }

    // hips: pelvis + upper outer thigh breadth
    const sH = bump(y, hipY, Math.max(0.08, hipY - crotchY + 0.12), waistY - hipY) * Math.min(1, wT + wTh);
    if (sH > 0) add('hips', x * 0.14 * sH * (0.4 + 0.6 * sideW), 0, dz * 0.03 * sH);

    // thighs: girth along the femur, most on the inner thigh (closes the thigh gap)
    if (wTh > 0.05) {
      const s = x >= 0 ? 'l' : 'r', A = thighA[s], B = thighB[s];
      const ax = B.x - A.x, ay = B.y - A.y, az = B.z - A.z, len2 = ax * ax + ay * ay + az * az;
      const t = ((x - A.x) * ax + (y - A.y) * ay + (z - A.z) * az) / len2;
      const rx = x - (A.x + ax * t), ry = y - (A.y + ay * t), rz = z - (A.z + az * t), rl = hyp(rx, ry, rz) || 1;
      const inner = Math.max(0, -sg * rx / rl);
      const w = (W.TL[i] + W.TR[i]) * smooth(-0.1, 0.12, t) * (1 - smooth(0.5, 0.95, t)) * (1 + 0.7 * inner);
      add('thighs', rx * 0.17 * w, ry * 0.17 * w, rz * 0.17 * w);
    }

    // fat thickness (m at influence 1), sex-specific distribution
    const upper = W.U[i], fore = W.F[i];
    const flank = wT * bump(y, (waistY + hipY) / 2, 0.1 * H, 0.1 * H) * sideW;
    const belly = wT * bump(y, crotchY + 0.45 * span, 0.55 * span, 0.8 * span) * Math.pow(front, 1.1);
    const tA = wTh > 0.05 ? (() => { const s = x >= 0 ? 'l' : 'r'; return (thighA[s].y - y) / (thighA[s].y - thighB[s].y); })() : 0;
    const thighProfile = wTh * (1 - smooth(0.2, 1.05, tA));
    const armBack = Math.max(0, -nrm[o + 2]) * 0.5 + Math.max(0, -sg * nrm[o]) * 0.2;
    const neck = W.N[i] * (y < neckY + 0.04 ? 1 : 0);
    const gl = (() => { const a = glute[side]; return 1 - smooth(0.3, 1.1, hyp((x - a[0]) / 0.13, (y - a[1]) / 0.14, (z - a[2]) / 0.12)); })();
    const hipSide = bump(y, hipY - 0.02, 0.14, 0.08) * Math.min(1, wT + wTh) * sideW;
    let bu = 0;
    for (const a of apex) bu = Math.max(bu, 1 - smooth(0.3, 1.1, hyp((x - a[0]) / 0.1, (y - a[1]) / 0.1, (z - a[2]) / 0.1)));
    bu *= front;
    const upperBack = wT * back * bump(y, underBust, 0.1 * H, 0.08 * H);
    scalar.fat[i] = F
      ? wT * 0.02 + belly * 0.026 + flank * 0.02 + upperBack * 0.01 + bu * 0.016 + gl * 0.02 + hipSide * 0.014 + thighProfile * 0.022
        + wTh * 0.006 + W.K[i] * 0.009 + upper * (0.018 + armBack * 0.018) + fore * 0.007 + neck * 0.01 + W.C[i] * 0.01
      : wT * 0.022 + belly * 0.034 + flank * 0.026 + upperBack * 0.01 + bu * 0.012 + gl * 0.012 + hipSide * 0.008 + thighProfile * 0.016
        + wTh * 0.005 + W.K[i] * 0.008 + upper * (0.015 + armBack * 0.01) + fore * 0.007 + neck * 0.014 + W.C[i] * 0.012;
    if (y > neckY + 0.05) scalar.fat[i] = 0;

    // muscle: definition everywhere but head, hands and feet; volume where training shows
    let joint = 0;
    for (const J of joints) joint = Math.max(joint, 1 - smooth(0.035, 0.09, hyp(x - J.x, y - J.y, z - J.z)));
    const body = (1 - Math.max(W.H[i], W.P[i], W.X[i], smooth(neckY - 0.02, neckY + 0.05, y))) * (1 - joint);
    scalar.def[i] = body;
    const delt = (upper + W.C[i]) * bump(y, shoulderY - 0.02, 0.12, 0.06);
    scalar.mvol[i] = delt * 0.01 + upper * 0.004 + fore * 0.003 + thighProfile * 0.006 + W.K[i] * 0.006 + gl * 0.005
      + (F ? 0.002 : 0.007) * bu + (F ? 0 : 0.006) * W.N[i] * (y < neckY + 0.02 ? 1 : 0) - 0.008 * belly;
    // core: the abdomen, sternum to pubis, front only
    scalar.coreDef[i] = wT * bump(y, (crotchY + underBust) / 2, (underBust - crotchY) * 0.62, (underBust - crotchY) * 0.62) * smooth(0.1, 0.6, front);
  }

  // smooth the scalar fields over the surface so no edge of a region shows
  const fat = smoothField(scalar.fat, 1, 20, 0.6), mvol = smoothField(scalar.mvol, 1, 16);
  for (let i = 0; i < N; i++) { scalar.def[i] *= 1 - covered[i]; scalar.coreDef[i] *= 1 - covered[i]; }
  const def = smoothField(scalar.def, 1, 8), coreDef = smoothField(scalar.coreDef, 1, 10);
  for (const k of ['belly', 'waist', 'bust', 'chest', 'glutes', 'hips', 'thighs']) D[k] = smoothField(D[k], 3, k === 'belly' ? 14 : 6);

  for (let i = 0; i < N; i++) {
    if (!skin(i)) continue;
    const o = i * 3;
    for (let d = 0; d < 3; d++) {
      const n = nS[o + d];
      // fat also reshapes: the belly leads, the waist fills, hips / bust / thighs follow by sex
      D.fat[o + d] = n * fat[i] + 0.45 * D.belly[o + d] + 0.45 * D.waist[o + d]
        + (F ? 0.3 * D.bust[o + d] + 0.08 * D.hips[o + d] + 0.08 * D.thighs[o + d] + 0.12 * D.glutes[o + d] : 0.15 * D.bust[o + d] + 0.22 * D.belly[o + d]);
      D.muscle[o + d] = detail[o + d] * 0.7 * def[i] + n * mvol[i];
      D.core[o + d] = detail[o + d] * 1.3 * coreDef[i] - n * 0.006 * coreDef[i];
    }
  }

  /* ---------------- clothing follows the skin ---------------- */
  const fabric = [];
  for (let i = 0; i < N; i++) if (!skin(i)) fabric.push(i);
  if (fabric.length) {
    const grid = new Map();
    for (let i = 0; i < N; i++) if (skin(i)) { const k = cellKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); }
    for (const i of fabric) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const near = [];
      for (let a = -0.02; a <= 0.021; a += 0.02) for (let b = -0.02; b <= 0.021; b += 0.02) for (let c = -0.02; c <= 0.021; c += 0.02) {
        const l = grid.get(cellKey(x + a, y + b, z + c));
        if (l) for (const j of l) near.push([hyp(pos[j * 3] - x, pos[j * 3 + 1] - y, pos[j * 3 + 2] - z), j]);
      }
      if (!near.length) continue;
      near.sort((p, q) => p[0] - q[0]);
      const use = near.slice(0, 4);
      // inverse-square: a garment copied from the skin (the boxers) follows its own source vertex;
      // a looser one (the bra cups) blends its neighbours
      let ws = 0;
      for (const [d] of use) ws += 1 / (d * d + 1e-6);
      for (const k of SHAPE_TARGETS) {
        for (const [d, j] of use) {
          const w = 1 / (d * d + 1e-6) / ws;
          for (let c = 0; c < 3; c++) D[k][i * 3 + c] += D[k][j * 3 + c] * w;
        }
      }
    }
  }

  return new Shape(mesh, D, L, { skinTri, dom, domGroup, W });
}

/** Built targets + everything needed to measure the shaped body. */
export class Shape {
  constructor(mesh, deltas, landmarks, topo) {
    this.mesh = mesh;
    this.deltas = deltas;
    this.L = landmarks;
    this.topo = topo;
    const g = mesh.geometry;
    this.base = g.attributes.position.array;
    this.index = g.index.array;
    this.widthDelta = g.morphAttributes.position?.[0]?.array || null;
    this.cur = new Float32Array(this.base.length);
    // triangles by region, for the tape measure
    const { dom, W } = topo;
    const N = this.base.length / 3, T = this.index.length / 3;
    const group = (i) => topo.domGroup(i);
    this.sets = {
      torso: new Uint8Array(N), hips: new Uint8Array(N), thighL: new Uint8Array(N),
    };
    for (let i = 0; i < N; i++) {
      const G = group(i);
      this.sets.torso[i] = G === 'T' ? 1 : 0;
      this.sets.hips[i] = G === 'T' || G === 'TL' || G === 'TR' ? 1 : 0;
      this.sets.thighL[i] = G === 'TL' ? 1 : 0;
    }
    this.skinTris = [];
    for (let t = 0; t < T; t++) if (topo.skinTri[t]) this.skinTris.push(t);
    const I = this.index;
    this.setTris = new Map();
    for (const set of Object.values(this.sets)) {
      this.setTris.set(set, Uint32Array.from(this.skinTris.filter((t) => set[I[t * 3]] && set[I[t * 3 + 1]] && set[I[t * 3 + 2]])));
    }
    this.pts = new Float64Array(8192);
    void dom; void W;
  }

  /** Install the targets on the mesh (after the width target at index 0), with normal deltas. */
  install() {
    const g = this.mesh.geometry;
    const THREE_BA = g.attributes.position.constructor;
    const baseN = this.#normals(this.base);
    const targets = [this.widthDelta ? { k: 'width', d: this.widthDelta } : null, ...SHAPE_TARGETS.map((k) => ({ k, d: this.deltas[k] }))].filter(Boolean);
    const P = [], Nm = [];
    for (const { k, d } of targets) {
      const p = new Float32Array(this.base.length);
      for (let i = 0; i < p.length; i++) p[i] = this.base[i] + d[i];
      const n = this.#normals(p);
      for (let i = 0; i < n.length; i++) n[i] -= baseN[i];
      const pa = new THREE_BA(Float32Array.from(d), 3); pa.name = k;
      const na = new THREE_BA(n, 3); na.name = k;
      P.push(pa); Nm.push(na);
    }
    g.morphAttributes.position = P;
    g.morphAttributes.normal = Nm;
    g.morphTargetsRelative = true;
    this.mesh.updateMorphTargets();
    this.slot = Object.fromEntries(targets.map((t, i) => [t.k, i]));
  }

  #normals(p) {
    const n = new Float32Array(p.length), I = this.index;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) { const l = hyp(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    return n;
  }

  /** influences { width, belly, … } → mesh morph influences */
  apply(infl) {
    const m = this.mesh.morphTargetInfluences;
    for (const [k, i] of Object.entries(this.slot)) m[i] = infl[k] || 0;
  }

  /** rest-space positions for these influences (into this.cur) */
  positions(infl) {
    const out = this.cur, B = this.base;
    out.set(B);
    const add = (d, w) => { if (!w || !d) return; for (let i = 0; i < out.length; i++) out[i] += d[i] * w; };
    add(this.widthDelta, infl.width);
    for (const k of SHAPE_TARGETS) add(this.deltas[k], infl[k]);
    return out;
  }

  /** enclosed volume (m³) of the skin at these influences (unscaled) */
  volume(infl, p = this.positions(infl)) {
    const I = this.index, cy = this.L.yMin + this.L.H / 2;
    let v = 0;
    for (const t of this.skinTris) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ax = p[a], ay = p[a + 1] - cy, az = p[a + 2], bx = p[b], by = p[b + 1] - cy, bz = p[b + 2], cx = p[c], cyy = p[c + 1] - cy, cz = p[c + 2];
      v += ax * (by * cz - bz * cyy) - ay * (bx * cz - bz * cx) + az * (bx * cyy - by * cx);
    }
    return Math.abs(v) / 6;
  }

  /**
   * The fat influence that gives `volume` (m³, unscaled) with the other influences fixed.
   * Positions are linear in the influence, so volume is an exact cubic in it: fit, then Newton.
   */
  solveFat(infl, volume, [lo, hi] = [-0.6, 2]) {
    const xs = [-0.6, 0.4, 1.2, 2];
    // the cubic depends only on the other influences: weight / height ticks reuse it
    const key = JSON.stringify({ ...infl, fat: 0 });
    if (this.cubicKey !== key) { this.cubicKey = key; this.cubic = xs.map((f) => this.volume({ ...infl, fat: f })); }
    const ys = this.cubic;
    const V = (f) => { let s = 0; for (let i = 0; i < 4; i++) { let l = ys[i]; for (let j = 0; j < 4; j++) if (j !== i) l *= (f - xs[j]) / (xs[i] - xs[j]); s += l; } return s; };
    if (volume <= V(lo)) return lo;
    if (volume >= V(hi)) return hi;
    let a = lo, b = hi;
    for (let it = 0; it < 40; it++) { const m = (a + b) / 2; if (V(m) < volume) a = m; else b = m; }
    return (a + b) / 2;
  }

  /** fat influence → volume, both ends (for slider ranges) */
  volumeRange(infl, [lo, hi] = [-0.6, 2]) {
    return [this.volume({ ...infl, fat: lo }), this.volume({ ...infl, fat: hi })];
  }

  /**
   * Tape measurements (m, unscaled) of the shaped body, like a fitter takes them: the convex hull
   * of a horizontal slice (a tape bridges hollows).
   */
  girths(infl) {
    const p = this.positions(infl), L = this.L;
    const slice = (y, set) => this.#hull(this.#slice(p, y, set));
    // (girths reuse one positions() pass; a tape bridges hollows, so the convex hull is the reading)
    const apexY = L.apex[0][1], under = L.underY;
    let waist = Infinity;
    for (let d = -0.03; d <= 0.031; d += 0.015) waist = Math.min(waist, slice(L.waistY + d, this.sets.torso) || Infinity);
    let hips = 0;
    for (let d = -0.04; d <= 0.041; d += 0.02) hips = Math.max(hips, slice(L.hipY + d, this.sets.hips));
    // thigh: the fullest point just below the crotch
    let thigh = 0;
    for (let d = 0.02; d <= 0.071; d += 0.025) thigh = Math.max(thigh, slice(L.crotchY - d, this.sets.thighL));
    // thigh gap: closest inner-thigh points 4 cm below the crotch
    const gy = L.crotchY - 0.04;
    const pts = this.#slice(p, gy, this.sets.hips);
    let lMin = Infinity, rMax = -Infinity;
    for (const [x] of pts) { if (x > 0) lMin = Math.min(lMin, x); else rMax = Math.max(rMax, x); }
    return {
      bust: slice(apexY, this.sets.torso), underbust: slice(under, this.sets.torso),
      waist: Number.isFinite(waist) ? waist : 0, hips, thigh, gap: Number.isFinite(lMin - rMax) ? lMin - rMax : 0,
    };
  }

  #slice(p, y, set) {
    const I = this.index, out = [];
    for (const t of this.setTris.get(set)) {
      const a0 = I[t * 3] * 3, b0 = I[t * 3 + 1] * 3, c0 = I[t * 3 + 2] * 3;
      const ya = p[a0 + 1] - y, yb = p[b0 + 1] - y, yc = p[c0 + 1] - y;
      if ((ya < 0 && yb < 0 && yc < 0) || (ya >= 0 && yb >= 0 && yc >= 0)) continue;
      for (const [a, b, u, w] of [[a0, b0, ya, yb], [b0, c0, yb, yc], [c0, a0, yc, ya]]) {
        if ((u < 0) === (w < 0)) continue;
        const f = u / (u - w);
        out.push([p[a] + (p[b] - p[a]) * f, p[a + 2] + (p[b + 2] - p[a + 2]) * f]);
      }
    }
    return out;
  }

  #hull(pts) {
    if (pts.length < 3) return 0;
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    const h = lo.slice(0, -1).concat(hi.slice(0, -1));
    let per = 0;
    for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; per += hyp(a[0] - b[0], a[1] - b[1]); }
    return per;
  }
}
