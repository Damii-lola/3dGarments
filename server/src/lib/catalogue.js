/**
 * The measurement catalogue: every category a tailor's sheet asks for, the
 * gender group it belongs to, and exactly how it is read off the video.
 *
 * Two rules this file exists to enforce:
 *
 *   1. MEN'S CATEGORIES FOR MEN, WOMEN'S FOR WOMEN. They are not
 *      interchangeable. A man has no bust; a woman's "chest" is the upper chest
 *      above the bust, not the full bust that sizes her. The group is the one
 *      the user picked, and nothing from the other group is ever computed.
 *
 *   2. NO EVIDENCE, NO CATEGORY. Every item below has to be read off a landmark
 *      pair or a body row that was actually in a frame. When it was not in the
 *      video the item is simply absent — not estimated, and not mentioned. An
 *      upper-body clip returns the upper-body categories and nothing else.
 *
 * The arithmetic itself lives in ./bodyGeometry.js; this file only decides
 * which lines to ask for and how to word what came back.
 */

import {
  CM_PER_IN,
  REGIONS,
  depthRatio,
  measurePath,
  measureRegion,
  measureVertical,
  round1,
} from './bodyGeometry.js';

/**
 * The span pairs computed once and shared by both groups. `views` limits an
 * item to frames that show a particular side — the same line read across the
 * back is a different tailor's number from the one read across the front.
 */
/**
 * The prior front-to-back depth, as a fraction of the front width, used only
 * when no frame was turned far enough to read the depth of that part.
 *
 * A man's chest and a woman's bust are NOT the same cross-section, and giving
 * them one number is what sized a large-busted woman two sizes too small. Both
 * now come from the survey itself — a least-squares fit of depth on width across
 * ANSUR II's paired caliper measurements — as does every other torso part.
 */
export function depthRatioFor(regionKey, gender) {
  if (regionKey !== 'chest') return undefined;
  return depthRatio('chest', gender);
}

const SPAN_SETS = [
  ['head', 'head', null],
  ['neck', 'neck', null],
  ['shoulder', 'shoulder', null],
  ['upperChest', 'upperChest', null],
  ['bust', 'chest', null, true],
  ['underbust', 'underbust', null],
  ['waist', 'waist', null],
  ['lowWaist', 'lowWaist', null],
  ['hips', 'hips', null],
  ['arm', 'arm', null],
  ['elbow', 'elbow', null],
  ['wrist', 'wrist', null],
  ['knee', 'knee', null],
  ['calf', 'calf', null],
  ['highAnkle', 'highAnkle', null],
  ['ankle', 'ankle', null],
  ['hem', 'hem', null],
];

/**
 * Distances down the body. Each row is named the way a tailor would say it, and
 * each carries the plausible adult range used to throw away a foreshortened
 * reading rather than average it in.
 */
const VERTICALS = {
  napeToWaist: { from: 'neck', to: 'waist', range: [11, 27] },
  armholeDepth: { from: 'shoulder', to: 'upperChest', range: [4.5, 13] },
  shoulderToWaist: { from: 'shoulder', to: 'waist', range: [13, 30] },
  waistToHip: { from: 'waist', to: 'hip', range: [4, 14] },
  waistToKnee: { from: 'waist', to: 'kneeJ', range: [13, 29] },
  waistToFloor: { from: 'waist', to: 'foot', range: [28, 50] },
  bodyRise: { from: 'waist', to: 'crotch', range: [7, 17] },
  crownToWaist: { from: 'headTop', to: 'waist', range: [17, 33] },
};

/**
 * Paths through landmarks. Two lengths are asked for by the same word, and they
 * are 9 inches apart on an adult, so both are read rather than one being called
 * "sleeve length" and the other left out:
 *
 *   centreBackToWrist  the NAPE, out over the shoulder point, through the elbow,
 *                      to the wrist bone. This is what a shirt chart prints as
 *                      "sleeve length", what a tailor tapes, and what a garment
 *                      is graded along. A 6'1" man is about 31-33".
 *   shoulderToWrist    the shoulder point itself, through the elbow, to the wrist
 *                      bone: the arm as anatomy counts it, about 22-24" on the same
 *                      man. Shorter by the neck-to-shoulder run, which is half the
 *                      shoulder width - the same tape, laid from a different start.
 */
const PATHS = {
  centreBackToWrist: { points: ['neckCentre', 'shoulder', 'elbow', 'wrist'], range: [20, 44] },
  shoulderToWrist: { points: ['shoulder', 'elbow', 'wrist'], range: [16, 33] },
};

