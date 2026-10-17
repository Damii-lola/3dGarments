/**
 * Body breadths read straight off a pose-estimator's segmentation mask.
 *
 * The pose model tells us WHERE the body is — joint positions, each carrying an
 * honest visibility score. The mask tells us HOW WIDE the body is at any height.
 * Splitting those two jobs is what makes the numbers real: every width below is
 * a count of pixels, not a recollection of what an average person looks like.
 *
 * Two things this deliberately does NOT trust:
 *
 *   1. The pose model's world landmarks as a ruler. They are a learned skeleton
 *      pulled towards an average body: on a heavily built man they imply a 29 cm
 *      waist where the tape says 35.5 cm, so absolute scale comes from the head
 *      instead (a documented constant) and the world landmarks are only used to
 *      tell which way the person is facing.
 *   2. A torso width measured while the arms hang against the body. That is the
 *      classic failure — a 45 cm chest reads 62 cm — so a row only counts when
 *      each arm's own joint line sits clear of the torso silhouette. When it
 *      never does, the region is reported as unavailable with a note saying so,
 *      rather than guessed through the arms.
 *
 * Pure: no DOM and no model types. Everything is a plain array so it can be
 * tested exactly, the same way server/src/lib/bodyGeometry.js is.
 */

/** A pixel counts as "person" above this mask probability. */
export const MASK_ON = 0.5;
/**
 * Head length as a fraction of the crown-to-neck distance. Measured across the
 * mask, the neck's narrowest row sits just under the jaw, so crown-to-chin runs
 * about 0.88 of crown-to-neck. View-independent, unlike an ear-to-ear width.
 */
export const HEAD_NECK_RATIO = 0.88;
/**
 * Adult head length, crown to chin. The number that turns a head measured in
 * pixels into centimetres, so it sets the scale for the whole body.
 */
export const HEAD_LENGTH_CM = 23.5;
/**
 * The same constant per group. A man's head and a woman's are not the same
 * length, and every other number is scaled by this one, so the user's own
 * answer is worth about 4% on every measurement. 23.5 cm stays the default for
 * a clip nobody labelled.
 */
export const HEAD_LENGTH_CM_BY_GENDER = { male: 23.5, female: 22.5, unsure: 23.0 };
/**
 * Head length as a multiple of the eye-to-mouth distance, from adult face
 * proportions: the eye line is the head's midpoint and the mouth line sits a
 * third of the way from the eyes to the chin, so eye-to-mouth is a third of the
 * head. Read off the pose's own face, which knows nothing of hair.
 */
export const FACE_HEAD_FACTOR = 3;
/** How far an arm's joint line must clear the torso before its row counts. */
const ARM_MARGIN_FRAC = 0.015;
/**
 * Head breadth against the distance between the pose's two ear landmarks. The
 * model marks each ear at its own centre, and the skull reaches about a twelfth
 * further out on each side — the same kind of published proportion as
 * HEAD_NECK_RATIO, and the only reason a head circumference read off the ears
 * comes out the size of a hat rather than a head.
 */
export const HEAD_EAR_BREADTH_FACTOR = 1.12;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const r1 = (v) => Math.round(v * 10) / 10;

/** Contiguous runs of person pixels across one mask row. */
export function rowRuns(mask, w, h, y, thr = MASK_ON) {
  const row = Math.max(0, Math.min(h - 1, Math.round(y)));
  const out = [];
  let start = -1;
  for (let x = 0; x < w; x += 1) {
    const on = mask[row * w + x] > thr;
    if (on && start < 0) start = x;
    else if (!on && start >= 0) { out.push({ x0: start, x1: x - 1, w: x - start }); start = -1; }
  }
  if (start >= 0) out.push({ x0: start, x1: w - 1, w: w - start });
  return out;
}

/** The run containing `x`, or null. */
export function runAt(runs, x) {
  for (const r of runs) if (x >= r.x0 && x <= r.x1) return r;
  return null;
}

/** Five-tap moving average — mask edges are a pixel or two ragged. */
function smooth(values, radius = 2) {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k += 1) {
      if (k < 0 || k >= values.length) continue;
      sum += values[k];
      n += 1;
    }
    return sum / n;
  });
}

/**
 * The pose model's own metric scale, kept only as a cross-check for the
 * diagnostics. Never used to set centimetres: it regresses to an average body.
 */
