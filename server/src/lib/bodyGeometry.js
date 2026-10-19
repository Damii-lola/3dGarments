/**
 * Pure geometry for the body scan: landmarks + frame scale -> measurements.
 *
 * Nothing here calls a model or the network, so it can be unit-tested exactly.
 * See scripts/geometry-check.mjs for worked examples.
 *
 * Units: landmarks are normalised to the image (x by width, y by height).
 * A "span" is always expressed in IMAGE WIDTHS, so a horizontal distance is
 * |x1-x2| and a vertical one is |y1-y2| / aspect (aspect = width / height).
 */

export const CM_PER_IN = 2.54;

/** Documented population constants — the only assumptions, and all about scale. */
export const HEAD_HEIGHT_CM = { male: 23.5, female: 22.5, unsure: 23.0 };
/**
 * Adult stature runs 7.46 of its own head-heights in ANSUR II men and 7.50 in the
 * women, with a spread either side of that, so a frame reading outside 7.1-7.9 has
 * a mis-placed head landmark (usually a chin set too high). Rather than throw the
 * frame away we nudge the scale to the edge of the range, bounded, because the
 * head is what every other number is scaled by.
 */
export const HEAD_UNITS_RANGE = [7.1, 7.9];
export const HEAD_UNIT_CORRECTION_LIMIT = 0.08;
/**
 * Depth as a fraction of width for a cross-section, used only when no side view
 * exists. A torso is wider than it is deep; a head is the other way round.
 *
 * Every torso figure here is the median depth/width of that part in ANSUR II
 * (4,082 men, 1,986 women, caliper widths and depths taken on the same people):
 * a male chest is 0.88 as deep as it is wide, a male waist 0.72, hips 0.71, a
 * female bust 0.92. The old numbers were guesses, and the chest guess (0.72)
 * was a fifth too shallow, which shortened the tape around every chest.
 *
 * The head is not guessed either: ANSUR recorded a head breadth and a head tape
 * on the same people, and the depth/width that reproduces the tape is 1.36 for
 * a man and 1.40 for a woman — so 1.38, where this used to say 1.30, which read
 * every head 2.5-4.4% small.
 *
 * The limbs are the survey's other lesson: on the one limb ANSUR measured both
 * ways (the ankle, 7.5 cm across and 22.9 cm round), pi x width is the tape to
 * within 2.5%, so a limb is treated as round and the width carries it.
 */
export const DEPTH_RATIO = {
  head: 1.38, neck: 0.92, upperChest: 0.88, chest: 0.88, underbust: 0.80,
  waist: 0.72, lowWaist: 0.72, hips: 0.71,
  arm: 0.95, elbow: 0.95, wrist: 0.88,
  knee: 0.95, calf: 0.95, ankle: 0.95,
};

/**
 * The depth/width ratio a torso part is entitled to, per group — because a
 * man's hip and a woman's hip are not the same cross-section.
 *
 * Fit through the origin (depth = ratio x width, least squares) on ANSUR II's
 * paired caliper measurements, so it is the survey's own relationship rather
 * than one number borrowed across groups. It caught a real bias: this file used
 * to put a man's hip ratio (0.71) on a woman's hips, and women are measurably
 * wider than deep there — 0.658. Every female hip tape read 2.2% long.
 *
 * `DEPTH_RATIO` above stays the fallback for parts ANSUR did not take as a
 * pair (head, neck, underbust, lower waist, every limb).
 */
export const DEPTH_RATIO_BY_GENDER = {
  chest: { male: 0.876801, female: 0.918847, unsure: 0.889270 },
  waist: { male: 0.729938, female: 0.711381, unsure: 0.724533 },
  lowWaist: { male: 0.729938, female: 0.711381, unsure: 0.724533 },
  hips: { male: 0.711748, female: 0.658316, unsure: 0.693702 },
  // The deltoid line is far wider than the torso is deep (bideltoid against the
  // chest depth in the survey), and that ratio is what a turned shoulder span
  // has to be undone with.
  shoulder: { male: 0.497800, female: 0.550100, unsure: 0.514000 },
};

/** The prior depth as a fraction of the front width, for one part and group. */
export function depthRatio(ratioKey, gender) {
  const row = DEPTH_RATIO_BY_GENDER[ratioKey];
  if (row) return row[gender] ?? row.unsure;
  return DEPTH_RATIO[ratioKey];
}

/**
 * Every region a landmark pair can span. Each is measured the same way — the
 * horizontal separation of the pair, in the frame's own scale — and only the
 * pair's meaning differs. `girth: true` means the pair describes a closed
 * cross-section whose perimeter can be computed from a width and a depth.
 */
