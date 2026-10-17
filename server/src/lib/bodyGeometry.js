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
 * Adult stature runs about 7.1-7.9 of the subject's own head-heights, so a frame
 * that reads outside that range has a mis-placed head landmark (usually a chin
 * set too high). Rather than throw the frame away we nudge the scale back inside
 * the range, bounded, because the head is what every other number is scaled by.
 */
export const TARGET_HEAD_UNITS = 7.5;
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
 * The limbs are the survey's other lesson: on the one limb ANSUR measured both
 * ways (the ankle, 7.5 cm across and 22.9 cm round), pi x width is the tape to
 * within 2.5%, so a limb is treated as round and the width carries it.
 */
export const DEPTH_RATIO = {
  head: 1.30, neck: 0.92, upperChest: 0.88, chest: 0.88, underbust: 0.80,
  waist: 0.72, lowWaist: 0.72, hips: 0.71,
  arm: 0.95, elbow: 0.95, wrist: 0.88,
  knee: 0.95, calf: 0.95, ankle: 0.95,
};

/**
 * Every region a landmark pair can span. Each is measured the same way — the
 * horizontal separation of the pair, in the frame's own scale — and only the
 * pair's meaning differs. `girth: true` means the pair describes a closed
 * cross-section whose perimeter can be computed from a width and a depth.
 */
export const REGIONS = {
  head: { left: 'headL', right: 'headR', label: 'Head', girth: true, ratio: 'head' },
  neck: { left: 'neckL', right: 'neckR', label: 'Neck', girth: true, ratio: 'neck' },
  shoulder: { left: 'shoulderL', right: 'shoulderR', label: 'Shoulder', girth: false },
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
  // a real reading when it is wider than a bare ankle could be.
  hem: { left: 'ankleL', right: 'ankleR', label: 'Leg opening', girth: false },
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
export const toIn = (cm) => cm / CM_PER_IN;

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
 * How much longer a tape is than the ellipse for one cross-section. A head, a
 * neck and every limb have no survey pair to fit, and the one limb with both
 * measurements says a round one is right, so they keep the ellipse.
 */
export function shapeFactor(ratioKey, gender) {
  const row = GIRTH_SHAPE[ratioKey];
  if (!row) return 1;
  return row[gender] ?? row.unsure;
}

/** The tape circumference that a width and a depth describe, ANSUR II's way. */
export function tapeGirth(widthCm, depthCm, ratioKey, gender) {
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

    // If the whole body is in shot we can check the head against adult
    // proportions and correct a small head-landmark error, which would
    // otherwise inflate every measurement by the same percentage.
    const statureSpan = spanY(frame, point(frame, 'headTop')?.y, meanY(frame, 'footL', 'footR'));
    if (statureSpan && statureSpan > headSpan * 5) {
      const units = statureSpan / headSpan;
      headUnitsCorrection = clamp(units / TARGET_HEAD_UNITS, [1 - HEAD_UNIT_CORRECTION_LIMIT, 1 + HEAD_UNIT_CORRECTION_LIMIT]);
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

  for (const key of Object.keys(REGIONS)) {
    const spec = REGIONS[key];
    // A breadth-only region read from a side-on frame is the body's DEPTH, and
    // there is no depth range to judge it against — so it is not a bad reading,
    // it is simply not a reading. Skipping it here keeps it out of the note that
    // explains discarded spans.
    if (!spec.girth && frame.view === 'side') continue;
    const span = spanX(frame, spec.left, spec.right);
    if (span == null || span <= 0 || !frame.scale) continue;
    const cm = span * frame.scale.cmPerWidth;
    const [lo, hi] = SPAN_RANGES_CM[key][frame.view === 'side' ? 'depth' : 'width'];
    if (cm < lo || cm > hi) {
      bad.add(key);
      notes.push(`${key} spans ${Math.round(cm)} cm`);
    }
  }

  // The same failure, caught relationally: a torso row wider than this fraction
  // of the shoulder span is the arms, not the torso. Scale-free (both spans are
  // read in the same frame), so it holds however far away the camera was.
  if (frame.view !== 'side' && frame.scale) {
    const shoulder = spanX(frame, REGIONS.shoulder.left, REGIONS.shoulder.right);
    const shoulderCm = shoulder == null ? 0 : shoulder * frame.scale.cmPerWidth;
    if (shoulderCm > 0) {
      const limits = TORSO_SPAN_LIMIT[frame.gender === 'male' ? 'male' : 'female'];
      for (const [key, frac] of Object.entries(limits)) {
        const spec = REGIONS[key];
        const span = spanX(frame, spec.left, spec.right);
        if (span == null || span <= 0) continue;
        const cm = span * frame.scale.cmPerWidth;
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
 */
export function measureHeight(frames) {
  const samples = [];
  for (const f of frames) {
    if (!f.scale || f.heightBad) continue;
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
 * Measure one region across every frame: width from front/back frames, depth
 * from side frames, then a girth from the ellipse they describe. Returns null
 * when the landmark pair was never visible.
 *
 * `opts.views` restricts which frames count — "across the back" and "from the
 * front" are the same line seen twice, and a tailor asking for X-Back wants the
 * reading from the back, not whichever frame happened to be clearest.
 */
export function measureRegion(key, frames, opts = {}) {
  const spec = REGIONS[key];
  const views = opts.views || null;
  const widths = [];
  const depths = [];
  const viewsUsed = new Set();
  let skipped = 0;

  for (const f of frames) {
    if (!f.scale) continue;
    if (views && !views.includes(f.view)) continue;
    if (f.bad?.has(key)) { skipped += 1; continue; } // failed the sanity check
    const span = spanX(f, spec.left, spec.right);
    if (span == null || span < 0.005) continue; // landmark pair never placed
    const cm = span * f.scale.cmPerWidth;
    const weight = frameQuality(f) * (VIEW_WEIGHT[f.view] ?? 0.6);
    if (f.view === 'side') {
      depths.push({ value: cm, weight });
      viewsUsed.add('side');
    } else {
      widths.push({ value: cm, weight });
      viewsUsed.add(f.view);
    }
  }

  const w = robustMean(widths);
  if (!w) return null;

  // The prior depth is a last resort for when no side-on frame could read it.
  // A caller may override it per region: a man's ribcage and a woman's bust are
  // not the same cross-section, and one ratio cannot describe both.
  const prior = opts.depthRatio ?? DEPTH_RATIO[spec.ratio];
  const d = spec.girth ? robustMean(depths) : null;
  const depthCm = d ? d.value : (spec.girth ? w.value * prior : null);
  const depthSource = spec.girth ? (d ? `side view x${d.n}` : `${prior}x width, modelled`) : null;

  // Straight-line widths turned into a tape reading the way ANSUR II's own
  // measurements say they turn: a torso is a flattened box, not an ellipse.
  const gender = opts.gender ?? frames.find((f) => f.gender)?.gender ?? 'unsure';
  const girthCm = spec.girth ? tapeGirth(w.value, depthCm, spec.ratio, gender) : null;
  const valueCm = spec.girth ? girthCm : w.value;
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
  } = spec;
  const samples = [];
  for (const f of frames) {
    if (!f.scale) continue;
    if (views && !views.includes(f.view)) continue;
    const perSide = [];
    for (const side of sides) {
      const pts = points.map((name) => point(f, `${name}${side}`) || point(f, name));
      if (pts.some((p) => !p)) continue;
      let span = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const dx = pts[i].x - pts[i - 1].x;
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