export function metricScale({ lm, world, imgW, imgH }) {
  if (!world || !world.length) return null;
  const pairs = [[11, 12], [23, 24], [25, 26], [27, 28], [11, 23], [23, 27], [11, 27], [11, 25]];
  const samples = [];
  for (const [a, b] of pairs) {
    const la = lm[a];
    const lb = lm[b];
    const wa = world[a];
    const wb = world[b];
    if (!la || !lb || !wa || !wb) continue;
    const px = Math.hypot((la.x - lb.x) * imgW, (la.y - lb.y) * imgH);
    const m = Math.hypot(wa.x - wb.x, wa.y - wb.y, wa.z - wb.z);
    const vis = Math.min(Number(la.visibility) || 0, Number(lb.visibility) || 0);
    if (!(px > 8) || !(m > 0.02) || vis < 0.5) continue;
    samples.push((m * 100) / px);
  }
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    cmPerPx: sorted[Math.floor(sorted.length / 2)],
    spread: sorted[sorted.length - 1] / sorted[0],
    n: sorted.length,
  };
}

/**
 * @param {{mask: Float32Array, maskW: number, maskH: number,
 *          lm: Array<{x:number,y:number,visibility?:number}>,
 *          world?: Array<{x:number,y:number,z:number}>,
 *          imgW: number, imgH: number, gender?: string}} frame
 */