export const REGIONS = {
  head: { left: 'headL', right: 'headR', label: 'Head', girth: true, ratio: 'head' },
  neck: { left: 'neckL', right: 'neckR', label: 'Neck', girth: true, ratio: 'neck' },
  shoulder: { left: 'shoulderL', right: 'shoulderR', label: 'Shoulder', girth: false, ratio: 'shoulder' },
  upperChest: { left: 'upperChestL', right: 'upperChestR', label: 'Chest', girth: true, ratio: 'upperChest' },
  chest: { left: 'armpitL', right: 'armpitR', label: 'Chest / bust', girth: true, ratio: 'chest' },
  underbust: { left: 'underbustL', right: 'underbustR', label: 'Underbust', girth: true, ratio: 'underbust' },
  waist: { left: 'waistL', right: 'waistR', label: 'Waist', girth: true, ratio: 'waist' },
  lowWaist: { left: 'lowWaistL', right: 'lowWaistR', label: 'Lower waist', girth: true, ratio: 'lowWaist' },
  hips: { left: 'hipL', right: 'hipR', label: 'Hips', girth: true, ratio: 'hips' },
  arm: { left: 'armL', right: 'armR', label: 'Upper arm', girth: true, ratio: 'arm' },
  elbow: { left: 'elbowL', right: 'elbowR', label: 'Elbow', girth: true, ratio: 'elbow' },
  wrist: { left: 'wristL', right: 'wristR', label: 'Wrist', girth: true, ratio: 'wrist' },
  knee: { left: 'kneeL', right: 'kneeR', label: 'Knee', girth: true, ratio: 'knee' },
  calf: { left: 'calfL', right: 'calfR', label: 'Calf', girth: true, ratio: 'calf' },
  highAnkle: { left: 'highAnkleL', right: 'highAnkleR', label: 'High ankle', girth: true, ratio: 'ankle' },
  ankle: { left: 'ankleL', right: 'ankleR', label: 'Ankle', girth: true, ratio: 'ankle' },
  // The garment across the leg at the ankle: a flat width, not a girth, and only
  // a real reading when it is wider than a bare ankle could be. A trouser leg is
  // a tube, so its silhouette width barely changes with the turn.
  hem: { left: 'ankleL', right: 'ankleR', label: 'Leg opening', girth: false, ratio: 'ankle' },
};
/** The girths a size cannot be worked out without. */
export const GIRTH_REGIONS = ['chest', 'waist', 'hips'];
export const VIEW_WEIGHT = { front: 1.0, back: 0.95, 'three-quarter': 0.55, side: 1.0 };

/**
 * Plausible adult BREADTH (front/back view) and DEPTH (side view) in cm for each
 * region — a span, not a circumference. Anything outside these is a mis-placed
 * landmark, not an unusual person, and gets dropped before it can become a
 * confident wrong number.
 *
 * The width ceilings are deliberately generous: a heavily built man really does
 * reach a 50 cm chest breadth and a 58 cm shoulder span, and dropping those as
 * "impossible" is worse than keeping them. What they still catch is the common
 * failure — the arms hanging against the torso and being measured as part of it,
 * which reads 60-70 cm across.
 */
export const SPAN_RANGES_CM = {
  shoulder: { width: [32, 58], depth: [26, 54] },
  head: { width: [12, 21], depth: [15, 26] },
  neck: { width: [8, 17], depth: [7, 17] },
  upperChest: { width: [22, 50], depth: [15, 36] },
  chest: { width: [22, 50], depth: [15, 36] },
  underbust: { width: [19, 48], depth: [13, 38] },
  waist: { width: [20, 52], depth: [13, 40] },
  lowWaist: { width: [20, 52], depth: [13, 40] },
  hips: { width: [24, 56], depth: [16, 42] },
  arm: { width: [6, 18], depth: [5, 18] },
  elbow: { width: [5, 14], depth: [4, 14] },
  wrist: { width: [3.5, 10], depth: [3, 10] },
  knee: { width: [8, 21], depth: [7, 20] },
  calf: { width: [7, 21], depth: [6, 20] },
  highAnkle: { width: [5, 15], depth: [4, 14] },
  ankle: { width: [5, 15], depth: [4, 14] },
  // A trouser leg opening is 9-34 cm across; a bare ankle is ~6.5 and cannot be
  // mistaken for one, because it simply fails this range.
  hem: { width: [9, 34], depth: [9, 32] },
};

/**
 * A torso row can never be this fraction of the shoulder span, whatever the
 * build. This is the strongest evidence ANSUR II gives about the shape of a
 * body: across 4,082 men the WIDEST chest breadth is 0.668 of the bideltoid
 * (median 0.567), the widest waist 0.807 and the widest hip 0.813; across 1,986
 * women the widest chest is 0.695 and the widest hip 0.961.
 *
 * It exists because the absolute ranges above cannot catch the real failure.
 * When the arms hang against the ribcage the segmentation reads one run from
 * hand to hand, and a "chest" 45 cm across on a 48 cm shoulder passes a 50 cm
 * ceiling happily — then a tape round that row reads 65 in. Against the shoulder
 * span, in a frame's own scale, the same row is obviously the shoulders.
 *
 * Front/back/three-quarter only: side-on, every one of these pairs reads the
 * body's DEPTH, and a chest is nearly as deep as a shoulder is.
 */
export const TORSO_SPAN_LIMIT = {
  male: { upperChest: 0.72, chest: 0.72, underbust: 0.72, waist: 0.86, lowWaist: 0.86, hips: 0.87 },
  female: { upperChest: 0.74, chest: 0.74, underbust: 0.74, waist: 0.97, lowWaist: 0.97, hips: 1.0 },
};

export const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
export const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
export const round3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
export const toIn = (cm) => cm / CM_PER_IN;
export const degToRad = (d) => (d * Math.PI) / 180;

/**
 * Perimeter of an ellipse with semi-axes a and b, in the same unit.
 * Ramanujan's second approximation — error under 0.01% for body-like ratios.
 */
