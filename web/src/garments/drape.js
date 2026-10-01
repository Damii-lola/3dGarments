/**
 * How a garment HANGS off the body instead of hugging it like the bodysuit: per body vertex a rest-space offset
 * (`drape`, added before skinning) from the body's surface out to where the garment's fabric is.
 *
 *   torso   at every height the body's cross-section is wrapped in its convex hull (fabric spans the hollows — between
 *           the pecs, over the abs, the small of the back) and that hull is widened until its length is the GARMENT's
 *           own girth there (front + back flat widths off the photos): mostly forward and back, hardly at the sides
 *           (the arms hang there). A boxy shirt so falls straight from the chest; a fitted one, whose photo is as
 *           wide as the body, stays on it. The shoulders and neck carry it: no offset there, easing in below.
 *   sleeves around the arm, the arm's cross-section scaled out to the sleeve's own girth (its photo width) — a short
 *           sleeve stands off the arm as it does on the hanger; eased in at the armhole
 * Vertices weighted to both (the armpit) blend the two by their arm weight.
 */

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** convex hull (monotone chain) of 2D points [[x, z] …] → polygon, counter-clockwise */
function hull(pts) {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const perimeter = (poly, cx, cz, kx, kz) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * kz);
  }
  return s;
};
/** where a ray from (cx, cz) in direction (dx, dz) leaves the polygon → distance */
function rayOut(poly, cx, cz, dx, dz) {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - cx) * ez - (a[1] - cz) * ex) / den, u = ((a[0] - cx) * dz - (a[1] - cz) * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

/**
 * @param body    layer.js bodyNow()
 * @param opts    { inTorso(i), girth(h) → the garment's girth (m) at h metres below the shoulder line (0: none there),
 *                  sleeves: { l?: girth(along m) → m, r?: … }, used: Set of body vertex indices to compute }
 * @returns { all: Float32Array(n × 3) rest-space offsets, torso: the torso's share of them, arm: per bone 1 if an arm's —
 *            the torso's share is carried by the vertex's torso bones alone (a raised arm doesn't swing the hang of
 *            the shirt's side up with it: the armpit stays closed), the rest (the sleeves) by its skin weights }
 */
export function drapeField(body, { inTorso, girth, flat = null, sleeves = {}, used, ease: ease0 = 0.12, fall = 0.12, sleeveEase = 0.14, collarTop = 0.075, collarFlare = 0.32 }) {
  const { Q, n, B } = body, D = new Float32Array(n * 3), DT = new Float32Array(n * 3);
  const g = body.g, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
  const names = B.bones.map((b) => b.name);
  const armOf = names.map((nm) => { const m = nm.match(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)\w*_(l|r)$/); return m ? m[2] : null; });
  const armW = (i, side) => { let w = 0; for (let k = 0; k < 4; k++) if (armOf[SI[i * 4 + k]] === side) w += SW[i * 4 + k]; return w; };

  /* ---- torso: hull per 1 cm slice, widened to the garment's girth ---- */
  const BIN = 0.01;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) if (inTorso(i)) { y0 = Math.min(y0, Q[i * 3 + 1]); y1 = Math.max(y1, Q[i * 3 + 1]); }
  const nb = Math.max(1, Math.ceil((y1 - y0) / BIN) + 1), pts = Array.from({ length: nb }, () => []);
  for (let i = 0; i < n; i++) if (inTorso(i)) pts[Math.min(nb - 1, Math.floor((Q[i * 3 + 1] - y0) / BIN))].push([Q[i * 3], Q[i * 3 + 2]]);
  const slices = pts.map((p) => {
    if (p.length < 6) return null;
    const poly = hull(p);
    let cx = 0, cz = 0; for (const q of poly) { cx += q[0]; cz += q[1]; } cx /= poly.length; cz /= poly.length;
    return { poly, cx, cz, P: perimeter(poly, 0, 0, 1, 1) };
  });
  // the hanging surface as one smooth field: per slice its hull's radius by angle round a centre, both smoothed over
  // heights (±6 cm) — a slice's own hull, from the few vertices in it, jitters, and a horizontal hull can't bridge
  // what runs across (the grooves between the abs, under the pecs): the fabric spans those too
  const sm = (a, r = 4) => Float64Array.from(a, (_, b) => { let s = 0, c = 0; for (let d = -r; d <= r; d++) if (b + d >= 0 && b + d < nb && slices[b + d]) { s += a[b + d]; c++; } return c ? s / c : a[b]; });
  const NA = 96, CX = sm(Float64Array.from(slices, (s) => (s ? s.cx : 0)), 6), CZ = sm(Float64Array.from(slices, (s) => (s ? s.cz : 0)), 6);
  const Rraw = new Float64Array(nb * NA);
  for (let b = 0; b < nb; b++) {
    const s = slices[b]; if (!s) continue;
    for (let a = 0; a < NA; a++) { const t = (a / NA) * Math.PI * 2; Rraw[b * NA + a] = rayOut(s.poly, CX[b], CZ[b], Math.sin(t), Math.cos(t)); }
  }
  const RS = new Float64Array(nb * NA);
  for (let b = 0; b < nb; b++) for (let a = 0; a < NA; a++) {
    let s = 0, c = 0;
    // (an upper envelope, not a mean: the fabric rests on the high points and spans the low ones)
    for (let d = -6; d <= 6; d++) if (b + d >= 0 && b + d < nb && slices[b + d]) { const w = 1 - Math.abs(d) / 7; s += w * Rraw[(b + d) * NA + a] ** 4; c += w; }
    RS[b * NA + a] = c ? (s / c) ** 0.25 : 0;
  }
  const hAt = (b) => body.ys - (y0 + (b + 0.5) * BIN);
  const perim = (T, b) => { let s = 0; for (let a = 0; a < NA; a++) { const t0 = (a / NA) * Math.PI * 2, t1 = ((a + 1) / NA) * Math.PI * 2, r0 = T[b * NA + a], r1 = T[b * NA + (a + 1) % NA]; s += Math.hypot(r1 * Math.sin(t1) - r0 * Math.sin(t0), r1 * Math.cos(t1) - r0 * Math.cos(t0)); } return s; };
  // the fabric's radius: the envelope plus EASE (a woven garment stands off the body: more in front and behind than at
  // the sides, where the arms hang), then GRAVITY — below the chest it falls, never coming back in faster than `fall`
  // (m per m): off the chest / shoulder blades straight down, clear of the abs, the waist, the small of the back
  const TS = new Float64Array(nb * NA);
  for (let b = 0; b < nb; b++) for (let a = 0; a < NA; a++) {
    const t = (a / NA) * Math.PI * 2, fz = Math.cos(t) ** 2;
    TS[b * NA + a] = RS[b * NA + a] * (1 + ease0 * (0.35 + 0.65 * fz));
  }
  // up and down too the fabric spans the hollows: from the collarbone straight onto the chest, from the shoulder blades
  // onto the small of the back — per angle, the profile's upper hull (radius against height)
  for (let a = 0; a < NA; a++) {
    const H = [];
    for (let b = nb - 1; b >= 0; b--) {
      if (!slices[b] || hAt(b) < -0.01) continue;
      const q = [y0 + (b + 0.5) * BIN, TS[b * NA + a], b];
      while (H.length >= 2) {
        const o = H[H.length - 2], m = H[H.length - 1];
        if ((m[0] - o[0]) * (q[1] - o[1]) - (m[1] - o[1]) * (q[0] - o[0]) <= 0) H.pop(); else break;   // m under the chord o–q
      }
      H.push(q);
    }
    for (let k = 0; k + 1 < H.length; k++) {
      const [ya, ra, ba] = H[k], [yb, rb, bb] = H[k + 1];
      for (let b = bb + 1; b < ba; b++) { const t = (y0 + (b + 0.5) * BIN - ya) / (yb - ya), r = ra + (rb - ra) * t; if (r > TS[b * NA + a]) TS[b * NA + a] = r; }
    }
  }
  for (let b = nb - 2; b >= 0; b--) {
    if (!slices[b] || !slices[b + 1]) continue;
    const on = smooth(0.04, 0.12, hAt(b));
    for (let a = 0; a < NA; a++) {
      const fallen = TS[(b + 1) * NA + a] - fall * BIN;
      if (fallen > TS[b * NA + a]) TS[b * NA + a] += (fallen - TS[b * NA + a]) * on;
    }
  }
  // the photo's own shape below the chest (a flared hem, an A-line): where the garment is wider, relative to its
  // chest, than the fallen fabric is, relative to its own, it's widened to match
  let bc = -1, Gc = 0;
  for (let b = 0; b < nb; b++) { const h = hAt(b), G = girth(h); if (slices[b] && h > 0.08 && h < 0.3 && G > Gc) { Gc = G; bc = b; } }
  const kx = new Float64Array(nb).fill(1);
  if (bc >= 0) {
    const Pc = perim(TS, bc);
    for (let b = 0; b < bc; b++) {
      if (!slices[b]) continue;
      const want = (girth(hAt(b)) / Gc) * Pc, have = perim(TS, b);
      if (want > have) kx[b] = Math.min(1.5, want / have);
    }
  }
  const KX = sm(kx, 5);
  // how much bigger than its photo (shoulder-scaled) the garment had to be cut: its sleeves come up the same
  const cut = bc >= 0 ? Math.max(1, (perim(TS, bc) * KX[bc]) / Gc) : 1;
  for (let b = 0; b < nb; b++) for (let a = 0; a < NA; a++) TS[b * NA + a] *= KX[b];
  // seen from the front a garment is as wide as it lies flat (a boxy shirt hangs straight off the shoulders, its
  // sides well out from the waist): where the fabric's sides are in from the photo's flat half-width, they're taken
  // out to it — mostly at the sides (sin² of the angle), the front and back hardly moved
  if (flat) {
    const kSide = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      if (!slices[b]) continue;
      const want = flat(hAt(b)) / 2;
      if (!(want > 0)) continue;
      let ext = 0;
      for (let a = 0; a < NA; a++) ext = Math.max(ext, Math.abs(TS[b * NA + a] * Math.sin((a / NA) * Math.PI * 2)));
      if (want > ext) kSide[b] = Math.min(0.6, want / ext - 1);
    }
    const KS = sm(kSide, 6);
    for (let b = 0; b < nb; b++) if (KS[b] > 0) for (let a = 0; a < NA; a++) TS[b * NA + a] *= 1 + KS[b] * Math.sin((a / NA) * Math.PI * 2) ** 2;
  }
  // round the angle too (±3 bins): no facets from the hull's corners
  const TT = new Float64Array(nb * NA);
  for (let b = 0; b < nb; b++) for (let a = 0; a < NA; a++) { let s = 0; for (let d = -3; d <= 3; d++) s += TS[b * NA + (a + d + NA) % NA] * (4 - Math.abs(d)); TT[b * NA + a] = s / 16; }
  const Rat = (b, ang) => {
    let f = ((ang / (Math.PI * 2)) % 1 + 1) % 1 * NA; const a0 = Math.floor(f) % NA, a1 = (a0 + 1) % NA; f -= Math.floor(f);
    return TT[b * NA + a0] * (1 - f) + TT[b * NA + a1] * f;
  };

  /* ---- arms: the arm's mean radius along it, the sleeve's girth there ---- */
  const arm = {};
  for (const side of ['l', 'r']) {
    if (!sleeves[side]) continue;
    const S = body.joint(`upperarm_${side}`), E = body.joint(`lowerarm_${side}`), W = body.joint(`hand_${side}`);
    const seg = [[S, E], [E, W]].map(([a, b]) => ({ a, d: b.clone().sub(a).normalize(), len: a.distanceTo(b) }));
    const axis = (i) => {
      const v = [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]];
      let s = seg[0], t = (v[0] - s.a.x) * s.d.x + (v[1] - s.a.y) * s.d.y + (v[2] - s.a.z) * s.d.z, along = t;
      if (t > s.len) { s = seg[1]; t = (v[0] - s.a.x) * s.d.x + (v[1] - s.a.y) * s.d.y + (v[2] - s.a.z) * s.d.z; along = seg[0].len + t; }
      const px = s.a.x + s.d.x * t, py = s.a.y + s.d.y * t, pz = s.a.z + s.d.z * t;
      return { along, r: [v[0] - px, v[1] - py, v[2] - pz] };
    };
    const AB = 0.01, NA = 100, rs = new Float64Array(NA), rc = new Float64Array(NA);
    for (let i = 0; i < n; i++) {
      if (armW(i, side) < 0.6) continue;
      const { along, r } = axis(i), k = Math.floor(along / AB);
      if (k < 0 || k >= NA) continue;
      rs[k] += Math.hypot(r[0], r[1], r[2]); rc[k]++;
    }
    const rad = Float64Array.from(rs, (v, k) => (rc[k] ? v / rc[k] : 0));
    // the widest of the upper arm, by its 90th-percentile radius (not the mean: the fabric rests on the high side)
    const up = [];
    for (let i = 0; i < n; i++) { if (armW(i, side) < 0.6) continue; const { along, r } = axis(i); if (along > 0.02 && along < seg[0].len * 0.7) up.push(Math.hypot(r[0], r[1], r[2])); }
    up.sort((a, b) => a - b);
    // the sleeve's own profile along the arm: a straight-sided tube (its upper hull) over the arm's radius + 6 mm and
    // its girth off the photo — it falls from the shoulder in a straight line to the cuff, no puff round the deltoid
    const want = Float64Array.from(rad, (r0, k) => { const G = sleeves[side](k * AB); return G > 0 ? Math.max(r0 + 0.006, G / (2 * Math.PI)) : 0; });
    const prof = new Float64Array(NA), H = [];
    for (let k = 0; k < NA; k++) {
      if (!(want[k] > 0)) continue;
      while (H.length >= 2) { const o = H[H.length - 2], m = H[H.length - 1]; if ((m[0] - o[0]) * (want[k] - o[1]) - (m[1] - o[1]) * (k - o[0]) >= 0) H.pop(); else break; }
      H.push([k, want[k]]);
    }
    for (let q = 0; q + 1 < H.length; q++) for (let k = H[q][0]; k <= H[q + 1][0]; k++) prof[k] = H[q][1] + ((H[q + 1][1] - H[q][1]) * (k - H[q][0])) / (H[q + 1][0] - H[q][0] || 1);
    if (H.length === 1) prof[H[0][0]] = H[0][1];
    arm[side] = { axis, rad, AB, NA, girth: sleeves[side], prof, rmax: up.length ? up[Math.floor(up.length * 0.9)] : 0.05 };
  }

  /* ---- the collar: its fall stands off the neck as a cone — tight round the roll at its top (the stand is under it),
     flaring out as it comes down to lie on the shoulders — never on the neck's skin ---- */
  const NJ = body.joint('neck_01'), yTop = body.ys + collarTop, NB = 32, rTop = new Float64Array(NB), rc = new Float64Array(NB);
  for (let i = 0; i < n; i++) {
    if (Math.abs(Q[i * 3 + 1] - yTop) > 0.012) continue;
    const dx = Q[i * 3] - NJ.x, dz = Q[i * 3 + 2] - NJ.z, r = Math.hypot(dx, dz);
    if (r > 0.11) continue;
    const k = Math.floor(((Math.atan2(dx, dz) / (2 * Math.PI)) + 1) % 1 * NB);
    rTop[k] = Math.max(rTop[k], r); rc[k]++;
  }
  let rMean = 0, rN = 0; for (let k = 0; k < NB; k++) if (rc[k]) { rMean += rTop[k]; rN++; }
  rMean = rN ? rMean / rN : 0.06;
  const rAt = (ang) => { const f = ((ang / (2 * Math.PI)) + 1) % 1 * NB, k = Math.floor(f) % NB; return rc[k] ? rTop[k] : rMean; };
  const collarOff = (x, y, z) => {
    if (collarTop < 0) return null;                                   // no collar (a crew neck)
    const w = smooth(body.ys - 0.07, body.ys - 0.01, y);
    if (w <= 0) return null;
    const dx = x - NJ.x, dz = z - NJ.z, r = Math.hypot(dx, dz) || 1;
    if (r > 0.16) return null;
    const want = rAt(Math.atan2(dx, dz)) + 0.005 + Math.max(0, yTop - y) * collarFlare;
    const d = Math.max(0, want - r) * w;
    return d > 0 ? [dx / r * d, dz / r * d] : null;
  };

  for (const i of used) {
    const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2];
    let tx = 0, ty = 0, tz = 0, wt = 0;
    {
      const c = collarOff(x, y, z), wa0 = Math.min(1, armW(i, 'l') + armW(i, 'r'));
      if (c && wa0 < 0.5) { tx += c[0]; tz += c[1]; DT[i * 3] = tx; DT[i * 3 + 2] = tz; }
    }
    // the torso's hang
    const b = Math.max(0, Math.min(nb - 1, Math.floor((y - y0) / BIN))), s = slices[b];
    const wl = armW(i, 'l'), wr = armW(i, 'r'), wa = Math.min(1, wl + wr);
    if (s && wa < 0.95) {
      const h = body.ys - y, ease = smooth(-0.01, 0.07, h);                 // the shoulders carry it
      // between two slices (1 cm apart): the field interpolated in height
      const fb = Math.max(0, Math.min(nb - 1.001, (y - y0) / BIN - 0.5)), b0 = Math.floor(fb), b1 = Math.min(nb - 1, b0 + 1), tb = fb - b0;
      const cx = CX[b0] * (1 - tb) + CX[b1] * tb, cz = CZ[b0] * (1 - tb) + CZ[b1] * tb;
      let dx = x - cx, dz = z - cz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const ang = Math.atan2(dx, dz), Rh = Rat(b0, ang) * (1 - tb) + Rat(b1, ang) * tb;
      const R = Math.max(dl, Rh), px = cx + dx * R, pz = cz + dz * R;
      tx += (px - x) * ease * (1 - wa); tz += (pz - z) * ease * (1 - wa); wt += 1 - wa;
      DT[i * 3] = tx; DT[i * 3 + 2] = tz;
    }
    // the sleeves' stand-off
    for (const [side, w] of [['l', wl], ['r', wr]]) {
      const A = arm[side]; if (!A || w < 0.05) continue;
      const { along, r } = A.axis(i), k = Math.max(0, Math.min(A.NA - 1, Math.floor(along / A.AB)));
      // the sleeve's tube round the arm: its own girth (cut up as the body was), never closer than sleeveEase over the
      // arm's widest (the deltoid, the biceps: a woven sleeve falls from them), the arm's own bumps spanned
      const P = A.prof[k];
      if (!(P > 0)) continue;
      const rv = Math.hypot(r[0], r[1], r[2]) || 1, rt = Math.max(P * Math.sqrt(cut), rv + 0.004);
      const kk = Math.min(0.9, rt / rv - 1), ease = smooth(0.0, 0.12, along);      // the cap sits on the shoulder
      tx += r[0] * kk * ease * w; ty += r[1] * kk * ease * w; tz += r[2] * kk * ease * w;
    }
    D[i * 3] = tx; D[i * 3 + 1] = ty; D[i * 3 + 2] = tz;
  }
  return { all: D, torso: DT, arm: Uint8Array.from(armOf, (a) => (a ? 1 : 0)) };
}