/** What each path actually runs along, said in words the shopper can check. */
const PATH_WORDS = {
  centreBackToWrist: 'the nape of your neck, out over your shoulder point, through your elbow, to your wrist bone',
  shoulderToWrist: 'your shoulder point, through your elbow, to your wrist bone',
};

/** How a row is named when it is described back to the user. */
const ROW_WORDS = {
  headTop: 'the crown of your head',
  neck: 'the nape of your neck',
  shoulder: 'your shoulder line',
  upperChest: 'your armpit line',
  waist: 'your waist line',
  hip: 'your hip line',
  crotch: 'your crotch',
  kneeJ: 'your knee',
  foot: 'the floor',
};

/* ---------------- the two groups ---------------- */

const MEN = [
  { key: 'head', label: 'Head', kind: 'girth', span: 'head', note: 'read across your ears and widened to the skull, because hair is not head' },
  { key: 'neck', label: 'Neck Size', kind: 'girth', span: 'neck' },
  { key: 'chest', label: 'Chest', kind: 'girth', span: 'bust' },
  { key: 'waist', label: 'Waist', kind: 'girth', span: 'waist' },
  { key: 'lowWaist', label: 'Lower Waist', kind: 'girth', span: 'lowWaist' },
  { key: 'hips', label: 'Hip/Seat', kind: 'girth', span: 'hips' },
  { key: 'shoulder', label: 'Shoulder', kind: 'width', span: 'shoulder' },
  { key: 'napeToWaist', label: 'Nape to waist', kind: 'vertical', vertical: 'napeToWaist' },
  { key: 'armholeDepth', label: 'Armscye depth', kind: 'vertical', vertical: 'armholeDepth' },
  { key: 'sleeveLength', label: 'Sleeve Length', kind: 'path', path: 'centreBackToWrist', note: 'measured from the nape, the way a shirt chart measures it' },
  { key: 'armLength', label: 'Arm (shoulder to wrist)', kind: 'path', path: 'shoulderToWrist' },
  { key: 'shoulderToWaist', label: 'Front Shoulder to Waist', kind: 'vertical', vertical: 'shoulderToWaist' },
  { key: 'waistToKnee', label: 'Waist to Knee', kind: 'vertical', vertical: 'waistToKnee' },
  { key: 'waistToHip', label: 'Waist to Hip', kind: 'vertical', vertical: 'waistToHip' },
  { key: 'waistToFloor', label: 'Waist to Floor', kind: 'vertical', vertical: 'waistToFloor' },
  { key: 'elbow', label: 'Elbow', kind: 'girth', span: 'elbow' },
  { key: 'wrist', label: 'Wrist', kind: 'girth', span: 'wrist' },
  { key: 'bodyRise', label: 'Body Rise', kind: 'vertical', vertical: 'bodyRise' },
  { key: 'crotchLength', label: 'Crotch Length', kind: 'derived', derive: 'crotchLength' },
  { key: 'backWidth', label: 'Back Width', kind: 'width', span: 'bust', note: 'across your back at armpit level' },
  { key: 'knee', label: 'Knee', kind: 'girth', span: 'knee' },
  { key: 'calf', label: 'Calf', kind: 'girth', span: 'calf' },
  { key: 'highAnkle', label: 'High Ankle', kind: 'girth', span: 'highAnkle' },
  { key: 'cuffShirts', label: 'Cuff Size Shirts', kind: 'derived', derive: 'cuffShirts' },
  { key: 'trouserBottom', label: 'Trouser Bottom Width', kind: 'derived', derive: 'trouserBottom' },
  { key: 'ankle', label: 'Ankle', kind: 'girth', span: 'ankle' },
  { key: 'upperbodyHeight', label: 'Upperbody Height', kind: 'vertical', vertical: 'crownToWaist' },
  { key: 'lowerbodyHeight', label: 'Lowerbody Height', kind: 'vertical', vertical: 'waistToFloor' },
];