export function ellipsePerimeter(a, b) {
  if (!(a > 0) || !(b > 0)) return null;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * A tape measure is not an ellipse, and treating it as one is the single largest
 * error in a silhouette measurement.
 *
 * ANSUR II took both from the same 4,082 men and 1,986 women: a caliper width
 * and depth across a chest, and the tape that went round it. The tape always
 * comes out longer — by a lot where the cross-section is a flattened box (a
 * chest) and barely at all where it is genuinely round (a limb). The numbers
 * below are the median ratios of tape circumference to ellipse perimeter in that
 * survey, so they are measured, not tuned.
 *
 * What they fix: an average 28.9 x 25.4 cm male chest is 105.9 cm round, where
 * the ellipse says 84.6. That 21 cm gap is most of a size, and every chest the
 * app measured was short by it.
 */
export const GIRTH_SHAPE = {
  upperChest: { male: 1.237, female: 1.164, unsure: 1.201 },
  chest: { male: 1.237, female: 1.164, unsure: 1.201 },
  underbust: { male: 1.146, female: 1.113, unsure: 1.130 },
  waist: { male: 1.054, female: 1.061, unsure: 1.058 },
  lowWaist: { male: 1.072, female: 1.079, unsure: 1.076 },
  hips: { male: 1.089, female: 1.097, unsure: 1.093 },
};

/**
 * How much longer a tape is than the ellipse for one cross-section. This is now
 * the FALLBACK: the torso parts ANSUR measured as a pair (chest, waist hips) are
 * read by TAPE_MODEL below. What is left here are the parts the survey has no
 * paired width and depth for — the upper chest, the underbust, the lower waist —
 * plus the neck and every limb, where a round cross-section is the survey's own
 * answer (the one limb it measured both ways, the ankle, tapes as pi x width).
 */
export function shapeFactor(ratioKey, gender) {
  const row = GIRTH_SHAPE[ratioKey];
  if (!row) return 1;
  return row[gender] ?? row.unsure;
}

/**
 * A tape round a torso, straight from the survey: fitted on ANSUR II's own paired
 * caliper widths, depths and tapes for 4,082 men and 1,986 women, as
 *
 *     tape = A x (width + depth) + B x |width - depth|
 *
 * That is a real regression rather than a shape guessed by eye, and it keeps the
 * two things the bare ellipse could not: a tape is not an ellipse (A is close to
 * pi/2 for a round part and pulls up for a flattened box), and cornering adds
 * length to a flattened box but not to a round one (the |width - depth| term,
 * which is B = 0 for a round part and large for a chest).
 *
 * Checked against every subject, not just the means: on the chest it reproduces
 * the tape to 1.83% mean absolute error (p90 3.77%, 96.8% within 5%) where the
 * fixed ellipse factor gave 2.03% / 4.18% / 94.8%, and it lands on the survey's
 * published means to under 0.1%. Depth priors are fitted the same way.
 */
export const TAPE_MODEL = {
  chest: {
    male: { a: 1.982661, b: -0.501387 },
    female: { a: 1.855392, b: -0.479857 },
    unsure: { a: 1.922900, b: -0.150748 },
  },
  waist: {
    male: { a: 1.660296, b: 0.042024 },
    female: { a: 1.633487, b: 0.261393 },
    unsure: { a: 1.649506, b: 0.128006 },
  },
  hips: {
    male: { a: 1.657876, b: 0.385165 },
    female: { a: 1.653656, b: 0.417851 },
    unsure: { a: 1.654630, b: 0.407715 },
  },
};

/**
 * The head has no paired depth in ANSUR — only a breadth and a tape — so it gets
 * the survey's one-parameter breadth-to-tape relationship instead of a modelled
 * depth: tape = 3.719 x breadth for a man, 3.795 for a woman. It beats the old
 * modelled depth (2.42% vs 2.56% mean absolute error) and removes its bias.
 */
export const HEAD_TAPE_MODEL = { male: 3.719000, female: 3.794872, unsure: 3.742402 };

/** Which arithmetic a part's tape uses, so the working can be worded honestly. */
export function tapeShape(ratioKey) {
  if (ratioKey === 'head') return 'head';
  return TAPE_MODEL[ratioKey] ? 'fitted' : 'ellipse';
}

/** The tape circumference that a width and a depth describe, ANSUR II's way. */
export function tapeGirth(widthCm, depthCm, ratioKey, gender) {
  if (!(widthCm > 0)) return null;
  if (ratioKey === 'head') {
    const A = HEAD_TAPE_MODEL[gender] ?? HEAD_TAPE_MODEL.unsure;
    return A * widthCm;
  }
  const model = TAPE_MODEL[ratioKey];
  if (model && Number.isFinite(depthCm)) {
    const m = model[gender] ?? model.unsure;
    return m.a * (widthCm + depthCm) + m.b * Math.abs(widthCm - depthCm);
  }
  const e = ellipsePerimeter(widthCm / 2, depthCm / 2);
  if (e == null) return null;
  return e * shapeFactor(ratioKey, gender);
}

export function normView(v) {
  const s = String(v || '').toLowerCase();
  if (s.includes('3/4') || s.includes('three')) return 'three-quarter';
  if (s.includes('side') || s.includes('profile')) return 'side';
  if (s.includes('back') || s.includes('rear')) return 'back';
  return 'front';
}

/**
 * How far the body is turned away from the camera, in degrees: 0 is square on to
 * the lens, 90 is a full profile. The device measures it from the shoulder line
 * in three dimensions; a frame that does not carry it falls back to its view
 * name, and anything outside 0-90 is clamped.
 *
 * This is what stops a three-quarter frame being read as a width. Turned 45
 * degrees, a cross-section projects to sqrt(w^2 cos^2 + d^2 sin^2) — neither the
 * width nor the depth but a blend of the two, up to a quarter wider than the
 * body. Reading that blend as "width" is what inflated a chest.
 */
export function frameTurn(frame) {
  const t = Number(frame?.turn);
  if (Number.isFinite(t)) return clamp(t, [0, 90]);
  switch (frame?.view) {
    case 'side': return 90;
    case 'three-quarter': return 45;
    default: return 0;
  }
}

/** The width a turned frame's span implies, given the depth/width ratio. */
export function unproject(spanCm, turnDeg, ratio) {
  const t = degToRad(turnDeg);
  const f = Math.hypot(Math.cos(t), (ratio || 0.8) * Math.sin(t));
  return f > 0.05 ? spanCm / f : spanCm / 0.05;
}

export function normGender(g) {
  const s = String(g || '').toLowerCase();
  if (s.startsWith('m')) return 'male';
  if (s.startsWith('f') || s.startsWith('w')) return 'female';
  return 'unsure';
}

/**
 * Models sometimes answer in pixels instead of 0-1, or as [x, y]. Coerce to
 * safe normalised {x, y} and drop anything that lands off the image.
 */
export function normalizeLandmarks(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const entries = Object.entries(raw)
    .map(([k, v]) => {
      if (Array.isArray(v)) return [k, { x: Number(v[0]), y: Number(v[1]) }];
      if (v && typeof v === 'object') return [k, { x: Number(v.x), y: Number(v.y) }];
      return [k, null];
    })
    .filter(([, v]) => v && Number.isFinite(v.x) && Number.isFinite(v.y));

  const max = entries.reduce((m, [, v]) => Math.max(m, Math.abs(v.x), Math.abs(v.y)), 0);
  const divisor = max > 150 ? 1000 : max > 1.5 ? 100 : 1;

  const out = {};
  for (const [k, v] of entries) {
    const x = v.x / divisor;
    const y = v.y / divisor;
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) continue; // off-frame
    out[k] = { x: clamp(x, [0, 1]), y: clamp(y, [0, 1]) };
  }
  return out;
}

