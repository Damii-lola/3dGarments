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
/** Width:depth of a cross-section, used only when no side view exists. */
export const DEPTH_RATIO = { chest: 0.72, waist: 0.76, hips: 0.80, neck: 0.92, arm: 0.90 };

/** The landmark pair that spans each region. */
export const REGIONS = {
  shoulder: { left: 'shoulderL', right: 'shoulderR', label: 'Shoulder', girth: false },
  chest: { left: 'armpitL', right: 'armpitR', label: 'Chest', girth: true, ratio: 'chest' },
  waist: { left: 'waistL', right: 'waistR', label: 'Waist', girth: true, ratio: 'waist' },
  hips: { left: 'hipL', right: 'hipR', label: 'Hips', girth: true, ratio: 'hips' },
  neck: { left: 'neckL', right: 'neckR', label: 'Neck', girth: true, ratio: 'neck' },
  arm: { left: 'armL', right: 'armR', label: 'Upper arm', girth: true, ratio: 'arm' },
};
export const GIRTH_REGIONS = ['chest', 'waist', 'hips'];
export const VIEW_WEIGHT = { front: 1.0, back: 0.95, 'three-quarter': 0.55, side: 1.0 };

/**
 * Plausible adult BREADTH (front/back view) and DEPTH (side view) in cm for each
 * region — a span, not a circumference. Anything outside these is a mis-placed
 * landmark, not an unusual person, and gets dropped before it can become a
 * confident wrong number.
 */
export const SPAN_RANGES_CM = {
  shoulder: { width: [30, 56], depth: [26, 54] },
  chest: { width: [22, 46], depth: [15, 36] },
  waist: { width: [20, 50], depth: [13, 40] },
  hips: { width: [24, 52], depth: [16, 42] },
  neck: { width: [8, 17], depth: [7, 17] },
  arm: { width: [6, 18], depth: [5, 18] },
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
    const span = spanX(frame, spec.left, spec.right);
    if (span == null || span <= 0 || !frame.scale) continue;
    const cm = span * frame.scale.cmPerWidth;
    const [lo, hi] = SPAN_RANGES_CM[key][frame.view === 'side' ? 'depth' : 'width'];
    if (cm < lo || cm > hi) {
      bad.add(key);
      notes.push(`${key} spans ${Math.round(cm)} cm`);
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

/**
 * Measure one region across every frame: width from front/back frames, depth
 * from side frames, then a girth from the ellipse they describe. Returns null
 * when the landmark pair was never visible.
 */
export function measureRegion(key, frames) {
  const spec = REGIONS[key];
  const widths = [];
  const depths = [];
  const viewsUsed = new Set();
  let skipped = 0;

  for (const f of frames) {
    if (!f.scale) continue;
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

  const d = spec.girth ? robustMean(depths) : null;
  const depthCm = d ? d.value : (spec.girth ? w.value * DEPTH_RATIO[spec.ratio] : null);
  const depthSource = spec.girth ? (d ? `side view x${d.n}` : `${DEPTH_RATIO[spec.ratio]}x width`) : null;

  const girthCm = spec.girth ? ellipsePerimeter(w.value / 2, depthCm / 2) : null;
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
