/**
 * Body-derived garment templates.
 *
 * A template is NOT a separate model that has to be fitted to the mannequin: it is a cut-out of the
 * mannequin's own surface (torso, shoulders, sleeves …), pushed outward by `ease`, unwrapped into
 * clean texture panels and skinned with the SAME skeleton, skin weights and shape morphs as the body.
 * So whatever a slider does to the body (width, height, weight, belly, chest, posture, arms …) it does
 * to the garment on the GPU in the same frame, with nothing to fit and nothing that can sink in.
 *
 * What it is for: the AI matches a photo of a garment to a template and paints a texture onto the
 * template's UVs. The UV layout is therefore part of the contract (see `UV_LAYOUT`):
 *
 *      v=1  +-----------+-----------+
 *           |   FRONT   |   BACK    |   torso panels, seams at the sides, pixel rows = height
 *           |           |           |
 *     .34   +-----------+-----------+
 *           | L SLEEVE  | R SLEEVE  |   unrolled tubes, seam on the underside
 *      v=0  +-----------+-----------+
 *
 * A template is described by a small `spec` (all lengths in metres, for the average body — they scale
 * with the shoulder width), so one generator makes a tee, a long sleeve, … for either sex.
 */
import * as THREE from 'three';

export const UV_LAYOUT = {
  front: { u: [0.02, 0.48], v: [0.34, 0.98] },
  back: { u: [0.52, 0.98], v: [0.34, 0.98] },
  sleeveL: { u: [0.02, 0.48], v: [0.02, 0.30] },
  sleeveR: { u: [0.52, 0.98], v: [0.02, 0.30] },
};

export const SPEC_DEFAULTS = {
  hem: -0.02,         // where the body panel stops (never below the underwear's waistband); the hem hangs on from there
  sleeve: 0.55,       // 0 = sleeveless, 1 = to the elbow, 2 = to the wrist
  neckW: 0.088,       // half width of the neck opening
  neckFront: 0.105,   // half depth of the opening toward the front
  neckBack: 0.078,    // … toward the back
  dipFront: 0.05,     // how far the front of the neckline sits below the base of the neck
  dipBack: 0.005,
  ease: 0.008,        // gap between skin and cloth
  easeSleeve: 0.006,
  loose: 0.02,        // extra room in the torso below the chest (a tee hangs, it is not painted on)
  extend: 0.11,       // how far the hem hangs below that line
  flare: 0.03,        // how far the bottom of the hem stands out from the body
  hips: 0.02,         // extra room around the hips / lower belly so the hem hangs free of the groin
  underwear: 0,       // extra fixed clearance below the waistband (the real underwear thickness is measured)
  polish: 30,         // plain smoothing passes on top: no nipples / navel / muscle seams under a shirt
  smooth: 160,        // smoothing passes: cloth bridges the muscle / rib detail of the body
};