export function point(frame, name) {
  const p = frame.landmarks?.[name];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

/**
 * One joint, under either naming scheme in use. The pose model reports joints
 * as shoulderJL; the vision model is asked for shoulderL, the same point in
 * plain words. Asking for both means a measure is not silently blank because
 * the frame came from the other side of the app.
 */
export function joint(frame, name, side) {
  return point(frame, `${name}J${side}`)
    || point(frame, `${name}${side}`)
    || point(frame, `${name}J`)
    || point(frame, name);
}

/** Horizontal separation of two landmarks, in image widths. */
export function spanX(frame, a, b) {
  const p = point(frame, a);
  const q = point(frame, b);
  return p && q ? Math.abs(q.x - p.x) : null;
}

/** Vertical separation of two landmarks, in image widths (y is normalised by height). */
export function spanY(frame, yA, yB) {
  if (!Number.isFinite(yA) || !Number.isFinite(yB)) return null;
  return Math.abs(yB - yA) / frame.aspect;
}

/** Mean y of up to two landmarks, or null. */
export function meanY(frame, a, b) {
  const p = point(frame, a);
  const q = point(frame, b);
  if (p && q) return (p.y + q.y) / 2;
  return p ? p.y : q ? q.y : null;
}

/** How much to trust one frame, from its own reported sharpness/lighting/confidence. */
export function frameQuality(frame) {
  const sharp = clamp(Number(frame.camera?.sharpness) || 0.6, [0.05, 1]);
  const light = clamp(Number(frame.camera?.lighting) || 0.6, [0.05, 1]);
  const conf = clamp(Number(frame.confidence) || 0.5, [0.05, 1]);
  return (0.35 + 0.65 * sharp * light) * (0.45 + 0.55 * conf);
}

/** Mean y of two landmarks that should sit at the same height, or null. */
function pairY(frame, a, b) {
  const p = point(frame, a);
  const q = point(frame, b);
  if (p && q) return (p.y + q.y) / 2;
  return p ? p.y : q ? q.y : null;
}

/**
 * Centimetres per image-width for one frame, anchored on things of known size.
 * The subject's own head is the primary ruler; a reference object refines (or
 * replaces) it. Anchors combine as a weighted geometric mean, so one wild
 * reference cannot drag the scale out of range.
 *
 * A small head means a large relative error on every landmark, so a tiny head
 * carries proportionally less weight.
 */
export function frameScale(frame) {
  const anchors = [];
  let reliability = 0;
  let headUnitsCorrection = 1;

  const headSpan = spanY(frame, point(frame, 'headTop')?.y, point(frame, 'chin')?.y);
  if (headSpan && headSpan > 0.02 && frame.visible?.head !== false) {
    const headCm = HEAD_HEIGHT_CM[frame.gender] || HEAD_HEIGHT_CM.unsure;

    // If the whole body is in shot, the head can be checked against adult
    // proportions. A ratio INSIDE the adult band is a head that was placed
    // correctly, so the head stays the ruler and nothing is changed; only a ratio
    // outside the band is evidence that the head itself was mis-placed, and then
    // the scale moves to the nearest edge of the band and no further.
    //
    // This used to pull every full-body frame toward the middle of the band, which
    // made the whole body the ruler and the head a decoration. Projecting 80 real
    // ANSUR II bodies into camera geometry showed what that costs: putting the feet
    // in shot roughly doubled the error on every row for both sexes (a man's chest
    // 1.84% -> 3.52% mean absolute error, p90 3.9% -> 8.0%) and gave every woman a
    // +3% bias, because "7.5 head-heights" is a man's ratio and a whole-body ruler
    // cannot report anyone whose height is not the one it assumes. It also meant
    // the height it printed was that assumption rather than a measurement.
    const statureSpan = spanY(frame, point(frame, 'headTop')?.y, meanY(frame, 'footL', 'footR'));
    if (statureSpan && statureSpan > headSpan * 5) {
      const units = statureSpan / headSpan;
      const adult = clamp(units, HEAD_UNITS_RANGE);
      headUnitsCorrection = clamp(units / adult, [1 - HEAD_UNIT_CORRECTION_LIMIT, 1 + HEAD_UNIT_CORRECTION_LIMIT]);
    }
    const effectiveSpan = headSpan * headUnitsCorrection;

    // 0.12 image widths of head is comfortable; below that, trust it less.
    const headTrust = clamp(headSpan / 0.12, [0.25, 1]);
    anchors.push({
      what: 'head length',
      cmPerWidth: headCm / effectiveSpan,
      weight: 1.0 * headTrust,
      detail: `${round1(headCm)} cm head`,
    });
    reliability = Math.max(reliability, headTrust);
  }

  for (const r of frame.references || []) {
    const a = r?.a;
    const b = r?.b;
    const knownCm = Number(r?.knownCm);
    const refTrust = Number.isFinite(Number(r?.reliability)) ? clamp(Number(r.reliability), [0, 1]) : 0.5;
    if (!a || !b || !Number.isFinite(Number(a.x)) || !Number.isFinite(Number(b.x))) continue;
    const dx = Math.abs(Number(b.x) - Number(a.x));
    const dy = Math.abs(Number(b.y) - Number(a.y)) / frame.aspect;
    const span = Math.hypot(dx, dy);
    if (!(span > 0.02) || !(knownCm >= 5 && knownCm <= 400) || refTrust < 0.4) continue;
    anchors.push({
      what: String(r.what || 'reference object'),
      cmPerWidth: knownCm / span,
      weight: refTrust * 1.6,
      detail: `${String(r.what || 'object')} (${knownCm} cm)`,
    });
    reliability = Math.max(reliability, refTrust);
  }

  if (!anchors.length) return null;
  const wsum = anchors.reduce((s, x) => s + x.weight, 0);
  const cmPerWidth = Math.exp(anchors.reduce((s, x) => s + x.weight * Math.log(x.cmPerWidth), 0) / wsum);
  return { cmPerWidth, anchors, reliability, headUnitsCorrection: round2(headUnitsCorrection) };
}

/** The chain of landmarks that must run top-to-bottom down the body. */
const CORE_CHAIN = ['headTop', 'chin', 'neck', 'shoulder', 'armpit', 'waist', 'hip'];

/**
 * Decide whether a frame's landmarks are anatomically possible.
 *
 * Two tests, both cheap and both about stopping bad frames rather than
 * explaining them away:
 *   1. Landmarks must run down the body in order. A chin below the shoulders is
 *      not a person, it is a mis-placed point, and everything from that frame is
 *      suspect.
 *   2. Once scaled, each region's span must be a human breadth/depth. A chest
 *      60 cm across is not a big man, it is the arms being included by mistake.
 *
 * Returns the regions to ignore for this frame, plus whether the whole frame is
 * unusable. Never throws and never repairs — it only rejects.
 */
export function checkFrame(frame) {
  const bad = new Set();
  const notes = [];

  const chain = [
    ['headTop', point(frame, 'headTop')?.y],
    ['chin', point(frame, 'chin')?.y],
    ['neck', pairY(frame, 'neckL', 'neckR')],
    ['shoulder', pairY(frame, 'shoulderL', 'shoulderR')],
    ['armpit', pairY(frame, 'armpitL', 'armpitR')],
    ['waist', pairY(frame, 'waistL', 'waistR')],
    ['hip', pairY(frame, 'hipL', 'hipR')],
    ['crotch', point(frame, 'crotch')?.y],
    ['foot', meanY(frame, 'footL', 'footR')],
  ].filter(([, y]) => Number.isFinite(y));

  let heightBad = false;
  for (let i = 1; i < chain.length; i += 1) {
    const [name, y] = chain[i];
    const [prevName, prevY] = chain[i - 1];
    if (y >= prevY - 0.04) continue;
    const bothCore = CORE_CHAIN.includes(name) && CORE_CHAIN.includes(prevName);
    if (bothCore) {
      return { bad, fatal: true, heightBad: true, notes: [`${name} sits above ${prevName}`] };
    }
    heightBad = true; // crotch/foot out of place: keep the girths, forget the height
    notes.push(`${name} above ${prevName}`);
  }

  const turn = frameTurn(frame);
  for (const key of Object.keys(REGIONS)) {
    const spec = REGIONS[key];
    // A breadth-only region read from a profile is the body's DEPTH, and there
    // is no depth range to judge it against — so it is not a bad reading, it is
    // simply not a reading. Skipping it here keeps it out of the note that
    // explains discarded spans.
    if (!spec.girth && turn >= 70) continue;
    const span = spanX(frame, spec.left, spec.right);
    if (span == null || span <= 0 || !frame.scale) continue;
    const cm = span * frame.scale.cmPerWidth;
    // Turned, the span is a blend of the width and the depth, so it has to be
    // judged against both bands at once.
    const range = SPAN_RANGES_CM[key];
    const [lo, hi] = turn <= 20 ? range.width
      : turn >= 70 ? range.depth
        : [Math.min(range.width[0], range.depth[0]), Math.max(range.width[1], range.depth[1])];
    if (cm < lo || cm > hi) {
      bad.add(key);
      notes.push(`${key} spans ${Math.round(cm)} cm`);
    }
  }

  // The same failure, caught relationally: a torso row wider than this fraction
  // of the shoulder span is the arms, not the torso. Both spans are undone with
  // this frame's own turn, so it holds at three-quarter too, and at square-on it
  // is exactly the span comparison it always was.
  if (turn <= 70 && frame.scale) {
    const shoulderSpan = spanX(frame, REGIONS.shoulder.left, REGIONS.shoulder.right);
    const shoulderCm = shoulderSpan == null ? 0
      : unproject(shoulderSpan * frame.scale.cmPerWidth, turn, depthRatio('shoulder', frame.gender));
    if (shoulderCm > 0) {
      const limits = TORSO_SPAN_LIMIT[frame.gender === 'male' ? 'male' : 'female'];
      for (const [key, frac] of Object.entries(limits)) {
        const spec = REGIONS[key];
        const span = spanX(frame, spec.left, spec.right);
        if (span == null || span <= 0) continue;
        const cm = unproject(span * frame.scale.cmPerWidth, turn, depthRatio(key, frame.gender));
        if (cm > shoulderCm * frac) {
          bad.add(key);
          notes.push(`${key} spans ${Math.round(cm)} cm of a ${Math.round(shoulderCm)} cm shoulder — that is the arms`);
        }
      }
    }
  }

  return { bad, fatal: false, heightBad, notes };
}

/**
 * Weighted mean of {value, weight} samples, with a WEIGHTED-MEDIAN outlier cut.
 * Using the weighted median (rather than the plain middle element) matters:
 * with two samples a plain median is the larger one, so a single wild frame
 * would survive and drag the whole result with it.
 */
export function robustMean(samples) {
  const use = samples.filter((s) => Number.isFinite(s.value) && s.weight > 0);
  if (!use.length) return null;

  const sorted = [...use].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  let median = sorted[sorted.length - 1].value;
  for (const s of sorted) {
    acc += s.weight;
    if (acc >= totalWeight / 2) { median = s.value; break; }
  }

  const tol = Math.max(Math.abs(median) * 0.12, 0.6); // 12% or 6 mm
  let near = sorted.filter((s) => Math.abs(s.value - median) <= tol);
  if (!near.length) {
    // Nothing agrees with the median: keep the single closest sample rather
    // than averaging in the disagreement.
    near = [sorted.reduce((best, s) => (Math.abs(s.value - median) < Math.abs(best.value - median) ? s : best), sorted[0])];
  }

  const w = near.reduce((s, x) => s + x.weight, 0);
  const values = near.map((x) => x.value);
  return {
    value: near.reduce((s, x) => s + x.value * x.weight, 0) / w,
    n: near.length,
    spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
  };
}

/**
 * Standing height, head to floor, only from frames where the feet were really
 * in shot. Returns null when they never were — a gap beats an invention.
 *
 * The frame's ruler has to be one the rest of the clip agrees with, exactly as a
 * depth does. Height is the one row that needs the floor, so it is usually the
 * work of a single frame — and the frame that shows the floor is the frame with
 * the most body in it to mis-place. A real 16-frame turning clip had one such
 * frame, its head read a third of the others, and the only height in the clip
 * came out at the top of the allowed range. Half a centimetre of span on a ruler
 * that is 2.6x the clip's is not a height.
 */
export function measureHeight(frames) {
  const trusted = trustedRulers(frames);
  const samples = [];
  for (const f of frames) {
    if (!f.scale || f.heightBad) continue;
    if (!trusted.has(f)) continue;
    const top = point(f, 'headTop');
    const floorY = meanY(f, 'footL', 'footR');
    if (!top || floorY == null) continue;
    if (f.visible?.head === false || f.visible?.feet === false) continue;
    const span = spanY(f, top.y, floorY);
    if (!(span > 0.2)) continue;
    samples.push({ value: toIn(span * f.scale.cmPerWidth), weight: frameQuality(f) });
  }
  const h = robustMean(samples);
  return h ? { in: h.value, views: h.n, spread: h.spread } : null;
}

/** Were the landmarks for this region ever placed in any frame? */
export function sawRegion(frames, key) {
  const spec = REGIONS[key];
  return frames.some((f) => spanX(f, spec.left, spec.right) != null);
}

/**
 * Which frames' scales can be believed.
 *
 * Every frame is scaled by the head, because the head is the one thing in shot of
 * a known size — which also makes it the first thing to be mis-placed when the
 * body turns or the light drops. Nobody's head changes size during one take, so
 * two frames of the same clip should agree on it within a few per cent; a scale
 * that no other frame in the clip can corroborate is not a measurement of the
 * head, it is a mis-detected head. Frames are compared pairwise, not against a
 * clip-wide average, so a clip where the camera really does drift closer or
 * further still works: each frame has a neighbour a step away from it.
 *
 * This is not cosmetic. A real clip measured here had one three-quarter frame
 * whose head read a third short, which put every span in it a third long: its
 * single reading said the knee was 18 cm deep, and the tape came out 19.8 in
 * around a knee that is 14. So a frame whose ruler nothing else agrees with may
 * not supply a depth. Its widths still count, where a dozen frames average out.
 */
export const RULER_AGREEMENT = 0.15;

export function trustedRulers(frames) {
  const trusted = new Set();
  const scaled = frames.filter((f) => f.scale && f.scale.cmPerWidth > 0);
  // One frame has nothing to be checked against, so the guard cannot speak: a
  // lone frame is taken at its word.
  if (scaled.length < 2) return new Set(scaled);
  for (const f of scaled) {
    const a = f.scale.cmPerWidth;
    if (scaled.some((g) => g !== f && Math.abs(a / g.scale.cmPerWidth - 1) <= RULER_AGREEMENT)) trusted.add(f);
  }
  return trusted;
}

/**
 * Measure one region across every frame.
 *
 * Every frame shows a projection of the same cross-section, and how much of the
 * WIDTH and how much of the DEPTH it shows depends on how far the body was turned
 * in that frame: square on it is the width, in profile it is the depth, and at
 * three-quarter it is sqrt(w^2 cos^2 + d^2 sin^2) — a blend that reads up to a
 * quarter wider than the body if it is taken for a width. So each frame's span is
 * UNPROJECTED back to a width using that frame's own turn angle, and the frames
 * turned far enough to show depth give the depth. Two or three passes, because
 * the unprojection needs the depth/width ratio and the ratio needs the widths.
 *
 * The pay-off is a clip with no clean profile: three-quarter frames used to be
 * averaged in as widths (inflating the chest) and gave no depth at all; now they
 * are undone instead, and they carry the depth themselves.
 *
 * When nothing was turned far enough to show depth, the survey's own ratio for
 * that part and group stands in, and the reading says so.
 *
 * `opts.views` restricts which frames count — "across the back" and "from the
 * front" are the same line seen twice, and a tailor asking for X-Back wants the
 * reading from the back, not whichever frame happened to be clearest.
 */
export function measureRegion(key, frames, opts = {}) {
  const spec = REGIONS[key];
  const views = opts.views || null;
  const gender = opts.gender ?? frames.find((f) => f.gender)?.gender ?? 'unsure';
  const prior = opts.depthRatio ?? depthRatio(spec.ratio, gender) ?? 0.8;

  const samples = [];
  const viewsUsed = new Set();
  const trusted = trustedRulers(frames);
  let skipped = 0;
  for (const f of frames) {
    if (!f.scale) continue;
    if (views && !views.includes(f.view)) continue;
    if (f.bad?.has(key)) { skipped += 1; continue; } // failed the sanity check
    const span = spanX(f, spec.left, spec.right);
    if (span == null || span < 0.005) continue; // landmark pair never placed
    samples.push({
      cm: span * f.scale.cmPerWidth,
      turn: frameTurn(f),
      weight: frameQuality(f) * (VIEW_WEIGHT[f.view] ?? 0.6),
      rulerTrusted: trusted.has(f),
    });
    viewsUsed.add(f.view);
  }
  if (!samples.length) return null;

  // How much depth a frame can show depends on how far it was turned, and a
  // shallow turn is badly conditioned: an error in the span arrives in the depth
  // divided by sin(turn), so a frame turned 25 degrees can invent a neck deeper
  // than it is wide. 20 degrees is the floor, and sin^4 of the turn is the
  // weight — a real profile carries the depth, a three-quarter frame helps.
  const depthSamples = samples
    .map((s) => ({ ...s, sin: Math.sin(degToRad(s.turn)) }))
    .filter((s) => s.sin >= 0.34 && s.rulerTrusted);
  const band = SPAN_RANGES_CM[key] || null;

  let k = prior;
  let w = null;
  let d = null;
  for (let pass = 0; pass < 3; pass += 1) {
    w = robustMean(samples.map((s) => ({ value: unproject(s.cm, s.turn, k), weight: s.weight })));
    if (!w) return null;
    d = robustMean(depthSamples
      .map((s) => {
        const flat = s.cm * s.cm - (w.value * Math.cos(degToRad(s.turn))) ** 2;
        if (!(flat > 0)) return null;
        const value = Math.sqrt(flat) / s.sin;
        // A depth outside the band a human body lives in is not a reading.
        if (band && (value < band.depth[0] || value > band.depth[1])) return null;
        return { value, weight: s.weight * s.sin ** 4 };
      })
      .filter(Boolean));
    if (!d || !(d.value > 0)) { d = null; break; }
    k = d.value / w.value;
  }

  // A head is taped from its breadth by the survey's own one-parameter model, so
  // no depth goes into it; say that rather than imply one did.
  const headOnly = tapeShape(spec.ratio) === 'head';
  const depthCm = headOnly ? null : (spec.girth ? (d ? d.value : w.value * prior) : null);
  const depthSource = headOnly
    ? 'breadth only, the survey\'s head tape'
    : spec.girth
      ? (d ? `side view x${d.n}` : `${round3(prior)}x width, modelled`)
      : null;

  const valueCm = spec.girth ? tapeGirth(w.value, depthCm, spec.ratio, gender) : w.value;
  if (!Number.isFinite(valueCm)) return null;

  const agreement = 1 - Math.min(1, w.spread / Math.max(2, w.value * 0.15));
  const confidence = clamp(0.3 + 0.4 * agreement + 0.15 * Math.min(1, w.n / 3) + (d ? 0.12 : 0), [0.05, 0.95]);

  return {
    key,
    label: spec.label,
    girth: !!spec.girth,
    valueIn: toIn(valueCm),
    widthIn: toIn(w.value),
    depthIn: depthCm == null ? null : toIn(depthCm),
    depthSource,
    depthMeasured: !!d,
    widthViews: w.n,
    depthViews: d?.n || 0,
    skipped,
    views: [...viewsUsed],
    spread: w.spread,
    confidence: round2(confidence),
  };
}

/**
 * The y of a body row, whichever way the landmarks name it: a pair (waistL/R,
 * footL/R) averages, a single point (headTop, crotch) stands alone. One helper,
 * so a measurement below can name its rows the way a tailor does.
 */
export function rowOf(frame, name) {
  const single = point(frame, name);
  if (single) return single.y;
  return meanY(frame, `${name}L`, `${name}R`);
}

/** Rows whose position depends on the floor or the seat being real. */
const FLOOR_ROWS = new Set(['crotch', 'foot']);

/**
 * A distance DOWN the body between two rows, in inches.
 *
 * The frame's scale is centimetres per image WIDTH, so a vertical distance in
 * normalised y has to be divided by the aspect ratio to reach the same unit —
 * which is what spanY does. Every sample must also land inside the item's
 * plausible range: a camera looking up at the subject foreshortens every
 * vertical, and a foreshortened torso length is not a torso length.
 */
export function measureVertical(frames, spec) {
  const { from, to, views = null, range = null } = spec;
  const needsFloor = FLOOR_ROWS.has(from) || FLOOR_ROWS.has(to);
  const samples = [];
  for (const f of frames) {
    if (!f.scale) continue;
    if (needsFloor && f.heightBad) continue;
    if (views && !views.includes(f.view)) continue;
    const a = rowOf(f, from);
    const b = rowOf(f, to);
    if (a == null || b == null) continue;
    const span = spanY(f, a, b);
    if (!(span > 0.005)) continue;
    const inches = toIn(span * f.scale.cmPerWidth);
    if (range && (inches < range[0] || inches > range[1])) continue;
    samples.push({ value: inches, weight: frameQuality(f) });
  }
  const m = robustMean(samples);
  return m ? { in: m.value, n: m.n, spread: m.spread } : null;
}

/**
 * The length of a path through joint landmarks — the arm, for a sleeve length.
 * Each segment is measured in the frame plane and converted with that frame's
 * scale. Side-on frames are excluded by the caller: an arm pointing at the lens
 * is foreshortened into nothing.
 */
export function measurePath(frames, spec) {
  const {
    points, views = ['front', 'back', 'three-quarter'], range = null, sides = ['L', 'R'],
    // Past 60 degrees the horizontal part of a limb is less than half of what it
    // really is, and the arm has usually swung in front of the torso: too little
    // left to undo honestly.
    maxTurn = 60,
  } = spec;
  const samples = [];
  for (const f of frames) {
    if (!f.scale) continue;
    if (views && !views.includes(f.view)) continue;
    const turn = frameTurn(f);
    if (turn > maxTurn) continue;
    // A limb is a line in the body's frontal plane, and turning the body by t
    // compresses only its HORIZONTAL component (x' = x cos t); the vertical one
    // is untouched. Dividing x back out by cos t puts the length back, so a
    // three-quarter frame measures the arm instead of shortening it by a third.
    const cos = Math.max(0.5, Math.cos(degToRad(turn)));
    const perSide = [];
    for (const side of sides) {
      const pts = points.map((name) => joint(f, name, side));
      if (pts.some((p) => !p)) continue;
      let span = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const dx = (pts[i].x - pts[i - 1].x) / cos;
        const dy = (pts[i].y - pts[i - 1].y) / f.aspect;
        span += Math.hypot(dx, dy);
      }
      const inches = toIn(span * f.scale.cmPerWidth);
      if (range && (inches < range[0] || inches > range[1])) continue;
      perSide.push(inches);
    }
    if (!perSide.length) continue;
    samples.push({ value: perSide.reduce((s, v) => s + v, 0) / perSide.length, weight: frameQuality(f) });
  }
  const m = robustMean(samples);
  return m ? { in: m.value, n: m.n, spread: m.spread } : null;
}