const WOMEN = [
  { key: 'bust', label: 'Bust', kind: 'girth', span: 'bust' },
  { key: 'waist', label: 'Waist', kind: 'girth', span: 'waist' },
  { key: 'hips', label: 'Hips', kind: 'girth', span: 'hips' },
  { key: 'backWidth', label: 'Back Width', kind: 'width', span: 'bust', note: 'across your back at armpit level' },
  {
    key: 'chest',
    label: 'Chest',
    kind: 'girth',
    span: 'upperChest',
    note: 'the upper chest above the bust, which is what "chest" means on a women\'s sheet',
  },
  { key: 'shoulder', label: 'Shoulder', kind: 'width', span: 'shoulder' },
  { key: 'neck', label: 'Neck Size', kind: 'girth', span: 'neck' },
  { key: 'dart', label: 'Dart', kind: 'derived', derive: 'dart' },
  { key: 'topArm', label: 'Top Arm', kind: 'girth', span: 'arm' },
  { key: 'wrist', label: 'Wrist', kind: 'girth', span: 'wrist' },
  { key: 'ankle', label: 'Ankle', kind: 'girth', span: 'ankle' },
  { key: 'highAnkle', label: 'High Ankle', kind: 'girth', span: 'highAnkle' },
  { key: 'napeToWaist', label: 'Nape to waist', kind: 'vertical', vertical: 'napeToWaist' },
  { key: 'shoulderToWaist', label: 'Front Shoulder to Waist', kind: 'vertical', vertical: 'shoulderToWaist' },
  { key: 'armholeDepth', label: 'Armhole Depth', kind: 'vertical', vertical: 'armholeDepth' },
  { key: 'waistToKnee', label: 'Waist to Knee', kind: 'vertical', vertical: 'waistToKnee' },
  { key: 'waistToHip', label: 'Waist to Hip', kind: 'vertical', vertical: 'waistToHip' },
  { key: 'waistToFloor', label: 'Waist to Floor', kind: 'vertical', vertical: 'waistToFloor' },
  { key: 'bodyRise', label: 'Body Rise', kind: 'vertical', vertical: 'bodyRise' },
  { key: 'sleeveLength', label: 'Sleeve Length', kind: 'path', path: 'centreBackToWrist', note: 'measured from the nape, the way a shirt chart measures it' },
  { key: 'armLength', label: 'Arm (shoulder to wrist)', kind: 'path', path: 'shoulderToWrist' },
  { key: 'cuffShirts', label: 'Cuff Size Shirts', kind: 'derived', derive: 'cuffShirts' },
  { key: 'trouserBottom', label: 'Trouser Bottom Width', kind: 'derived', derive: 'trouserBottom' },
];

export const CATALOGUE = { male: MEN, female: WOMEN };

/**
 * A leg opening has to be noticeably wider than a bare ankle (~6.5 cm across)
 * before the mask at that row can be called a trouser leg rather than an ankle.
 */
const HEM_MIN_CM = 9;

/** Round up to the next half inch — how a shirt cuff is actually quoted. */
const halfUp = (v) => Math.ceil(v * 2) / 2;

/**
 * Items that are computed from others rather than read directly. Each says what
 * it is made of, so the working can be shown and checked.
 */
const DERIVED = {
  /** The shaping a bodice has to take: bust girth minus underbust girth. */
  dart: (ev) => {
    const bust = ev.spans.bust?.valueIn;
    const under = ev.spans.underbust?.valueIn;
    if (bust == null || under == null || under >= bust) return null;
    return { in: bust - under, how: `${round1(bust)}" bust minus ${round1(under)}" underbust — the shaping a bodice takes` };
  },
  /**
   * A shirt cuff has to clear the hand, so it is the wrist plus ease, rounded to
   * the half inch the way cuffs are sold.
   */
  cuffShirts: (ev) => {
    const wrist = ev.spans.wrist?.valueIn;
    if (wrist == null) return null;
    return { in: halfUp(wrist + 0.75), how: `${round1(wrist)}" wrist plus ease to clear the hand, rounded up to the half inch` };
  },
  /**
   * The trouser-leg opening. Only called that when there is fabric at the ankle:
   * a bare ankle is about 6.5 cm across, a trouser hem is 9 cm and up. A skirt
   * or bare legs therefore simply has no trouser bottom width.
   */
  trouserBottom: (ev) => {
    const leg = ev.legOpeningCm;
    if (leg == null || leg < HEM_MIN_CM) return null;
    const garment = ev.clothing.lower || null;
    if (garment && /skirt|shorts|dress|none/i.test(garment)) return null;
    return {
      cm: leg,
      in: leg / CM_PER_IN,
      how: `${round1(leg / CM_PER_IN)}" across the leg opening at the ankle${garment ? ` (${garment})` : ' — the fabric at your ankle'}`,
    };
  },
  /**
   * The tape path around the seat: down the front from the waist to the crotch,
   * under it, and up the back. Measured as twice the waist-to-crotch rise plus
   * the front-to-back depth of the seat at the crotch line.
   */
  crotchLength: (ev) => {
    const rise = ev.verticals.bodyRise?.in;
    const depth = ev.spans.hips?.depthIn;
    if (rise == null || depth == null) return null;
    return {
      in: rise * 2 + depth,
      how: `2 x ${round1(rise)}" waist-to-crotch rise + ${round1(depth)}" seat depth (${ev.spans.hips.depthSource}) — the front-to-back curve around the crotch`,
    };
  },
};