const TORSO_BONES = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01', 'thigh_l', 'thigh_r']);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A checker texture for looking at the UV layout (each panel gets its own hue). */
export function checkerTexture(size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const panel = (u, v, hue) => {
    const [u0, u1] = u, [v0, v1] = v;
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
      x.fillStyle = (i + j) % 2 ? `hsl(${hue} 35% 78%)` : `hsl(${hue} 45% 62%)`;
      x.fillRect((u0 + (u1 - u0) * i / 24) * size, (1 - v1 + (v1 - v0) * j / 24) * size, (u1 - u0) / 24 * size + 1, (v1 - v0) / 24 * size + 1);
    }
  };
  x.fillStyle = '#ddd'; x.fillRect(0, 0, size, size);
  panel(UV_LAYOUT.front.u, UV_LAYOUT.front.v, 20); panel(UV_LAYOUT.back.u, UV_LAYOUT.back.v, 210);
  panel(UV_LAYOUT.sleeveL.u, UV_LAYOUT.sleeveL.v, 110); panel(UV_LAYOUT.sleeveR.u, UV_LAYOUT.sleeveR.v, 290);
  x.fillStyle = '#222'; x.font = `${size / 28}px sans-serif`;
  x.fillText('FRONT', size * 0.05, size * 0.1); x.fillText('BACK', size * 0.55, size * 0.1);
  x.fillText('L SLEEVE', size * 0.05, size * 0.75); x.fillText('R SLEEVE', size * 0.55, size * 0.75);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class BodyGarment {
  /** @returns BodyGarment — a SkinnedMesh sharing the active body's skeleton and morphs */
  static build(human, spec = {}, opts = {}) { return new BodyGarment(human, { ...SPEC_DEFAULTS, ...spec }, opts); }

  constructor(human, spec, opts) {
    this.human = human; this.spec = spec;
    const B = this.body = human.active;
    B.ensureShape();
    const body = B.mesh, g = body.geometry;
    const Pa = g.attributes.position, Na = g.attributes.normal, idx = g.index.array;
    const skinTris = g.groups[0] ? g.groups[0].count / 3 : idx.length / 3;   // skin only: the skin runs on under the underwear
    const names = B.bones.map((b) => b.name), bi = B.boneIndex, bp = B.bindPos;
    const nV = Pa.count;
    const P = (i, o = new THREE.Vector3()) => o.fromBufferAttribute(Pa, i);
    const bone = (n) => bp[bi[n]];
    const k = Math.abs(bone('upperarm_l').x - bone('upperarm_r').x) / 0.384;   // body size vs the reference body

    /* ---- 1. which body vertices belong to the garment ---- */
    let yWaist = -Infinity;   // top of the underwear's waistband
    {
      const partA = g.attributes._part;
      const yp = bone('pelvis').y;   // only the lower underwear (not a bra): within ~15 cm of the hip joint
      if (partA) for (let v = 0; v < nV; v++) if (partA.getX(v) > 3.5 && Pa.getY(v) > yWaist && Pa.getY(v) < yp + 0.15 && Pa.getY(v) > yp - 0.2 && TORSO_BONES.has(names[B.dom[v]])) yWaist = Pa.getY(v);
      if (!isFinite(yWaist)) yWaist = yp;
    }
    const yHem = Math.max(bone('pelvis').y + spec.hem * k, yWaist - 0.02), neck = bone('neck_01');
    const yNeck = neck.y;
    const arm = { l: {}, r: {} };
    for (const s of ['l', 'r']) {
      const A = bone(`upperarm_${s}`), E = bone(`lowerarm_${s}`), W = bone(`hand_${s}`);
      arm[s] = { A, E, W, u1: E.clone().sub(A), u2: W.clone().sub(E) };
      arm[s].l1 = arm[s].u1.length(); arm[s].l2 = arm[s].u2.length();
      arm[s].u1.normalize(); arm[s].u2.normalize();
    }
    const sleeveT = new Float32Array(nV).fill(-1);     // distance along the arm (in upper-arm lengths; 1 = elbow), -1 = not an arm vertex
    const side = new Int8Array(nV);                    // +1 left arm, -1 right arm, 0 torso
    const keep = new Uint8Array(nV);
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < nV; i++) {
      P(i, p);
      const nm = names[B.dom[i]];
      const m = /^(upperarm|lowerarm)_(l|r)$/.exec(nm);
      if (m) {
        const a = arm[m[2]], s = m[2] === 'l' ? 1 : -1;
        const t = m[1] === 'upperarm' ? q.copy(p).sub(a.A).dot(a.u1) / a.l1 : 1 + q.copy(p).sub(a.E).dot(a.u2) / a.l2;
        sleeveT[i] = t; side[i] = s;
        keep[i] = t >= -0.2 && t <= spec.sleeve && spec.sleeve > 0 ? 1 : 0;
        continue;
      }
      if (!TORSO_BONES.has(nm) || p.y < yHem) continue;
      // neck opening: an ellipse around the neck axis, deeper at the front than at the back
      const dz = p.z - neck.z, dx = p.x - neck.x;
      const rz = (dz > 0 ? spec.neckFront : spec.neckBack) * k, rx = spec.neckW * k;
      const inside = (dx / rx) ** 2 + (dz / rz) ** 2 < 1;
      const yCut = yNeck - (spec.dipBack + (spec.dipFront - spec.dipBack) * smooth(-0.02, 0.06, dz)) * k - 0.012;
      if (p.y > yNeck + 0.04 * k) continue;                 // the neck and head
      if (inside && p.y > yCut) continue;                   // the opening
      if (nm === 'neck_01' && p.y > yCut) continue;
      keep[i] = 1;
    }

    /* ---- 2. triangles: all three corners kept; then the largest connected piece ---- */
    let tris = [];
    for (let t = 0; t < skinTris; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      if (keep[a] && keep[b] && keep[c]) tris.push(a, b, c);
    }
    tris = largestPiece(tris, nV);

    /* ---- 2b. the hem: extrude the lower edge of the body panel downward so the tee hangs over the hips ---- */
    const extSrc = [], extVec = [];                      // for each added vertex: its body vertex, its offset
    const S = (v) => (v < nV ? v : extSrc[v - nV]);
    const axis0 = bone('pelvis');
    if (spec.extend > 0) {
      const count = new Map(), dir = [];
      for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + (e + 1) % 3], key = a < b ? a * nV + b : b * nV + a;
        count.set(key, (count.get(key) || 0) + 1); dir.push([a, b, key]);
      }
      const rings = 5, made = new Map();
      const ring = (v, j) => {
        if (j === 0) return v;
        const key = v * 8 + j; let id = made.get(key);
        if (id === undefined) {
          id = nV + extSrc.length; made.set(key, id); extSrc.push(v);
          let rx = Pa.getX(v) - axis0.x, rz = Pa.getZ(v) - axis0.z; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
          const f = j / rings;
          extVec.push([rx * spec.flare * k * f, -spec.extend * k * f, rz * spec.flare * k * f]);
        }
        return id;
      };
      for (const [a, b, key] of dir) {
        if (count.get(key) !== 1 || side[a] || side[b] || Pa.getY(a) > yWaist + 0.04 * k || Pa.getY(b) > yWaist + 0.04 * k) continue;
        for (let j = 1; j <= rings; j++) { const a0 = ring(a, j - 1), b0 = ring(b, j - 1), a1 = ring(a, j), b1 = ring(b, j); tris.push(b0, a0, a1, b0, a1, b1); }
      }
    }

    /* ---- 3. unwrap: split the triangles into panels and give each its own vertices ---- */
    const nrm = new THREE.Vector3();
    const panelOf = (a, b, c) => {
      a = S(a); b = S(b); c = S(c);
      const sl = side[a] + side[b] + side[c];
      if (sl >= 2) return 'sleeveL';
      if (sl <= -2) return 'sleeveR';
      nrm.set(0, 0, 0);
      for (const v of [a, b, c]) nrm.z += Na.getZ(v);
      return nrm.z >= 0 ? 'front' : 'back';
    };
    // cylindrical angle of a sleeve vertex (0 = outer side of the arm, seam at ±π = the underside)
    const theta = (v, s) => {
      const a = arm[s === 1 ? 'l' : 'r'];
      P(v, p);
      const forearm = sleeveT[v] > 1, axis = forearm ? a.u2 : a.u1, c0 = forearm ? a.E : a.A;
      q.copy(p).sub(c0); q.addScaledVector(axis, -q.dot(axis));            // radial part
      const r0 = new THREE.Vector3(s, 0, 0); r0.addScaledVector(axis, -r0.dot(axis)).normalize();   // outer direction
      const r1 = new THREE.Vector3().crossVectors(axis, r0);
      return Math.atan2(q.dot(r1), q.dot(r0));
    };
    const vertKey = new Map(), src = [], orig = [], uvRaw = [], panel = [], out = [];
    const getV = (v, pn, shift) => {
      const key = `${v}|${pn}|${shift}`;
      let id = vertKey.get(key);
      if (id !== undefined) return id;
      id = src.length; vertKey.set(key, id); src.push(S(v)); orig.push(v); panel.push(pn);
      P(S(v), p);
      if (v >= nV) { const e = extVec[v - nV]; p.x += e[0]; p.y += e[1]; p.z += e[2]; }
      // surfaces that face upward (the shoulder tops) would collapse in a flat front-on projection:
      // let depth unfold them (weighted by how much the surface faces up, so the chest isn't sheared)
      const up = smooth(0.35, 0.9, Na.getY(S(v))), dz = (p.z - axis0.z) * up * 0.9;
      if (pn === 'front') uvRaw.push([p.x, p.y + dz]);
      else if (pn === 'back') uvRaw.push([-p.x, p.y - dz]);
      else {
        const s = pn === 'sleeveL' ? 1 : -1;
        let th = theta(v, s); if (shift && th < 0) th += 2 * Math.PI;
        const t = Math.max(0, sleeveT[v]), len = t <= 1 ? t * arm.l.l1 : arm.l.l1 + (t - 1) * arm.l.l2;
        uvRaw.push([len, (th + Math.PI) * 0.05]);
      }
      return id;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      const pn = panelOf(a, b, c);
      let shift = 0;
      if (pn.startsWith('sleeve')) { const s = pn === 'sleeveL' ? 1 : -1, ts = [a, b, c].map((v) => theta(v, s)); shift = Math.max(...ts) - Math.min(...ts) > Math.PI ? 1 : 0; }
      out.push(getV(a, pn, shift), getV(b, pn, shift), getV(c, pn, shift));
    }
    // pack the panels into the atlas
    const bounds = {};
    for (let i = 0; i < src.length; i++) {
      const b = bounds[panel[i]] ||= [Infinity, Infinity, -Infinity, -Infinity];
      b[0] = Math.min(b[0], uvRaw[i][0]); b[1] = Math.min(b[1], uvRaw[i][1]); b[2] = Math.max(b[2], uvRaw[i][0]); b[3] = Math.max(b[3], uvRaw[i][1]);
    }
    const fit = (names2) => {   // one shared scale for a group of panels
      let w = 0, h = 0;
      for (const n of names2) if (bounds[n]) { w = Math.max(w, bounds[n][2] - bounds[n][0]); h = Math.max(h, bounds[n][3] - bounds[n][1]); }
      const L = UV_LAYOUT[names2[0]];
      return Math.min((L.u[1] - L.u[0]) / (w || 1), (L.v[1] - L.v[0]) / (h || 1));
    };
    const scale = { front: fit(['front', 'back']), back: fit(['front', 'back']), sleeveL: fit(['sleeveL', 'sleeveR']), sleeveR: fit(['sleeveL', 'sleeveR']) };
    const uv = new Float32Array(src.length * 2);
    for (let i = 0; i < src.length; i++) {
      const pn = panel[i], b = bounds[pn], L = UV_LAYOUT[pn], s = scale[pn];
      uv[i * 2] = L.u[0] + (uvRaw[i][0] - b[0]) * s;
      uv[i * 2 + 1] = L.v[0] + (uvRaw[i][1] - b[1]) * s;
    }
    this.uvInfo = { panels: Object.keys(bounds), scale };

    /* ---- 4. geometry: body attributes of the source vertices, pushed out, loosened and smoothed ---- */
    const n = src.length, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    {
      // work on unique vertices (panel copies of a vertex must stay identical)
      const uniq = [...new Set(tris)], at = new Map(uniq.map((v, i) => [v, i])), m = uniq.length;
      const base = new Float32Array(m * 3), nb = new Float32Array(m * 3), rest = new Float32Array(m * 3), e0 = new Float32Array(m);
      const added = new Uint8Array(m);
      const yShoulder = bone('upperarm_l').y;
      // hang: below the armpits a tee falls straight from its widest point instead of following the waist.
      // Per 1 cm slice: half-width and front/back depth of the body; running maximum from the armpits down.
      const cx = axis0.x, cz = axis0.z, BIN = 0.01, yLo = yHem - 0.25, nbins = Math.ceil((yShoulder - yLo) / BIN) + 2;
      const raw = { x: new Float32Array(nbins), f: new Float32Array(nbins), b: new Float32Array(nbins) };
      const binOf = (y) => Math.min(nbins - 1, Math.max(0, Math.floor((y - yLo) / BIN)));
      for (let i = 0; i < m; i++) {
        const id = uniq[i]; if (id >= nV) continue; const v = id;
        if (side[v]) continue;
        const bn = binOf(Pa.getY(v));
        raw.x[bn] = Math.max(raw.x[bn], Math.abs(Pa.getX(v) - cx)); raw.f[bn] = Math.max(raw.f[bn], Pa.getZ(v) - cz); raw.b[bn] = Math.max(raw.b[bn], cz - Pa.getZ(v));
      }
      const env = { x: Float32Array.from(raw.x), f: Float32Array.from(raw.f), b: Float32Array.from(raw.b) };
      const yHang = yShoulder - 0.12 * k;
      for (let bn = nbins - 2; bn >= 0; bn--) {
        if (yLo + bn * BIN > yHang) continue;
        for (const key of ['x', 'f', 'b']) env[key][bn] = Math.max(raw[key][bn] || 0, env[key][bn + 1]);
      }
      for (const key of ['x', 'f', 'b']) { const a = Float32Array.from(env[key]); for (let bn = 2; bn < nbins - 2; bn++) env[key][bn] = (a[bn - 2] + a[bn - 1] + a[bn] + a[bn + 1] + a[bn + 2]) / 5; }
      // how far the underwear (bra, panties, shorts) stands off the skin at each point: the shirt goes over it
      const cover = new Float32Array(m);
      {
        const partA = g.attributes._part, CELL = 0.012, hash = new Map(), kk = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
        if (partA) {
          for (let v = 0; v < nV; v++) if (partA.getX(v) > 3.5) {
            const key = kk(Math.floor(Pa.getX(v) / CELL), Math.floor(Pa.getY(v) / CELL), Math.floor(Pa.getZ(v) / CELL));
            (hash.get(key) || hash.set(key, []).get(key)).push(v);
          }
          for (let i = 0; i < m; i++) {
            const id = uniq[i]; if (id >= nV || side[id]) continue; const v = id;
            const px = Pa.getX(v), py = Pa.getY(v), pz = Pa.getZ(v), nx = Na.getX(v), ny = Na.getY(v), nz = Na.getZ(v);
            const cx0 = Math.floor(px / CELL), cy0 = Math.floor(py / CELL), cz0 = Math.floor(pz / CELL);
            let best = 0;
            for (let x = cx0 - 1; x <= cx0 + 1; x++) for (let y = cy0 - 1; y <= cy0 + 1; y++) for (let z = cz0 - 1; z <= cz0 + 1; z++) {
              const l = hash.get(kk(x, y, z)); if (!l) continue;
              for (const c of l) { const t = (Pa.getX(c) - px) * nx + (Pa.getY(c) - py) * ny + (Pa.getZ(c) - pz) * nz; if (t > best) best = t; }
            }
            cover[i] = Math.min(0.03, best);
          }
        }
        // neighbours of covered skin must clear it too, and the value must fade, not step
        const nb2 = Array.from({ length: m }, () => new Set());
        for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a2 = at.get(tris[t + e]), b2 = at.get(tris[t + (e + 1) % 3]); nb2[a2].add(b2); nb2[b2].add(a2); }
        for (let pass = 0; pass < 10; pass++) {
          const c2 = Float32Array.from(cover);
          for (let i = 0; i < m; i++) for (const j of nb2[i]) c2[i] = Math.max(c2[i], cover[j] * 0.93);
          cover.set(c2);
        }
      }
      for (let i = 0; i < m; i++) {
        const id = uniq[i], v = S(id), ev = id >= nV ? extVec[id - nV] : [0, 0, 0];
        added[i] = id >= nV ? 1 : 0;
        const bx = [Pa.getX(v), Pa.getY(v), Pa.getZ(v)], nn = [Na.getX(v), Na.getY(v), Na.getZ(v)];
        if (!side[v] && bx[1] < yHang) {   // widen the slice to the hang envelope
          const bn = binOf(bx[1]), dx = bx[0] - cx, dz = bx[2] - cz;
          const sx = raw.x[bn] > 0.03 ? Math.min(1.7, env.x[bn] / raw.x[bn]) : 1;
          const sz = dz >= 0 ? (raw.f[bn] > 0.03 ? Math.min(1.7, env.f[bn] / raw.f[bn]) : 1) : (raw.b[bn] > 0.03 ? Math.min(1.7, env.b[bn] / raw.b[bn]) : 1);
          bx[0] = cx + dx * sx; bx[2] = cz + dz * sz;
        }
        for (let c = 0; c < 3; c++) { base[i * 3 + c] = bx[c]; nb[i * 3 + c] = nn[c]; }
        e0[i] = side[v] ? spec.easeSleeve : spec.ease;
        const y = bx[1];
        const hang = side[v] ? 0 : spec.loose * k * smooth(yShoulder, yShoulder - 0.12 * k, y);
        const under = side[v] ? 0 : spec.underwear * k * (1 - smooth(yWaist - 0.06 * k, yWaist + 0.005, y));
        e0[i] += under + (side[v] ? 0 : spec.hips * k * smooth(yWaist + 0.09 * k, yWaist - 0.03 * k, y));
        for (let c = 0; c < 3; c++) rest[i * 3 + c] = bx[c] + ev[c] + nn[c] * (e0[i] + hang + cover[i]);
      }
      // adjacency; boundary vertices (open edges) are smoothed along the boundary only
      const nbr = Array.from({ length: m }, () => new Set()), edgeUse = new Map();
      for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
        const a2 = at.get(tris[t + e]), b2 = at.get(tris[t + (e + 1) % 3]);
        nbr[a2].add(b2); nbr[b2].add(a2);
        const key = a2 < b2 ? a2 * m + b2 : b2 * m + a2; edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
      }
      const bnd = Array.from({ length: m }, () => []);
      for (const [key, c] of edgeUse) if (c === 1) { const a2 = Math.floor(key / m), b2 = key % m; bnd[a2].push(b2); bnd[b2].push(a2); }
      const tmp = new Float32Array(m * 3);
      const relax = (f) => {   // move each vertex a fraction f toward the mean of its neighbours (f < 0 pushes away)
        for (let i = 0; i < m; i++) {
          const list = bnd[i].length ? bnd[i] : [...nbr[i]];
          for (let c = 0; c < 3; c++) {
            if (!list.length) { tmp[i * 3 + c] = rest[i * 3 + c]; continue; }
            let sum = 0; for (const j of list) sum += rest[j * 3 + c];
            tmp[i * 3 + c] = rest[i * 3 + c] + f * (sum / list.length - rest[i * 3 + c]);
          }
        }
        rest.set(tmp);
      };
      for (let it = 0; it < spec.smooth; it++) { relax(0.5); relax(-0.53); }   // Taubin: smooths without shrinking
      for (let it = 0; it < spec.polish; it++) relax(0.5);                       // then remove what is left of small bumps
      // never closer to the skin than half the ease (smoothing bridges hollows but must not dig into bumps)
      for (let i = 0; i < m; i++) {
        if (added[i]) continue;
        let d = 0; for (let c = 0; c < 3; c++) d += (rest[i * 3 + c] - base[i * 3 + c]) * nb[i * 3 + c];
        const floor = e0[i] * 0.3 + cover[i] + (cover[i] > 0 ? 0.002 : 0);
        if (d < floor) for (let c = 0; c < 3; c++) rest[i * 3 + c] += nb[i * 3 + c] * (floor - d);
      }
      // shading normals of the SMOOTHED cloth (not the body's, which would show the muscles through the shirt)
      const nm = new Float32Array(m * 3);
      for (let t = 0; t < tris.length; t += 3) {
        const a2 = at.get(tris[t]) * 3, b2 = at.get(tris[t + 1]) * 3, c2 = at.get(tris[t + 2]) * 3;
        const ux = rest[b2] - rest[a2], uy = rest[b2 + 1] - rest[a2 + 1], uz = rest[b2 + 2] - rest[a2 + 2];
        const vx = rest[c2] - rest[a2], vy = rest[c2 + 1] - rest[a2 + 1], vz = rest[c2 + 2] - rest[a2 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const o of [a2, b2, c2]) { nm[o] += nx; nm[o + 1] += ny; nm[o + 2] += nz; }
      }
      for (let i = 0; i < m; i++) { const l = Math.hypot(nm[i * 3], nm[i * 3 + 1], nm[i * 3 + 2]) || 1; nm[i * 3] /= l; nm[i * 3 + 1] /= l; nm[i * 3 + 2] /= l; }
      for (let i = 0; i < n; i++) {
        const u = at.get(orig[i]);
        for (let c = 0; c < 3; c++) { pos[i * 3 + c] = rest[u * 3 + c]; nor[i * 3 + c] = nm[u * 3 + c]; }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(new SI.array.constructor(n * 4), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    geo.setIndex(out);
    // the body's shape morphs (the garment moves exactly like the skin underneath it)
    geo.morphTargetsRelative = true;
    for (const key of ['position', 'normal']) {
      const list = g.morphAttributes[key];
      if (!list) continue;
      geo.morphAttributes[key] = list.map((m) => {
        const a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const v = src[i]; a[i * 3] = m.array[v * 3]; a[i * 3 + 1] = m.array[v * 3 + 1]; a[i * 3 + 2] = m.array[v * 3 + 2]; }
        const at = new THREE.BufferAttribute(a, 3); at.name = m.name; return at;
      });
    }
    this.src = src;
    this.geometry = geo;
    this.#copyWeights();

    this.texture = null;
    this.material = new THREE.MeshStandardMaterial({ color: opts.color || '#dcd9d2', roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    const mesh = this.object = new THREE.SkinnedMesh(geo, this.material);
    mesh.name = 'body-garment';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
    body.parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(body.skeleton, body.bindMatrix);
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences = body.morphTargetInfluences;      // the very same array: the sliders drive both
    this.onWeights = () => this.#copyWeights();
    B.weightListeners.add(this.onWeights);
    // the body re-binds its skeleton when it changes size: take over its bind matrices every time
    this.onHuman = () => { mesh.bindMatrix.copy(body.bindMatrix); mesh.bindMatrixInverse.copy(body.bindMatrixInverse); mesh.bindMode = body.bindMode; };
    human.listeners.add(this.onHuman);
    this.stats = { vertices: n, triangles: out.length / 3, panels: this.uvInfo.panels };
  }

  /** skin indices / weights follow the body's (the armpit weights change while the arms lower) */
  #copyWeights() {
    const g = this.body.mesh.geometry, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    const si = this.geometry.attributes.skinIndex, sw = this.geometry.attributes.skinWeight;
    for (let i = 0; i < this.src.length; i++) {
      const v = this.src[i];
      for (let c = 0; c < 4; c++) { si.array[i * 4 + c] = SI.array[v * 4 + c]; sw.array[i * 4 + c] = SW.array[v * 4 + c]; }
    }
    si.needsUpdate = sw.needsUpdate = true;
  }

  /**
   * Clearance of the garment to the CURRENT body (skinned + morphed), for tests: nearest body vertex
   * distance for every garment vertex. `touching` = fraction closer than 3 mm.
   */
  audit() {
    const body = this.body.mesh, nb = body.geometry.attributes.position.count, v = new THREE.Vector3();
    const cell = 0.02, grid = new Map(), key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    const bp = new Float32Array(nb * 3);
    for (let i = 0; i < nb; i++) {
      body.getVertexPosition(i, v); bp[i * 3] = v.x; bp[i * 3 + 1] = v.y; bp[i * 3 + 2] = v.z;
      const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell), Math.floor(v.z / cell));
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
    const g = this.object, n = g.geometry.attributes.position.count, d = [];
    for (let i = 0; i < n; i++) {
      g.getVertexPosition(i, v);
      const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
      let best = Infinity;
      for (let R = 1; R <= 4 && best > R * cell; R++) for (let x = cx - R; x <= cx + R; x++) for (let y = cy - R; y <= cy + R; y++) for (let z = cz - R; z <= cz + R; z++) {
        const l = grid.get(key(x, y, z)); if (!l) continue;
        for (const j of l) { const dx = bp[j * 3] - v.x, dy = bp[j * 3 + 1] - v.y, dz = bp[j * 3 + 2] - v.z, e = dx * dx + dy * dy + dz * dz; if (e < best) best = e; }
      }
      d.push(Math.sqrt(best));
    }
    d.sort((a, b) => a - b);
    return { vertices: n, minMm: d[0] * 1000, p1Mm: d[Math.floor(n * 0.01)] * 1000, medianMm: d[Math.floor(n / 2)] * 1000, touching: d.filter((x) => x < 0.003).length / n };
  }

  setColor(c) { this.material.color.set(c); }
  /** texture map: a THREE.Texture, an image URL, or null */
  async setTexture(t) {
    if (typeof t === 'string') t = await new THREE.TextureLoader().loadAsync(t);
    if (t) { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; }
    this.material.map = t || null; this.material.needsUpdate = true;
  }
  showChecker(on) { this.material.map = on ? (this.texture ||= checkerTexture()) : null; this.material.needsUpdate = true; }

  /** the UV layout as a canvas (panel outlines) — what the texture generator paints onto */
  uvCanvas(size = 1024) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), uv = this.geometry.attributes.uv.array, ix = this.geometry.index.array;
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
    x.strokeStyle = '#222'; x.lineWidth = 1; x.beginPath();
    for (let t = 0; t < ix.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = ix[t + e], b = ix[t + (e + 1) % 3];
        x.moveTo(uv[a * 2] * size, (1 - uv[a * 2 + 1]) * size); x.lineTo(uv[b * 2] * size, (1 - uv[b * 2 + 1]) * size);
      }
    }
    x.stroke();
    return c;
  }

  dispose() {
    this.body.weightListeners.delete(this.onWeights);
    this.human.listeners.delete(this.onHuman);
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose(); this.texture?.dispose();
  }
}

/** keep only the biggest edge-connected set of triangles (drops stray fragments left by the cuts) */
function largestPiece(tris, nV) {
  const T = tris.length / 3, parent = new Int32Array(nV).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < T; t++) { const a = find(tris[t * 3]), b = find(tris[t * 3 + 1]), c = find(tris[t * 3 + 2]); parent[b] = a; parent[find(c)] = find(a); }
  const count = new Map();
  for (let t = 0; t < T; t++) { const r = find(tris[t * 3]); count.set(r, (count.get(r) || 0) + 1); }
  let best = -1, bc = 0;
  for (const [r, c] of count) if (c > bc) { best = r; bc = c; }
  const out = [];
  for (let t = 0; t < T; t++) if (find(tris[t * 3]) === best) out.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  return out;
}
