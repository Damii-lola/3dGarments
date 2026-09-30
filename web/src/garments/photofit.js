/**
 * The garment on our model sitting exactly where it sits on the person in the photo — measured, not guessed.
 *
 * Both are measured against the same body landmarks: in the photo, the wearer's pose keypoints (pose.js); on our
 * model, its joints. Everything is a fraction of the body, so photo scale and body size cancel out:
 *
 *   top      hem          (hem − shoulders) / (hips − shoulders), on the torso's centre line
 *            sleeve end   along shoulder → elbow → wrist: 0 at the shoulder, 1 at the elbow, 2 at the wrist
 *   bottom   hem          along hip → knee → ankle: 0 at the hip, 1 at the knee, 2 at the ankle
 *            waist        how far above the hips the waistband sits, in hip → knee lengths
 *            leg width    the leg's width at the knee / the distance between the hips
 *
 * fitToPhoto() then rebuilds the pattern with its lengths / widths scaled by target ÷ now, sews it, measures again,
 * a few times — until the garment on the model matches the photo.
 */

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mid = (a, b) => (a && b ? lerp(a, b, 0.5) : a || b || null);

/* ================================================================ the photo */

/** @param mask garment mask over the whole photo, kp: pose.js keypoints → { hem, sleeve, top, legW } (null = unseen) */
export function photoMeasures(parsed, mask, kp, zone) {
  const { w, h } = parsed;
  const at = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]; };
  const near = (x, y, r = 2) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy)) return true; return false; };
  const out = {};
  const S = mid(kp.shoulder_l, kp.shoulder_r), Hp = mid(kp.hip_l, kp.hip_r);
  if (zone !== 'lower' && S && Hp && Hp.y - S.y > 10) {
    // hem: the lowest garment row on the torso's centre line (a hem at the photo's edge is unseen)
    let hem = -1;
    for (let dx = -6; dx <= 6; dx += 3) for (let y = Math.round(S.y); y < h; y++) {
      const x = S.x + (Hp.x - S.x) * ((y - S.y) / (Hp.y - S.y)) + dx;
      if (at(x, y)) hem = Math.max(hem, y);
    }
    if (hem > 0 && hem < h - 4) out.hem = (hem - S.y) / (Hp.y - S.y);
    // sleeves: how far down each arm the garment covers it, continuously from the shoulder
    const sl = [];
    for (const s of ['l', 'r']) {
      const A = kp[`shoulder_${s}`], E = kp[`elbow_${s}`], Wr = kp[`wrist_${s}`];
      if (!A || !E) continue;
      let last = 0, gap = 0;
      for (let t = 0.1; t <= (Wr ? 2 : 1); t += 0.02) {
        const p = t <= 1 ? lerp(A, E, t) : lerp(E, Wr, t - 1);
        if (near(p.x, p.y)) { last = t; gap = 0; } else if (++gap > 4) break;
      }
      // a sleeve ending at the photo's edge is unseen
      const end = last <= 1 ? lerp(A, E, last) : lerp(E, Wr, last - 1);
      if (end.x > 3 && end.y > 3 && end.x < w - 4 && end.y < h - 4) sl.push(last);
    }
    if (sl.length) out.sleeve = sl.reduce((a, b) => a + b) / sl.length;
  }
  if (zone !== 'upper' && Hp) {
    const hems = [], widths = [];
    for (const s of ['l', 'r']) {
      const Hs = kp[`hip_${s}`], K = kp[`knee_${s}`], A = kp[`ankle_${s}`];
      if (!Hs || !K) continue;
      // lowest garment row along this leg's line
      let hem = -1;
      const lineX = (y) => (y <= K.y ? Hs.x + (K.x - Hs.x) * ((y - Hs.y) / (K.y - Hs.y)) : A ? K.x + (A.x - K.x) * ((y - K.y) / ((A.y - K.y) || 1)) : K.x);
      for (let y = Math.round(Hs.y); y < h; y++) for (let dx = -8; dx <= 8; dx += 4) if (at(lineX(y) + dx, y)) hem = Math.max(hem, y);
      if (hem > 0 && hem < h - 4) hems.push(hem <= K.y ? (hem - Hs.y) / (K.y - Hs.y) : A ? 1 + (hem - K.y) / ((A.y - K.y) || 1) : null);
      // the leg's width at the knee: the garment run through the knee point
      let x0 = K.x, x1 = K.x;
      if (at(K.x, K.y)) { while (at(x0 - 1, K.y)) x0--; while (at(x1 + 1, K.y)) x1++; widths.push(x1 - x0); }
    }
    const hv = hems.filter((v) => v != null);
    if (hv.length) out.hem = hv.reduce((a, b) => a + b) / hv.length;
    const hipW = kp.hip_l && kp.hip_r ? Math.hypot(kp.hip_l.x - kp.hip_r.x, kp.hip_l.y - kp.hip_r.y) : 0;
    if (widths.length && hipW) out.legW = widths.reduce((a, b) => a + b) / widths.length / hipW;
    // the waistband: the garment's top on the body's centre line
    const K = mid(kp.knee_l, kp.knee_r);
    if (K) {
      let top = h;
      for (let y = 0; y < h; y++) if (at(Hp.x, y) || at(Hp.x - 5, y) || at(Hp.x + 5, y)) { top = y; break; }
      if (top > 3 && top < Hp.y + (K.y - Hp.y)) out.top = (Hp.y - top) / (K.y - Hp.y);
    }
  }
  return out;
}