/** The sentence shown under "How these were worked out" for one item. */
function howFor(spec, ev, value) {
  if (spec.kind === 'girth') {
    const s = ev.spans[spec.span];
    if (!s) return null;
    // A head is taped from its breadth alone, so there is no depth to quote.
    const from = s.depthIn == null
      ? `${round1(s.widthIn)}" across (${s.depthSource})`
      : `${round1(s.widthIn)}" across x ${round1(s.depthIn)}" deep (${s.depthSource})`;
    return `${from} -> a tape of ${round1(value)}" around it${s.widthViews ? `, from ${s.widthViews} frame${s.widthViews === 1 ? '' : 's'}` : ''}${spec.note ? ` — ${spec.note}` : ''}`;
  }
  if (spec.kind === 'width') {
    const s = ev.spans[spec.span];
    if (!s) return null;
    return `${round1(value)}" ${spec.note || 'across the landmark pair'}, from ${s.widthViews} frame${s.widthViews === 1 ? '' : 's'}`;
  }
  if (spec.kind === 'vertical') {
    const v = ev.verticals[spec.vertical];
    const from = ROW_WORDS[VERTICALS[spec.vertical].from] || VERTICALS[spec.vertical].from;
    const to = ROW_WORDS[VERTICALS[spec.vertical].to] || VERTICALS[spec.vertical].to;
    if (!v) return null;
    return `${round1(value)}" from ${from} to ${to}, from ${v.n} frame${v.n === 1 ? '' : 's'}`;
  }
  if (spec.kind === 'path') {
    const v = ev.paths[spec.path];
    if (!v) return null;
    const line = PATH_WORDS[spec.path] || 'your shoulder point, through your elbow, to your wrist bone';
    return `${round1(value)}" from ${line}, from ${v.n} frame${v.n === 1 ? '' : 's'}`;
  }
  return null;
}

/**
 * Read the catalogue out of the frames the scan was given.
 *
 * @param {{frames: object[], gender: string, clothing?: object}} opts
 * @returns {{group: string, items: object[], evidence: object}}
 */
