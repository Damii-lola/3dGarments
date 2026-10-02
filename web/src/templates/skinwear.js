/**
 * A garment made from the body's own skin surface — ONE piece, torso and sleeves continuous (no separate sleeve
 * tubes): the body's skin triangles, pushed out per vertex by an offset (rest space, before skinning), so it moves
 * with every pose and shape exactly like the bodysuit. The offset is the template's FIT:
 *   torso   tight(y)  — bodysuit-close where tight = 1 (chest, shoulders), flying out toward the hem where it falls
 *           to 0: there the fabric hangs off the body's hull (it spans the abs, the small of the back) plus `flare`
 *   sleeve  tight at the shoulder, flying out to a tube round the arm by its hem
 * Its edges (neckline, hem, sleeve hems) are a per-vertex signed distance (`cut`): fragments where it's < 0 are
 * discarded, so every edge is a smooth line across the body's triangles.
 *
 *   wearSkin(human, tpl) → { mesh, hide, dispose }
 */
import * as THREE from 'three';
import { patchMaterial } from '../human/cpumorph.js';
import { measureBody, hull, rayOut, smooth } from './frame.js';

export function wearSkin(human, tpl) {
  const B = human.active, mesh = B.mesh, g = mesh.geometry;
  B.ensureShape?.();
  mesh.userData.cpuMorphUpdate?.();
  const body = measureBody(human);
  const n = g.attributes.position.count, P = g.attributes.position.array, MP = g.attributes.morphPos?.array;
  const part = g.attributes._part.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
  // REST space (the rig's bind pose, current shape): where the offset is made
  const R = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) R[i] = P[i] + (MP ? MP[i] : 0);
  const names = B.bones.map((b) => b.name);
  const bindJoint = (nm) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[names.indexOf(nm)]).invert());
  const armSide = names.map((nm) => { const m = nm.match(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)\w*_(l|r)$/); return m ? m[2] : null; });
  const armW = (i, s) => { let w = 0; for (let k = 0; k < 4; k++) if (armSide[SI[i * 4 + k]] === s) w += SW[i * 4 + k]; return w; };
  const region = body.region;                                  // (by the dominant bone; same in rest and posed)
  // the landmarks are measured on the body as it stands (feet on the floor): taken to rest space by the torso's own
  // shift between the two (the pose hardly moves the torso)
  let dy = 0, dn = 0, dxs = 0, dzs = 0;
  for (let i = 0; i < n; i++) if (part[i] < 0.5 && region[i] === 'torso') { dy += body.Q[i * 3 + 1] - R[i * 3 + 1]; dxs += body.Q[i * 3] - R[i * 3]; dzs += body.Q[i * 3 + 2] - R[i * 3 + 2]; dn++; }
  dy /= dn || 1; dxs /= dn || 1; dzs /= dn || 1;
  const L = Object.fromEntries(Object.entries(body.L).map(([k, v]) => [k, k === 'floor' ? v : v - dy]));
  const cut0 = tpl.cut(body), cut = { ...cut0, hemY: cut0.hemY - dy, neckBase: cut0.neckBase - dy, neck: cut0.neck.clone().sub(new THREE.Vector3(dxs, dy, dzs)) };
  const skin = (i) => part[i] < 0.5;
  // the rest pose's heights match the posed torso's (only the limbs move): the landmarks apply as they are

  /* ---- the torso: per 1 cm a centre and the hull's radius by angle (the fabric's far shape) ---- */
  const BIN = 0.01, yTop = L.neckTop + 0.02, yBot = cut.hemY - 0.06, nb = Math.ceil((yTop - yBot) / BIN) + 1, NA = 144;
  const pts = Array.from({ length: nb }, () => []);
  for (let i = 0; i < n; i++) {
    if (!(skin(i) || (part[i] > 3.5 && part[i] < 4.5))) continue;
    const r = region[i], y = R[i * 3 + 1];
    if (!(r === 'torso' || (r.startsWith('leg') && y > L.crotch - 0.01))) continue;
    if (armW(i, 'l') + armW(i, 'r') > 0.05 || Math.abs(R[i * 3]) > 0.25) continue;   // (the arms stand out sideways in the rest pose: never part of the torso's outline)
    const k = Math.round((yTop - y) / BIN); if (k < 0 || k >= nb) continue;
    pts[k].push([R[i * 3], R[i * 3 + 2]]);
  }
  const cxs = new Float64Array(nb), czs = new Float64Array(nb), HR = [];
  for (let k = 0; k < nb; k++) {
    const poly = pts[k].length >= 8 ? hull(pts[k]) : null;
    if (poly) { let a = 0, c = 0; for (const q of poly) { a += q[0]; c += q[1]; } cxs[k] = a / poly.length; czs[k] = c / poly.length; }
    HR.push(poly);
  }
  // centres smoothed (±6 cm), the hull radius by angle round them, enveloped down the body (±4 cm) and round (±5°)
  const sm = (a, w) => Float64Array.from(a, (_, k) => { let s = 0, c = 0; for (let d = -w; d <= w; d++) if (HR[k + d]) { s += a[k + d]; c++; } return c ? s / c : a[k]; });
  const CX = sm(cxs, 6), CZ = sm(czs, 6);
  const raw = HR.map((poly, k) => { if (!poly) return null; const o = new Float64Array(NA); for (let a = 0; a < NA; a++) { const t = (a / NA) * Math.PI * 2; o[a] = rayOut(poly, CX[k], CZ[k], Math.sin(t), Math.cos(t)); } return o; });
  const HRS = raw.map((_, k) => {
    const o = new Float64Array(NA);
    for (let a = 0; a < NA; a++) { let s = 0, c = 0; for (let d = -4; d <= 4; d++) { const q = raw[k + d]; if (!q) continue; for (let e = -2; e <= 2; e++) { s += q[(a + e + NA) % NA] ** 4; c++; } } o[a] = c ? (s / c) ** 0.25 : 0; }
    return o;
  });
  if (false) globalThis.__swDebug = raw.map((q, k) => [ (yTop - k * BIN).toFixed(3), q ? (q[72] * 1000).toFixed(0) : null, (HRS[k][72] * 1000).toFixed(0), (CZ[k] * 1000).toFixed(0), pts[k].length ]);
  // and round the ring too, with heights (the slices are sparse: a few dozen points each)
  for (let pass = 0; pass < 4; pass++) {
    const S = HRS.map((r) => Float64Array.from(r));
    for (let k = 0; k < nb; k++) for (let a = 0; a < NA; a++) { let s = 0, c = 0; for (let d = -4; d <= 4; d++) { const q = S[k + d]; if (!q) continue; for (let e = -4; e <= 4; e++) { s += q[(a + e + NA) % NA]; c++; } } HRS[k][a] = s / c; }
  }
  // (never inside the body's own outline at its height: the smoothing may round a bump — the waistband — off)
  {
    // (a whole ring out by the most it fell short — smooth round — and that lift itself smooth down the body)
    const lift = new Float64Array(nb);
    for (let k = 0; k < nb; k++) { const q = raw[k]; if (q) for (let a = 0; a < NA; a++) lift[k] = Math.max(lift[k], q[a] - HRS[k][a]); }
    const L1 = Float64Array.from(lift, (_, k) => { let m = 0; for (let d = -4; d <= 4; d++) if (k + d >= 0 && k + d < nb) m = Math.max(m, lift[k + d]); return m; });
    const L2 = Float64Array.from(L1, (_, k) => { let s = 0, c = 0; for (let d = -4; d <= 4; d++) if (k + d >= 0 && k + d < nb) { s += L1[k + d]; c++; } return s / c; });
    for (let k = 0; k < nb; k++) if (L2[k] > 0) for (let a = 0; a < NA; a++) HRS[k][a] += L2[k];
  }
  // the body's MEAN radius by height and angle (every skin point, 1 cm × 5°), smoothed: the tight fit lies on the
  // larger of the skin and this — the small hollows (the collarbone notch, the spine's groove, between the pecs)
  // spanned, the shape kept: a bodysuit, slightly not
  const MA = 72, MS = new Float64Array(nb * MA), MC = new Float64Array(nb * MA);
  for (let i = 0; i < n; i++) {
    if (!skin(i)) continue;
    const r0 = region[i], y = R[i * 3 + 1]; if (!(r0 === 'torso' || r0.startsWith('leg'))) continue;
    if (armW(i, 'l') + armW(i, 'r') > 0.5) continue;
    const k = Math.round((yTop - y) / BIN); if (k < 0 || k >= nb) continue;
    const dx = R[i * 3] - CX[k], dz = R[i * 3 + 2] - CZ[k], a = Math.floor(((Math.atan2(dx, dz) / (2 * Math.PI) + 1) % 1) * MA) % MA;
    MS[k * MA + a] += Math.hypot(dx, dz); MC[k * MA + a]++;
  }
  let M = Float64Array.from(MS, (v, j) => (MC[j] ? v / MC[j] : 0));
  for (let pass = 0; pass < 4; pass++) {
    const O = new Float64Array(nb * MA);
    for (let k = 0; k < nb; k++) for (let a = 0; a < MA; a++) {
      let s = 0, c = 0;
      for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) { const kk = k + d; if (kk < 0 || kk >= nb) continue; const v = M[kk * MA + (a + e + MA) % MA]; if (v > 0) { s += v; c++; } }
      O[k * MA + a] = c ? s / c : 0;
    }
    M = O;
  }
  // the loose part's surface: that mean field smoothed much more (no muscles), falling no faster than `fall` from
  // where it starts to fly
  // (from each cell's OUTERMOST skin point, smoothed as an upper envelope: the fabric drapes over the high points —
  // the glutes, the shoulder blades — and spans what's between)
  const MXr = new Float64Array(nb * MA);
  for (let i = 0; i < n; i++) {
    if (!(skin(i) || (part[i] > 3.5 && part[i] < 4.5))) continue;
    const r0 = region[i], y = R[i * 3 + 1]; if (!(r0 === 'torso' || r0.startsWith('leg'))) continue;
    if (armW(i, 'l') + armW(i, 'r') > 0.5 || Math.abs(R[i * 3]) > 0.25) continue;
    const k = Math.round((yTop - y) / BIN); if (k < 0 || k >= nb) continue;
    const dx = R[i * 3] - CX[k], dz = R[i * 3 + 2] - CZ[k], a = Math.floor(((Math.atan2(dx, dz) / (2 * Math.PI) + 1) % 1) * MA) % MA;
    MXr[k * MA + a] = Math.max(MXr[k * MA + a], Math.hypot(dx, dz));
  }
  let MF = Float64Array.from(MXr, (v, j) => v || M[j]);
  for (let pass = 0; pass < 10; pass++) {
    const O = new Float64Array(nb * MA);
    for (let k = 0; k < nb; k++) for (let a = 0; a < MA; a++) {
      let s = 0, c = 0;
      for (let d = -3; d <= 3; d++) for (let e = -2; e <= 2; e++) { const kk = k + d; if (kk < 0 || kk >= nb) continue; const v = MF[kk * MA + (a + e + MA) % MA]; if (v > 0) { s += v ** 6; c++; } }
      O[k * MA + a] = c ? (s / c) ** (1 / 6) : 0;
    }
    MF = O;
  }
  { const yF = tpl.fallFrom ? tpl.fallFrom(L) : L.armpit - 0.06;
    for (let k = 1; k < nb; k++) { if (yTop - k * BIN > yF) continue; for (let a = 0; a < MA; a++) MF[k * MA + a] = Math.max(MF[k * MA + a], MF[(k - 1) * MA + a] - (tpl.fall ?? 0.15) * BIN); } }
  const flyAt = (y, th) => { const k = Math.max(0, Math.min(nb - 1, Math.round((yTop - y) / BIN))), f = (((th / (Math.PI * 2)) % 1) + 1) % 1 * MA, a = Math.floor(f) % MA; return MF[k * MA + a] * (1 - (f - a)) + MF[k * MA + (a + 1) % MA] * (f - a); };
  const meanAt = (y, th) => { const k = Math.max(0, Math.min(nb - 1, Math.round((yTop - y) / BIN))), f = (((th / (Math.PI * 2)) % 1) + 1) % 1 * MA, a = Math.floor(f) % MA; return M[k * MA + a] * (1 - (f - a)) + M[k * MA + (a + 1) % MA] * (f - a); };
  const binOf = (y) => Math.max(0, Math.min(nb - 1, Math.round((yTop - y) / BIN)));
  const hullAt = (y, th) => { const k = binOf(y), f = (((th / (Math.PI * 2)) % 1) + 1) % 1 * NA, a = Math.floor(f) % NA; return HRS[k][a] * (1 - (f - a)) + HRS[k][(a + 1) % NA] * (f - a); };
  // going down, the hull never comes in faster than `fall` (the fabric falls straight off the chest)
  // (from where it starts to fly: above that it's tight to the body, and the shoulders' width mustn't carry down)
  const yFall = tpl.fallFrom ? tpl.fallFrom(L) : L.armpit - 0.06;
  for (let k = 1; k < nb; k++) { if (yTop - k * BIN > yFall) continue; for (let a = 0; a < NA; a++) HRS[k][a] = Math.max(HRS[k][a], HRS[k - 1][a] - (tpl.fall ?? 0.15) * BIN); }
  // then smoothed down the body (±6 cm, twice): no ridges from one slice's few points
  for (let pass = 0; pass < 2; pass++) {
    const S = HRS.map((r) => Float64Array.from(r));
    for (let k = 0; k < nb; k++) for (let a = 0; a < NA; a++) { let s = 0, c = 0; for (let d = -6; d <= 6; d++) { const q = S[k + d]; if (!q || !HR[k + d]) continue; const w = 7 - Math.abs(d); s += q[a] * w; c += w; } if (c) HRS[k][a] = s / c; }
  }

  /* ---- the arms (rest pose): their axis, and their mean radius along it ---- */
  const arms = {};
  for (const s of ['l', 'r']) {
    const S = bindJoint(`upperarm_${s}`), E = bindJoint(`lowerarm_${s}`), Wr = bindJoint(`hand_${s}`);
    const segs = [[S, E], [E, Wr]].map(([p, q]) => ({ p, a: q.clone().sub(p).normalize(), len: p.distanceTo(q) }));
    const frame = (x, y, z) => {
      let sg = segs[0], t = (x - sg.p.x) * sg.a.x + (y - sg.p.y) * sg.a.y + (z - sg.p.z) * sg.a.z, along = t;
      if (t > sg.len) { sg = segs[1]; t = (x - sg.p.x) * sg.a.x + (y - sg.p.y) * sg.a.y + (z - sg.p.z) * sg.a.z; along = segs[0].len + t; }
      const rx = x - sg.p.x - sg.a.x * t, ry = y - sg.p.y - sg.a.y * t, rz = z - sg.p.z - sg.a.z * t;
      return { along, r: [rx, ry, rz], len: Math.hypot(rx, ry, rz), a: sg.a };
    };
    // the arm's widest radius over the sleeve (past the shoulder): the sleeve's tube is that + its flare
    let rMax = 0;
    for (let i = 0; i < n; i++) {
      if (!skin(i) || armW(i, s) < 0.9) continue;
      const f = frame(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]);
      if (f.along > 0.05 && f.along < cut.sleeveEnd) rMax = Math.max(rMax, f.len);
    }
    arms[s] = { frame, rMax, upper: segs[0].len };
  }

  /* ---- per vertex: the offset (rest space), the cut distance ---- */
  const GAP = tpl.gap ?? 0.004, SG = g.attributes.suitGap?.array, NB = (g.attributes.suitNrm || g.attributes.normal).array;
  const off = new Float32Array(n * 3), cutD = new Float32Array(n).fill(-1), used = new Uint8Array(n), looseOf = new Float32Array(n);
  const neckY = (x, z) => tpl.neckY(cut, x, z);
  for (let i = 0; i < n; i++) {
    if (!skin(i)) continue;
    const reg = region[i];
    if (reg === 'head' || (reg.startsWith('leg') && R[i * 3 + 1] < cut.hemY - 0.08)) continue;
    const x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2];
    // (skin mostly on the torso — the lats, the armpit — takes the torso's fit: the sleeve's is only the arm's own)
    const wl = armW(i, 'l'), wr = armW(i, 'r'), wa = smooth(0.45, 0.85, Math.min(1, wl + wr));
    // torso: out from the centre — bodysuit-close where tight, the hull + flare where it flies
    let tx = 0, ty = 0, tz = 0;
    {
      const k = binOf(y), dx = x - CX[k], dz = z - CZ[k], r = Math.hypot(dx, dz) || 1, th = Math.atan2(dx, dz);
      // (the body's relief fades fast as it loosens: no half-hugged muscles)
      const loose = 1 - tpl.tight(y, L), target = flyAt(y, th) + GAP + tpl.flare(y, th, L);
      looseOf[i] = loose * (1 - wa);
      const rt = Math.max(r, meanAt(y, th) * (tpl.span ?? 0.99)), dr = (rt - r) + GAP + loose * Math.max(0, target - rt - GAP);
      tx = (dx / r) * dr; tz = (dz / r) * dr;
    }
    // sleeve: out from the arm's axis — tight at the shoulder, a tube by the hem
    let ax = 0, ay = 0, az = 0;
    for (const [s, w] of [['l', wl], ['r', wr]]) {
      if (w < 0.01) continue;
      const A = arms[s], f = A.frame(x, y, z), loose = tpl.sleeveLoose(f.along, cut, A);
      const target = A.rMax + GAP + tpl.sleeveFlare(f.along, f.r, f.a, A), dr = GAP + loose * Math.max(0, target - f.len - GAP);
      const k = dr / (f.len || 1);
      const sh = w / (wl + wr); ax += f.r[0] * k * sh; ay += f.r[1] * k * sh; az += f.r[2] * k * sh;
    }
    off[i * 3] = tx * (1 - wa) + ax * wa; off[i * 3 + 1] = ty * (1 - wa) + ay * wa; off[i * 3 + 2] = tz * (1 - wa) + az * wa;
    // over the underwear (the bodysuit's gap says it's there): clear of it, along the skin's normal
    if (SG && SG[i] > 0.0025) {
      const nx = NB[i * 3], ny = NB[i * 3 + 1], nz = NB[i * 3 + 2], along = off[i * 3] * nx + off[i * 3 + 1] * ny + off[i * 3 + 2] * nz, need = 0.016 * Math.min(1, (SG[i] - 0.0015) / 0.002);
      if (along < need) { off[i * 3] += nx * (need - along); off[i * 3 + 1] += ny * (need - along); off[i * 3 + 2] += nz * (need - along); }
    }
    // the cut: inside the neckline, above the hem, inside the sleeves' hems (metres, + inside)
    let c = Math.min(neckY(x, z) - y, y - cut.hemY);
    if (wl + wr > 0.5) { const s = wl > wr ? 'l' : 'r', f = arms[s].frame(x, y, z); c = Math.min(c, cut.sleeveEnd - f.along); }
    else if (reg.startsWith('arm')) { const f = arms[reg.slice(4)].frame(x, y, z); c = Math.min(c, cut.sleeveEnd - f.along); }
    cutD[i] = c; used[i] = 1;
  }

  /* ---- the mesh: the skin's triangles near or inside the garment, sharing the body's attributes ---- */
  const idx = g.index.array, skinEnd = g.groups[0] ? g.groups[0].count : idx.length, tris = [];
  for (let t = 0; t < skinEnd; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!used[a] || !used[b] || !used[c]) continue;
    if (Math.max(cutD[a], cutD[b], cutD[c]) < -0.002) continue;
    tris.push(a, b, c);
  }
  // where it flies the fabric is smoothed as a surface (the body's relief, the edge of the lats where it leaves them,
  // gone): its positions relaxed toward their neighbours', by how loose it is there — never in to the skin
  {
    const nbr = Array.from({ length: n }, () => []);
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + (e + 1) % 3]; nbr[a].push(b); nbr[b].push(a); }
    const F = Float32Array.from(R, (v, j) => v + off[j]);
    for (let it = 0; it < (tpl.relax ?? 24); it++) {
      const G = Float32Array.from(F);
      for (let i = 0; i < n; i++) {
        const w = looseOf[i], N = nbr[i]; if (!(w > 0) || !N.length) continue;
        let x = 0, y = 0, z = 0; for (const j of N) { x += F[j * 3]; y += F[j * 3 + 1]; z += F[j * 3 + 2]; }
        // (across only — x and z: the hem and every line on it stay at their heights)
        const k = 0.5 * w; G[i * 3] += (x / N.length - F[i * 3]) * k; G[i * 3 + 2] += (z / N.length - F[i * 3 + 2]) * k;
        // (not closer to the skin than GAP along its own offset)
        const ox = G[i * 3] - R[i * 3], oy = G[i * 3 + 1] - R[i * 3 + 1], oz = G[i * 3 + 2] - R[i * 3 + 2];
        const ol = Math.hypot(off[i * 3], off[i * 3 + 1], off[i * 3 + 2]) || 1, along = (ox * off[i * 3] + oy * off[i * 3 + 1] + oz * off[i * 3 + 2]) / ol;
        if (along < GAP) { const f = (GAP - along) / ol; G[i * 3] += off[i * 3] * f; G[i * 3 + 1] += off[i * 3 + 1] * f; G[i * 3 + 2] += off[i * 3 + 2] * f; }
      }
      F.set(G);
    }
    // (the relaxing only fills: wherever it pulled the fabric in, it's put back out to where it was — the garment keeps
    // its size, and nothing under it comes through)
    for (let i = 0; i < n; i++) {
      if (!(looseOf[i] > 0)) continue;
      const k = binOf(R[i * 3 + 1]), cx = CX[k], cz = CZ[k];
      const r0 = Math.hypot(R[i * 3] + off[i * 3] - cx, R[i * 3 + 2] + off[i * 3 + 2] - cz), r1 = Math.hypot(F[i * 3] - cx, F[i * 3 + 2] - cz);
      if (r1 < r0) { F[i * 3] = R[i * 3] + off[i * 3]; F[i * 3 + 2] = R[i * 3 + 2] + off[i * 3 + 2]; }
    }
    for (let j = 0; j < n * 3; j++) off[j] = F[j] - R[j];
  }
  const geo = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'morphPos', 'morphNrm']) if (g.attributes[k]) geo.setAttribute(k, g.attributes[k]);
  geo.setAttribute('wearOff', new THREE.BufferAttribute(off, 3));
  geo.setAttribute('wearCut', new THREE.BufferAttribute(cutD, 1));
  // its own shading normals: of the offset surface (smooth fabric, not the muscles under it where it flies)
  {
    const tmp = new THREE.BufferGeometry(), q = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) q[i] = R[i] + off[i];
    tmp.setAttribute('position', new THREE.BufferAttribute(q, 3)); tmp.setIndex(tris); tmp.computeVertexNormals();
    const nn = tmp.attributes.normal.array, bn = g.attributes.normal.array;
    for (let i = 0; i < n; i++) if (nn[i * 3] * bn[i * 3] + nn[i * 3 + 1] * bn[i * 3 + 1] + nn[i * 3 + 2] * bn[i * 3 + 2] < 0) for (let c = 0; c < 3; c++) nn[i * 3 + c] *= -1;
    geo.setAttribute('wearNrm', new THREE.BufferAttribute(nn, 3));
  }
  geo.setIndex(tris);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2);

  const shader = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 wearOff;\nattribute float wearCut;\nattribute vec3 wearNrm;\nvarying float vCut;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = wearNrm;')
      .replace('#include <skinning_vertex>', 'transformed += wearOff;\nvCut = wearCut;\n#include <skinning_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCut;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vCut < 0.0) discard;');
    if (sh.fragmentShader.includes('#include <map_fragment>')) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