export function measureSilhouette({ mask, maskW, maskH, lm, world, imgW, imgH, gender = 'unsure' }) {
  if (!mask || !maskW || !maskH || !lm || lm.length < 33) return null;
  const notes = [];
  /**
   * Regions the client could see but could not measure (arms merged with the
   * torso, no clear upper arm). Prose for these is written by the server, which
   * is the only place that knows whether the gap survived the other frames.
   */
  const unmeasured = [];
  const vis = (i) => Number(lm[i]?.visibility) || 0;
  const row = (ny) => Math.round(ny * maskH);
  const margin = ARM_MARGIN_FRAC * maskW;
  /** The head length this scale is anchored to, for the group being measured. */
  const headCm = HEAD_LENGTH_CM_BY_GENDER[String(gender).toLowerCase()] || HEAD_LENGTH_CM;

  // ---- extent of the silhouette ----
  let topRow = -1;
  let botRow = -1;
  for (let y = 0; y < maskH; y += 1) if (rowRuns(mask, maskW, maskH, y).length) { topRow = y; break; }
  for (let y = maskH - 1; y >= 0; y -= 1) if (rowRuns(mask, maskW, maskH, y).length) { botRow = y; break; }
  if (topRow < 0) return null;

  const headCut = topRow <= 1;
  // Feet are "out of shot" when the silhouette runs into the bottom edge — or,
  // more subtly, when the silhouette stops well above the ankle joints. That
  // second case is a body cropped by the frame (or by a skirt hem), and claiming
  // a foot there would invent both a foot and a height. The geometry is evidence
  // on its own: a hallucinated ankle sits off the body **and** carries a low
  // visibility score, so waiting for that score to be high before believing the
  // geometry is exactly backwards — a 0.4-0.5 ankle sailed through and reported
  // a 137 cm adult.
  const ankleRow = Math.round((lm[27].y + lm[28].y) / 2 * maskH);
  const feetCut = botRow >= maskH - 2
    || (ankleRow > 0 && botRow < ankleRow - maskH * 0.03);

  // ---- joint rows/columns, straight from the pose ----
  const shoulderRow = row((lm[11].y + lm[12].y) / 2);
  const elbowRow = row((lm[13].y + lm[14].y) / 2);
  const hipRowLM = Math.min(maskH - 1, row((lm[23].y + lm[24].y) / 2));
  const centre = Math.round(((lm[11].x + lm[12].x) / 2) * maskW);
  if (!(shoulderRow > topRow + 6)) return null;

  /**
   * Which way the person is facing, from the shoulder line in 3D. Needed before
   * the widths are read, because a side-on frame is measured differently: see
   * rowSpan().
   */
  let view = 'front';
  if (world && world[11] && world[12]) {
    const dx = Math.abs(world[12].x - world[11].x);
    const dz = Math.abs(world[12].z - world[11].z);
    const turn = (Math.atan2(dz, Math.max(dx, 1e-6)) * 180) / Math.PI;
    view = turn > 65 ? 'side' : turn > 25 ? 'three-quarter' : 'front';
    if (view === 'front' && Math.max(vis(0), vis(7), vis(8)) < 0.3) view = 'back';
  }
  const sideOn = view === 'side';

  const torsoAt = (y) => runAt(rowRuns(mask, maskW, maskH, y), centre);
  const widthAt = (y) => { const r = torsoAt(y); return r ? r.w : 0; };
  // The shoulder row's silhouette: the outer edge of the deltoids.
  const shoulderRun = torsoAt(shoulderRow);

  // Neck = narrowest row of the lower half of the head-to-shoulder span. The
  // crown itself tapers, so the search must not start at the very top.
  let neckRow = -1;
  let neckW = Infinity;
  for (let y = topRow + Math.round((shoulderRow - topRow) * 0.45); y < shoulderRow - 1; y += 1) {
    const w = widthAt(y);
    if (w > 0 && w < neckW) { neckW = w; neckRow = y; }
  }

  // Crotch = first row below the hips where the silhouette splits into two legs.
  let crotchRow = -1;
  for (let y = hipRowLM + Math.round(maskH * 0.02); y < botRow - 1; y += 1) {
    if (rowRuns(mask, maskW, maskH, y).length >= 2) { crotchRow = y; break; }
  }

  /**
   * Is this row shaped like "arm | torso | arm"? Both arms are asked to sit
   * clear of the torso run by a margin, using the arm's own joint line rather
   * than trusting a gap in the mask — a stray blob elsewhere in the scene can
   * fake a gap, but it cannot fake the joint line moving off the torso.
   */
  const armLineAt = (y) => {
    const out = [];
    // Shoulder -> elbow, and on to the wrist when the wrist is trusted, so the
    // arm's joint line covers the whole arm instead of running off past the
    // elbow into empty space where any row would look "clear".
    for (const [s, e, w] of [[11, 13, 15], [12, 14, 16]]) {
      const sy = lm[s].y * maskH;
      const useWrist = vis(w) > 0.5 && lm[w].y * maskH > lm[e].y * maskH + 4;
      const ey = (useWrist ? lm[w].y : lm[e].y) * maskH;
      const ex = useWrist ? lm[w].x : lm[e].x;
      if (!(ey > sy + 4)) continue;
      const t = (y - sy) / (ey - sy);
      if (t < -0.05 || t > 1.02) continue;
      out.push(lerp(lm[s].x, ex, clamp01(t)) * maskW);
    }
    return out;
  };
  /** A gap narrower than this is mask noise, not an arm held clear. */
  const gapMinPx = Math.max(2, Math.round(maskW * 0.012));

  /**
   * The mask run at a row nearest a joint, optionally required to sit OUTSIDE
   * the torso run — a limb lying against the body is one blob with it, and a
   * "limb" that measures as wide as the torso is the torso.
   */
  const runNear = (rowY, targetX, outside = false) => {
    const y = Math.max(0, Math.min(maskH - 1, Math.round(rowY)));
    if (!(y > topRow) || y >= botRow) return null;
    const runs = rowRuns(mask, maskW, maskH, y);
    if (!runs.length) return null;
    let pool = runs;
    if (outside) {
      const torso = runAt(runs, centre);
      if (torso) pool = runs.filter((r) => r.x1 < torso.x0 - 1 || r.x0 > torso.x1 + 1);
    }
    if (!pool.length) return null;
    let best = null;
    for (const r of pool) {
      const d = Math.abs((r.x0 + r.x1) / 2 - targetX);
      if (!best || d < best.d) best = { r, d };
    }
    return best ? best.r : null;
  };

  const poseScale = metricScale({ lm, world, imgW, imgH });

  /**
   * The torso's two edges on this row, and why we believe them.
   *
   * The ideal row is "arm | torso | arm": silhouette either side of the torso
   * run, which pins both edges. That is rare. What a real turn mostly gives is a
   * gap on ONE side and none on the other, because one arm swings clear while
   * the other lies against the ribs — and demanding both throws away nearly
   * every frame of nearly every real clip.
   *
   * One clear side still pins that edge. The body is symmetric about the
   * shoulder-line centre, so the blocked edge is mirrored across it. That is a
   * measurement of one half plus the body's own symmetry — not a guess at where
   * an arm ends, which no silhouette can tell you.
   */
  const rowSpan = (y, torso, runs) => {
    if (!torso || torso.w < 3) return { verdict: 'no-torso' };
    // Side-on, the arm hangs across the torso and the two are one blob in the
    // picture. The horizontal span of that blob IS the body's depth, so asking
    // for a gap here would throw away the only frames that can measure depth.
    // The server range-checks the depth before it is believed.
    if (sideOn) return { verdict: 'side', x0: torso.x0, x1: torso.x1 };

    const lines = armLineAt(y).filter((x) => Number.isFinite(x));
    if (!lines.length) return { verdict: 'no-line' };
    const leftRuns = runs.filter((r) => r.x1 < torso.x0 - 1);
    const rightRuns = runs.filter((r) => r.x0 > torso.x1 + 1);
    const leftGap = leftRuns.length ? torso.x0 - Math.max(...leftRuns.map((r) => r.x1)) : 0;
    const rightGap = rightRuns.length ? Math.min(...rightRuns.map((r) => r.x0)) - torso.x1 : 0;
    const gapLeft = leftGap >= gapMinPx;
    const gapRight = rightGap >= gapMinPx;
    const lineLeft = lines.some((x) => x < torso.x0 - margin);
    const lineRight = lines.some((x) => x > torso.x1 + margin);
    const linesAllOutside = lines.every((x) => x < torso.x0 - margin || x > torso.x1 + margin);

    // Both edges pinned by a real gap and an arm line that agrees with it.
    if (gapLeft && gapRight && linesAllOutside && lineLeft && lineRight) {
      return { verdict: 'ok', x0: torso.x0, x1: torso.x1 };
    }
    // One clear side: mirror it. `centre` is the shoulder-line midpoint, taken
    // from the joints rather than the mask, so a stray blob cannot move it.
    if (gapLeft && lineLeft && !gapRight) {
      const half = Math.max(2, centre - torso.x0);
      return { verdict: 'one-side', x0: centre - half, x1: centre + half };
    }
    if (gapRight && lineRight && !gapLeft) {
      const half = Math.max(2, torso.x1 - centre);
      return { verdict: 'one-side', x0: centre - half, x1: centre + half };
    }
    return { verdict: 'no-gap' };
  };

  // ---- torso widths ----
  const usable = [];
  const widthSeries = [];
  const verdicts = {};
  const spanAt = new Map();
  for (let y = shoulderRow + 1; y <= hipRowLM; y += 1) {
    const runs = rowRuns(mask, maskW, maskH, y);
    const torso = runAt(runs, centre);
    // A row with no torso run — the legs have split, or the mask has a hole — is
    // missing, not zero-width. Recording it as zero would make the crotch line
    // win "narrowest torso" and hand back a waist at the hips.
    if (!torso) continue;
    const v = rowSpan(y, torso, runs);
    verdicts[v.verdict] = (verdicts[v.verdict] || 0) + 1;
    const hasSpan = Number.isFinite(v.x0) && Number.isFinite(v.x1);
    if (hasSpan) spanAt.set(y, { x0: v.x0, x1: v.x1 });
    // Rows we do not trust still go into the series at their raw width, so the
    // smoothed profile stays continuous for the searches below; they are just
    // not candidates to be measured from.
    widthSeries.push({ y, w: hasSpan ? v.x1 - v.x0 : torso.w });
    if (hasSpan) usable.push(y);
  }
  const smoothed = smooth(widthSeries.map((s) => s.w));
  const smoothedAt = new Map(widthSeries.map((s, i) => [s.y, smoothed[i]]));

  let chestRow = -1;
  let waistRow = -1;
  let hipRow = -1;
  if (usable.length >= 4) {
    const drop = Math.max(1, hipRowLM - shoulderRow);
    if (sideOn) {
      // Seen from the side the deepest point of the upper body is the deltoid,
      // so "widest row" would hand back shoulder depth as if it were chest depth.
      // The chest is read at the nipple line instead: a fixed way down from the
      // shoulder to the hip, which is where a tape goes too.
      chestRow = Math.round(shoulderRow + drop * 0.18);
    } else {
      // The chest is a ROW ON THE CHEST, and the arms have to be clear there. This
      // search used to begin at the first row where they were clear, which for
      // arms held against the body is a row down near the waist — and a waist
      // reported under the name "chest" is worse than a blank: it is a wrong
      // number that looks like a right one. So the band is the chest's own, from
      // just under the shoulder line to four tenths of the way to the hip.
      const chestFrom = shoulderRow + 3;
      const chestTo = Math.round(shoulderRow + drop * 0.42);
      let best = -1;
      for (const y of usable) {
        if (y < chestFrom) continue;
        if (y > chestTo) break;
        const v = smoothedAt.get(y) ?? 0;
        if (v > best) { best = v; chestRow = y; }
      }
      // A chest still widening at the bottom of its own band has its real widest
      // point below the band — behind an arm — so it is not a chest read at all.
      if (best < 0 || chestRow >= chestTo - 2) chestRow = -1;
    }
    // The waist is the narrowest row of the waist's own band: below the chest and
    // above the hips, which is where a natural waist falls. Searching the whole
    // torso lets a chest line or the crotch win the "narrowest" title.
    const waistFrom = Math.max(shoulderRow + Math.round(drop * 0.45), chestRow + 3);
    const waistTo = Math.round(shoulderRow + drop * 0.8);
    let least = Infinity;
    for (const y of usable) {
      if (y < waistFrom) continue;
      if (y > waistTo) break;
      const v = smoothedAt.get(y) ?? 0;
      if (v > 0 && v < least) { least = v; waistRow = y; }
    }
    const hipTo = crotchRow > 0 ? crotchRow : Math.min(botRow, hipRowLM + Math.round(maskH * 0.05));
    let widest = -1;
    // Only rows whose edges are actually known: a hip read off a run that still
    // has an arm in it is the person plus an arm.
    for (const y of usable) {
      if (y < waistRow + 2 || y > hipTo) continue;
      const v = smoothedAt.get(y) ?? 0;
      if (v > widest) { widest = v; hipRow = y; }
    }
  } else {
    unmeasured.push('torso');
  }
  // The armpit is where the arms first clear the torso. If that happens far down
  // the torso the arms were lying against the chest, and the chest band has no
  // clear row at all — so the chest is left out rather than read off the waist.
  const firstClear = sideOn ? -1 : (usable.length >= 4 ? usable[0] : -1);
  const torsoPx = Math.max(1, hipRowLM - shoulderRow);
  const armpitOffset = firstClear > 0 ? (firstClear - shoulderRow) / torsoPx : 0;
  if (firstClear > 0 && armpitOffset > 0.38) {
    notes.push('Your arms were close to your sides in some frames, so the tape could not pass around your chest there — hold them a little clear for the truest numbers.');
  }

  // ---- further named lines on the torso ----
  // Armscye line: the first row the arms clear WITHIN the chest's own band. A
  // clear row further down is not an armscye — it is the arms only leaving the
  // body at the waist, and calling it the armpit line would name a waist row
  // after the armpit.
  const upperChestRow = firstClear > 0 && (firstClear - shoulderRow) / torsoPx <= 0.42 ? firstClear : -1;
  // Underbust: a fixed third of the way down from the bust line to the waist,
  // which is where a tape goes. Positional, so it means the same line in every
  // frame rather than wherever a row happens to be narrowest.
  const underbustRow = chestRow > 0 && waistRow > chestRow + 3
    ? Math.round(lerp(chestRow, waistRow, 0.35)) : -1;
  // Lower waist: midway between the waist line and the hip line.
  const lowWaistRow = waistRow > 0 && hipRow > waistRow + 3
    ? Math.round(lerp(waistRow, hipRow, 0.5)) : -1;

  // ---- upper-arm width: the arm run midway between shoulder and elbow ----
  const armRow = Math.round(lerp(shoulderRow, elbowRow, 0.5));
  let armRun = null;
  if (elbowRow > shoulderRow + 4 && armRow > 0 && armRow < maskH) {
    const runs = rowRuns(mask, maskW, maskH, armRow);
    const torso = runAt(runs, centre);
    const outers = runs.filter((r) => !torso || r.x1 < torso.x0 - margin || r.x0 > torso.x1 + margin);
    if (outers.length) {
      const want = lerp(lm[11].x, lm[13].x, 0.5) * maskW;
      const near = outers.reduce((b, r) => {
        const d = Math.abs((r.x0 + r.x1) / 2 - want);
        return !b || d < b.d ? { r, d } : b;
      }, null);
      // An upper arm is never a sliver or a slab next to the shoulder: a run
      // that fails this is mask bleed (a dumbbell, a shadow) and is refused.
      const shoulderW = shoulderRun?.w ?? 0;
      const w = near ? near.r.w : 0;
      if (shoulderW > 0 && w >= shoulderW * 0.15 && w <= shoulderW * 0.5) armRun = near.r;
    }
    if (!armRun) unmeasured.push('arm');
  }

  // ---- head: the skull, not the hair ----
  // The silhouette's top row is the top of the HAIR. Since hair only ever adds
  // length above the skull, a crown-to-neck reading taken from the mask can only
  // come out too long — and because the head sets the scale, that shrinks every
  // other measurement. On one real clip the mask's head was 16% longer than the
  // true one and reported a grown adult as 137 cm tall.
  //
  // The pose's face gives a hair-free head length, so where it is available and
  // sane it wins; the hair-free reading is the smaller one by construction.
  const eyeRow = ((lm[2].y + lm[5].y) / 2) * maskH;
  const mouthRow = ((lm[9].y + lm[10].y) / 2) * maskH;
  const faceVis = Math.min(vis(2), vis(5), vis(9), vis(10));
  const maskHeadPx = neckRow > 0 ? (neckRow - topRow) * HEAD_NECK_RATIO : 0;
  const faceHeadPx = faceVis > 0.5 ? (mouthRow - eyeRow) * FACE_HEAD_FACTOR : 0;
  // A tilted head foreshortens eye-to-mouth, so a face reading far shorter than
  // the mask's is the tilting, not the hair: fall back rather than inflate. And a
  // face only a handful of pixels across cannot be measured at all.
  //
  // Finally the reading must survive an independent witness. The pose model's
  // own world-landmark scale is too soft to SET centimetres (it regresses toward
  // an average body — see metricScale) but it is a second opinion, and it is
  // measured from joints rather than from hair: when it agrees with the face, the
  // hair really is hair. When it does not, the frame is dropped back to the mask,
  // which is what the clips with short hair and no headwear already needed.
  const faceCmPerPx = faceHeadPx > 4 ? headCm / faceHeadPx : 0;
  const poseAgrees = poseScale && faceCmPerPx > 0
    && Math.abs(Math.log(faceCmPerPx / poseScale.cmPerPx)) < Math.log(1.15);
  const useFace = faceHeadPx > 4 && maskHeadPx > 4
    && (mouthRow - eyeRow) >= 12 && poseAgrees
    && faceHeadPx >= maskHeadPx * 0.6 && faceHeadPx <= maskHeadPx;
  const headHeightPx = useFace ? faceHeadPx : maskHeadPx;
  // With the face, the skull's top is half a head above the eye line; without it,
  // the mask's top row is the best available stand-in.
  const headTopRow = useFace
    ? Math.max(0, Math.round(eyeRow - headHeightPx / 2))
    : topRow;
  const chinRow = headHeightPx > 4 ? Math.round(headTopRow + headHeightPx) : -1;
  // With a face-measured head the crown-to-foot run becomes scale-free evidence:
  // an adult stands 7.1-7.9 heads tall, so a run of 5.8 heads is a body cut off
  // at the knees — a long skirt, a table — however plausible the ankle joints
  // look, because the pose will happily place ankles at the hem.
  const chainHeads = headHeightPx > 4 ? (botRow - headTopRow) / headHeightPx : 0;
  const bodyCropped = useFace && chainHeads > 0 && chainHeads < 6.6;

  // ---- landmarks, in the 0-100 scale the measurement engine reads ----
  const P = (xCol, yRow) => ({ x: r1((xCol / maskW) * 100), y: r1((yRow / maskH) * 100) });
  const landmarks = { headTop: P(centre, headTopRow) };
  if (chinRow > 0) landmarks.chin = P(centre, chinRow);
  if (shoulderRun) {
    landmarks.shoulderL = P(shoulderRun.x0, shoulderRow);
    landmarks.shoulderR = P(shoulderRun.x1, shoulderRow);
  }
  if (neckRow > 0) {
    const r = torsoAt(neckRow);
    if (r) { landmarks.neckL = P(r.x0, neckRow); landmarks.neckR = P(r.x1, neckRow); }
  }
  for (const [name, y, key] of [['chest', chestRow, 'armpit'], ['waist', waistRow, 'waist'], ['hips', hipRow, 'hip']]) {
    // The edges the row was actually measured from — which for a one-sided row
    // are mirrored across the body's centre line, not the mask run's edges.
    const edge = y > 0 ? spanAt.get(y) : null;
    if (!edge) continue;
    // A row pressed against the bottom of the frame is the frame's edge, not the
    // body's; and a "hip" with no leg split and no legs below it is a guess.
    if (!(y > shoulderRow + 2) || y > botRow - Math.round(maskH * 0.04)) continue;
    if (key === 'hip' && crotchRow <= 0 && botRow - y < maskH * 0.25) continue;
    landmarks[`${key}L`] = P(edge.x0, y);
    landmarks[`${key}R`] = P(edge.x1, y);
  }
  // Further named lines on the torso: the armscye line, the underbust line and
  // the lower waist. Each is the same measured span as the chest, waist and hips
  // — one more place a tape goes.
  for (const [name, y] of [['upperChest', upperChestRow], ['underbust', underbustRow], ['lowWaist', lowWaistRow]]) {
    const edge = y > 0 ? spanAt.get(y) : null;
    if (!edge) continue;
    // The armscye line sits right under the shoulder line, so unlike the rows
    // above there is no "too close to the shoulder" test here — only a row
    // pinned to the bottom of the frame is refused.
    if (y <= shoulderRow || y > botRow - 2) continue;
    landmarks[`${name}L`] = P(edge.x0, y);
    landmarks[`${name}R`] = P(edge.x1, y);
  }

  // Head breadth: the ears, not the hair. The mask's head run is hair-inclusive
  // at least as often as it is a skull (a headscarf, an afro), and a head
  // measured wide reports a head like a bucket. The pose's two ear landmarks sit
  // on the skull, so they are what the breadth is read from — and only from a
  // frame the head faces the camera in, because ears seen in profile overlap.
  if (!sideOn && vis(7) > 0.4 && vis(8) > 0.4) {
    const a = lm[7];
    const b = lm[8];
    const y = Math.round(((a.y + b.y) / 2) * maskH);
    const x0 = Math.min(a.x, b.x) * maskW;
    const x1 = Math.max(a.x, b.x) * maskW;
    // Widened to the skull on each side of the ears' own line.
    const mid = (x0 + x1) / 2;
    const half = ((x1 - x0) / 2) * HEAD_EAR_BREADTH_FACTOR;
    if (x1 - x0 >= 4) { landmarks.headL = P(mid - half, y); landmarks.headR = P(mid + half, y); }
  }

  if (armRun) { landmarks.armL = P(armRun.x0, armRow); landmarks.armR = P(armRun.x1, armRow); }

  const legsVisible = !feetCut || (vis(25) > 0.5 && vis(27) > 0.5);
  if (crotchRow > 0) landmarks.crotch = P(centre, crotchRow);
  if (!feetCut && !bodyCropped && vis(27) > 0.4 && vis(28) > 0.4) {
    const runs = rowRuns(mask, maskW, maskH, botRow - 1);
    if (runs.length >= 2) {
      landmarks.footL = P((runs[0].x0 + runs[0].x1) / 2, botRow);
      landmarks.footR = P((runs[runs.length - 1].x0 + runs[runs.length - 1].x1) / 2, botRow);
    } else if (runs.length === 1) {
      landmarks.footL = P(runs[0].x0 + runs[0].w * 0.25, botRow);
      landmarks.footR = P(runs[0].x0 + runs[0].w * 0.75, botRow);
    }
  }

  // ---- limbs ----
  // A limb is read the same way the torso is: the mask run at that row. The L/R
  // pair is emitted as one run's width around the mid-point of whatever limbs
  // were found, because it is the WIDTH that is wanted and a knee is a knee
  // whichever leg it is on. A run as wide as the body itself is both legs at
  // once — a skirt, or trousers loose enough to merge — and is refused here
  // rather than reported as a limb.
  const hipSpan = hipRow > 0 ? spanAt.get(hipRow) : null;
  const refW = shoulderRun?.w || (hipSpan ? hipSpan.x1 - hipSpan.x0 : 0) || maskW * 0.25;
  /** The limb run at one row, or null when nothing there is limb-sized. */
  const limbAt = (y, xs, { outside = false, maxFrac = 0.5 } = {}) => {
    const found = [];
    for (const x of xs) {
      const r = runNear(y, x, outside);
      if (!r || r.w < 2 || r.w > refW * maxFrac) continue;
      found.push(r);
    }
    if (!found.length) return null;
    found.sort((a, b) => a.w - b.w);
    const w = found[Math.floor(found.length / 2)].w;
    const mid = found.reduce((s, r) => s + (r.x0 + r.x1) / 2, 0) / found.length;
    return { w, mid };
  };
  const putLimb = (name, y, hit) => {
    if (!hit) return null;
    landmarks[`${name}L`] = P(hit.mid - hit.w / 2, y);
    landmarks[`${name}R`] = P(hit.mid + hit.w / 2, y);
    return hit.w;
  };

  if (elbowRow > shoulderRow + 6 && vis(13) > 0.4 && vis(14) > 0.4) {
    putLimb('elbow', elbowRow, limbAt(elbowRow, [lm[13].x * maskW, lm[14].x * maskW], { outside: true, maxFrac: 0.35 }));
  }
  if (vis(15) > 0.4 && vis(16) > 0.4) {
    const wristRow = Math.round(((lm[15].y + lm[16].y) / 2) * maskH);
    if (wristRow > elbowRow + 4 && wristRow < botRow) {
      // The wrist is the NARROWEST point between the elbow and the wrist joint.
      // The pose marks a joint, and the mask row under a joint is the forearm's
      // near end, which would report a wrist as thick as an arm.
      const xs = [lm[15].x * maskW, lm[16].x * maskW];
      let best = null;
      for (let y = elbowRow + 4; y <= wristRow; y += 1) {
        const hit = limbAt(y, xs, { outside: true, maxFrac: 0.2 });
        if (hit && (!best || hit.w < best.hit.w)) best = { y, hit };
      }
      if (best) putLimb('wrist', best.y, best.hit);
    }
  }

  const kneeRow = Math.round(((lm[25].y + lm[26].y) / 2) * maskH);
  // The legs are only read when the pose is sure of them and the body was not
  // cropped: a skirt hem looks exactly like a knee joint to a pose model.
  const legClean = !bodyCropped && vis(25) > 0.4 && vis(26) > 0.4 && vis(27) > 0.4 && vis(28) > 0.4
    && kneeRow > hipRowLM + 2 && ankleRow > kneeRow + 6;
  if (legClean) {
    const legXs = (t) => [lerp(lm[25].x, lm[27].x, t) * maskW, lerp(lm[26].x, lm[28].x, t) * maskW];
    for (const [name, t, maxFrac] of [['knee', 0, 0.5], ['calf', 0.35, 0.5], ['highAnkle', 0.78, 0.45]]) {
      const y = Math.round(lerp(kneeRow, ankleRow, t));
      putLimb(name, y, limbAt(y, legXs(t), { maxFrac }));
    }
    if (!feetCut) putLimb('ankle', ankleRow, limbAt(ankleRow, legXs(1), { maxFrac: 0.45 }));
  }

  // Joint points, for anything measured ALONG a limb: a sleeve length is a tape
  // from the shoulder point to the wrist bone, not a width. Only joints the pose
  // is sure of are sent — a confident-looking sleeve length off a guessed wrist
  // would be a fabricated number.
  for (const [name, i] of [['shoulderJL', 11], ['shoulderJR', 12], ['elbowJL', 13], ['elbowJR', 14], ['wristJL', 15], ['wristJR', 16], ['kneeJL', 25], ['kneeJR', 26]]) {
    if (vis(i) > 0.4) landmarks[name] = P(lm[i].x * maskW, lm[i].y * maskH);
  }
  if (neckRow > 0) {
    const r = torsoAt(neckRow);
    if (r) landmarks.nape = P((r.x0 + r.x1) / 2, neckRow);
  }

  // ---- which way the person is facing (detected near the top, before widths) ----

  const visible = {
    // A cropped crown is still a usable head when the face gave the length.
    head: chinRow > 0 && (!headCut || useFace),
    torso: shoulderRow > 0 && (shoulderRun?.w ?? 0) > 4,
    hips: hipRow > 0 && crotchRow > 0,
    legs: crotchRow > 0 && legsVisible && vis(25) > 0.4,
    feet: !feetCut && !bodyCropped && Math.min(vis(27), vis(28)) > 0.4,
  };
  // Height is decided by the server from the landmarks it receives; if the feet
  // are missing it says so itself, so no note is written here.

  const keyVis = [11, 12, 13, 14, 23, 24, 25, 26, 27, 28].map(vis);
  const confidence = clamp01(keyVis.reduce((s, x) => s + x, 0) / keyVis.length);

  /** The width actually measured at a row: the mirrored span where one applied. */
  const measuredWidth = (y) => {
    const e = spanAt.get(y);
    return e ? e.x1 - e.x0 : (y > 0 ? widthAt(y) : null);
  };

  return {
    landmarks,
    visible,
    view,
    gender,
    confidence,
    notes,
    unmeasured,
    debug: {
      topRow, botRow, neckRow, chinRow, shoulderRow, elbowRow, armRow, hipRowLM, crotchRow,
      usableRows: usable.length,
      verdicts,
      rows: { chestRow, waistRow, hipRow, upperChestRow, underbustRow, lowWaistRow, kneeRow },
      widths: {
        shoulder: shoulderRun?.w ?? null,
        neck: neckRow > 0 ? widthAt(neckRow) : null,
        // The span actually measured — mirrored, where a one-sided row applied.
        chest: chestRow > 0 ? measuredWidth(chestRow) : null,
        waist: waistRow > 0 ? measuredWidth(waistRow) : null,
        hips: hipRow > 0 ? measuredWidth(hipRow) : null,
        arm: armRun ? armRun.w : null,
      },
      headHeightPx,
      headPx: {
        from: useFace ? 'face' : 'mask',
        mask: maskHeadPx ? r1(maskHeadPx) : null,
        face: faceHeadPx ? r1(faceHeadPx) : null,
        topRow: headTopRow,
      },
      headCmPerWidth: headHeightPx > 0 ? (headCm / headHeightPx) * maskW : null,
      headCm,
      poseCmPerWidth: poseScale ? poseScale.cmPerPx * imgW : null,
      poseSpread: poseScale ? poseScale.spread : null,
      mask: [maskW, maskH],
      img: [imgW, imgH],
    },
  };
}