export function buildCatalogue({ frames, gender, clothing = {}, calc = null }) {
  const group = gender === 'female' ? 'female' : 'male';

  const spans = {};
  for (const [key, region, views, bustDepth] of SPAN_SETS) {
    const opts = { gender: group };
    if (views) opts.views = views;
    // The bust depth prior follows the group: a bust projects, a ribcage does not.
    if (bustDepth) opts.depthRatio = depthRatioFor('chest', group);
    spans[key] = measureRegion(region, frames, opts);
    // The calculation step's number stands for this span when it gave one: it
    // looked at every frame at once, which no single frame can.
    const fixed = calc ? Number(calc[region]) : NaN;
    if (spans[key] && Number.isFinite(fixed)) {
      if (region === 'shoulder') spans[key].widthIn = fixed;
      else spans[key].valueIn = fixed;
      // The calculation step is asked for the body, not for the garment, so
      // fabric must not be taken off its number a second time.
      spans[key].fromCalc = true;
    }
  }
  // A shoulder narrower than two fifths of the chest girth is not a shoulder. The
  // landmark pass puts its two points inside the deltoid, and on a body whose arms
  // hang close to the ribs that reads 13" against a 19" truth - a third of the
  // body's width, printed beside a chest of 40. The calculation step gives the real
  // breadth when it is sure of it; when it is not, the span is dropped instead of
  // shown, so a chart that scores on shoulder is left unscored rather than answered
  // from a number nobody measured.
  const shoulderSpan = spans.shoulder;
  // The chest the guard compares against is whichever chest the scan will print:
  // the calculated one when there is one, because the geometry span is often
  // dropped on a frame where the arms hide the ribs.
  const chestGirth = Number.isFinite(Number(calc?.chest)) ? Number(calc.chest) : spans.bust?.valueIn;
  if (shoulderSpan && Number.isFinite(chestGirth)) {
    if (shoulderSpan.widthIn < chestGirth / 2.4 || shoulderSpan.widthIn > chestGirth / 1.75) {
      shoulderSpan.widthIn = null;
    }
  }

  const verticals = {};
  for (const [key, spec] of Object.entries(VERTICALS)) verticals[key] = measureVertical(frames, spec);
  const paths = {};
  for (const [key, spec] of Object.entries(PATHS)) paths[key] = measurePath(frames, spec);

  // The leg opening is a flat width in centimetres, kept in cm because the
  // threshold that says "that is fabric, not an ankle" is a centimetre one. It
  // comes from the hem span, which only survives the sanity check when the width
  // at the ankle really is wider than a bare ankle can be.
  const ankleWidthCm = spans.hem ? spans.hem.widthIn * CM_PER_IN : null;

  const ev = {
    spans, verticals, paths, clothing, group, legOpeningCm: ankleWidthCm,
  };

  // Fabric lies over the body on every frame, so it comes off the catalogue the
  // same way it comes off the size verdict: a layer of thickness t lengthens a
  // tape by 2*pi*t whatever cross-section it wraps, and adds 2*t across a flat
  // width. The catalogue is meant to be the body, so it must not still be
  // carrying a hoodie. A top and a lower garment are separate thicknesses over
  // separate rows, and a garment that was never named takes nothing off.
  const topT = Number(clothing.thicknessIn) > 0 ? Number(clothing.thicknessIn) : 0;
  const lowerT = Number(clothing.lowerThicknessIn) > 0 ? Number(clothing.lowerThicknessIn) : 0;
  const TOP_ROWS = new Set(['bust', 'waist', 'lowWaist', 'arm', 'shoulder']);
  const clothOff = (kind, span) => {
    if (kind === 'width' && span === 'shoulder') return 2 * topT;
    if (kind !== 'girth') return 0;
    if (TOP_ROWS.has(span)) return 2 * Math.PI * topT;
    if (span === 'hips' || span === 'knee' || span === 'calf' || span === 'highAnkle' || span === 'ankle') {
      return 2 * Math.PI * lowerT;
    }
    return 0;
  };
  const clothWord = (span) => (TOP_ROWS.has(span)
    ? (clothing.top || 'your top')
    : (clothing.lower || 'your trousers'));

  const items = [];
  // A span the sanity check dropped can still be answered by the calculation
  // step, which saw every frame together. Map span → region so 'bust' finds
  // 'chest'.
  const spanRegion = Object.fromEntries(SPAN_SETS.map(([k, r]) => [k, r]));
  const calcValue = (span, kind) => {
    // A girth is not a width: the only flat width the calculation step reports is
    // the shoulder span. Filling "back width" from a chest circumference put a
    // 38" girth into a 14" slot.
    if (kind === 'width' && span !== 'shoulder') return null;
    const n = calc ? Number(calc[spanRegion[span]]) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  for (const spec of CATALOGUE[group]) {
    let value = null;
    let how = null;
    let fromCalc = Boolean(spans[spec.span]?.fromCalc);
    if (spec.kind === 'girth') {
      value = spans[spec.span]?.valueIn ?? null;
      if (value == null) { value = calcValue(spec.span, spec.kind); fromCalc = value != null; }
    } else if (spec.kind === 'width') {
      value = spans[spec.span]?.widthIn ?? null;
      if (value == null) { value = calcValue(spec.span, spec.kind); fromCalc = value != null; }
    } else if (spec.kind === 'vertical') value = verticals[spec.vertical]?.in ?? null;
    else if (spec.kind === 'path') value = paths[spec.path]?.in ?? null;
    else if (spec.kind === 'derived') {
      const d = DERIVED[spec.derive]?.(ev) || null;
      value = d ? d.in : null;
      how = d ? d.how : null;
    }
    if (value == null || !Number.isFinite(value)) continue;
    // Fabric comes off a measurement the camera worked out for itself. A number
    // the calculation step gave already describes the body, so taking a layer off
    // it again made every girth about 1.5" small.
    const off = fromCalc ? 0 : clothOff(spec.kind, spec.span);
    if (off > 0) value -= off;
    const sentence = how || howFor(spec, ev, value) || spec.label;
    items.push({
      key: spec.key,
      label: spec.label,
      in: round1(value),
      cm: round1(value * CM_PER_IN),
      how: off > 0
        ? `${sentence} — less ${round1(off)}" for ${clothWord(spec.span)}, so this is the body and not the garment`
        : sentence,
    });
  }

  const regions = {};
  for (const [key, v] of Object.entries(spans)) {
    if (!v) continue;
    regions[key] = {
      in: round1(v.valueIn),
      widthIn: round1(v.widthIn),
      depthIn: v.depthIn == null ? null : round1(v.depthIn),
      depthSource: v.depthSource,
      views: v.views,
      confidence: v.confidence,
    };
  }
  const spine = {};
  for (const [key, v] of Object.entries(verticals)) if (v) spine[key] = { in: round1(v.in), n: v.n };
  for (const [key, v] of Object.entries(paths)) if (v) spine[key] = { in: round1(v.in), n: v.n };

  return { group, items, evidence: { regions, spine } };
}