// the finished edges: a rib band at the neck, a turned-up hem / sleeve hem with its stitching
float e = vCut;
if (e < 0.0025) diffuseColor.rgb *= 0.9;
else if (abs(e - 0.0215) < 0.0007 || abs(e - 0.0275) < 0.0007) diffuseColor.rgb *= 0.92;`);
  };
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...tpl.color.map((v) => v / 255)), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = shader; mat.customProgramCacheKey = () => `skinwear`;
  patchMaterial(mat);
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = shader; depth.customProgramCacheKey = () => 'skinwear-depth';
  patchMaterial(depth);
  const garment = new THREE.SkinnedMesh(geo, mat);
  garment.name = `template:${tpl.id}`;
  garment.frustumCulled = false;
  garment.castShadow = garment.receiveShadow = true;
  garment.customDepthMaterial = depth;
  garment.bind(mesh.skeleton, mesh.bindMatrix);
  garment.onBeforeRender = () => { mesh.userData.cpuMorphUpdate?.(); };
  mesh.parent.add(garment);
  B.layers.add(garment);
  // the skin it covers (with 1 cm to spare): not drawn
  const hide = new Set(); for (let i = 0; i < n; i++) if (used[i] && cutD[i] > 0.01) hide.add(i);
  return {
    tpl, mesh: garment, hide, prep: { body, cut },
    dispose() { B.layers.delete(garment); garment.removeFromParent(); geo.dispose(); mat.dispose(); depth.dispose(); },
  };
}