/* ================================================================ our model */

/** the same measures on a built garment (posed points, the human's local space) */
export function modelMeasures(human, pts, zone) {
  const B = human.active, obj = human.object;
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const J = (n) => { const v = B.bones[B.boneIndex[n]].getWorldPosition(new (B.bones[0].position.constructor)()).applyMatrix4(inv); return { x: v.x, y: v.y, z: v.z }; };
  const S = mid(J('upperarm_l'), J('upperarm_r')), Hp = mid(J('thigh_l'), J('thigh_r'));
  const n = pts.length / 3, out = {};
  if (zone !== 'lower') {
    const hipHalf = Math.abs(J('thigh_l').x - J('thigh_r').x) / 2 + 0.03;
    let hem = Infinity;
    for (let i = 0; i < n; i++) if (Math.abs(pts[i * 3] - S.x) < hipHalf && pts[i * 3 + 1] < S.y) hem = Math.min(hem, pts[i * 3 + 1]);
    if (Number.isFinite(hem)) out.hem = (S.y - hem) / (S.y - Hp.y);
    const sl = [];
    for (const s of ['l', 'r']) {
      const A = J(`upperarm_${s}`), E = J(`lowerarm_${s}`), Wr = J(`hand_${s}`);
      let best = 0;
      for (let i = 0; i < n; i++) {
        const p = { x: pts[i * 3], y: pts[i * 3 + 1], z: pts[i * 3 + 2] };
        for (const [P, Q, t0] of [[A, E, 0], [E, Wr, 1]]) {
          const ex = Q.x - P.x, ey = Q.y - P.y, ez = Q.z - P.z, l2 = ex * ex + ey * ey + ez * ez;
          const t = ((p.x - P.x) * ex + (p.y - P.y) * ey + (p.z - P.z) * ez) / l2;
          if (t < 0 || t > 1) continue;
          const d = Math.hypot(p.x - P.x - ex * t, p.y - P.y - ey * t, p.z - P.z - ez * t);
          if (d < 0.09 && t0 + t > best) best = t0 + t;
        }
      }
      if (best > 0.1) sl.push(best);
    }
    if (sl.length) out.sleeve = sl.reduce((a, b) => a + b) / sl.length;
  }
  if (zone !== 'upper') {
    const hems = [], widths = [];
    for (const s of ['l', 'r']) {
      const Hs = J(`thigh_${s}`), K = J(`calf_${s}`), A = J(`foot_${s}`), side = Math.sign(Hs.x);
      let hem = Infinity;
      for (let i = 0; i < n; i++) if (Math.sign(pts[i * 3]) === side && Math.abs(pts[i * 3]) > 0.02) hem = Math.min(hem, pts[i * 3 + 1]);
      if (Number.isFinite(hem)) hems.push(hem >= K.y ? (Hs.y - hem) / (Hs.y - K.y) : 1 + (K.y - hem) / (K.y - A.y));
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < n; i++) if (Math.abs(pts[i * 3 + 1] - K.y) < 0.012 && Math.sign(pts[i * 3]) === side) { x0 = Math.min(x0, pts[i * 3]); x1 = Math.max(x1, pts[i * 3]); }
      if (x1 > x0) widths.push(x1 - x0);
    }
    if (hems.length) out.hem = hems.reduce((a, b) => a + b) / hems.length;
    const hipW = Math.abs(J('thigh_l').x - J('thigh_r').x);
    if (widths.length) out.legW = widths.reduce((a, b) => a + b) / widths.length / hipW;
    let top = -Infinity; for (let i = 0; i < n; i++) top = Math.max(top, pts[i * 3 + 1]);
    const K = mid(J('calf_l'), J('calf_r'));
    out.top = (top - Hp.y) / (Hp.y - K.y);
  }
  return out;
}

/* ================================================================ the fit */

/** which pattern value moves which measure (and how: 'dist' = scale by the ratio of distances from the start) */
const KNOBS = {
  upper: [['hem', 'shirt.length'], ['sleeve', 'sleeve.length']],
  lower: [['hem', 'LOWER_LENGTH'], ['legW', 'pants.width']],
};
const LOWER_KEYS = ['pants.length', 'skirt.length', 'flare-skirt.length', 'pencil-skirt.length', 'levels-skirt.length'];

/** next overrides from where the garment is (now) and where it should be (target), given the values used (fit) */
export function nextOverrides(zone, target, now, fit, prev = {}) {
  const o = { ...prev };
  for (const [m, key] of KNOBS[zone === 'lower' ? 'lower' : 'upper'] || []) {
    const t = target[m], c = now[m];
    if (t == null || c == null || c <= 0.02) continue;
    const k = Math.max(0.6, Math.min(1.6, t / c));
    if (Math.abs(1 - k) < 0.03) continue;                             // within 3 %: leave it
    const keys = key === 'LOWER_LENGTH' ? LOWER_KEYS : [key];
    for (const kk of keys) if (fit[kk] != null) o[kk] = fit[kk] * k;
  }
  return o;
}

export const fitError = (target, now) => {
  let e = 0, n = 0;
  for (const m of Object.keys(target)) if (now[m] != null && target[m] != null) { e += Math.abs(now[m] - target[m]) / Math.max(0.2, Math.abs(target[m])); n++; }
  return n ? e / n : 0;
};
