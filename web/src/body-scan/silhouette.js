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
/** How far an arm's joint line must clear the torso before its row counts. */
const ARM_MARGIN_FRAC = 0.015;

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

  // ---- extent of the silhouette ----
  let topRow = -1;
  let botRow = -1;
  for (let y = 0; y < maskH; y += 1) if (rowRuns(mask, maskW, maskH, y).length) { topRow = y; break; }
  for (let y = maskH - 1; y >= 0; y -= 1) if (rowRuns(mask, maskW, maskH, y).length) { botRow = y; break; }
  if (topRow < 0) return null;

  const headCut = topRow <= 1;
  // Feet are "out of shot" when the silhouette runs into the bottom edge — or,
  // more subtly, when the pose is sure where the ankles are and the silhouette
  // stops well above them. That second case is a body cropped by the frame, and
  // claiming a foot there would invent both a foot and a height.
  const ankleRow = Math.round((lm[27].y + lm[28].y) / 2 * maskH);
  const ankleTrusted = Math.min(vis(27), vis(28)) > 0.5;
  const feetCut = botRow >= maskH - 2
    || (ankleTrusted && ankleRow > 0 && botRow < ankleRow - maskH * 0.03);

  // ---- joint rows/columns, straight from the pose ----
  const shoulderRow = row((lm[11].y + lm[12].y) / 2);
  const elbowRow = row((lm[13].y + lm[14].y) / 2);
  const hipRowLM = Math.min(maskH - 1, row((lm[23].y + lm[24].y) / 2));
  const centre = Math.round(((lm[11].x + lm[12].x) / 2) * maskW);
  if (!(shoulderRow > topRow + 6)) return null;

  /**
   * Which way the person is facing, from the shoulder line in 3D. Needed before
   * the widths are read, because a side-on frame is measured differently: see
   * rowVerdict().
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
  /** Why a row did or did not count, so a refusal can be diagnosed later. */
  const rowVerdict = (y, torso, runs) => {
    if (!torso || torso.w < 3) return 'no-torso';
    // Side-on, the arm hangs across the torso and the two are one blob in the
    // picture. The horizontal span of that blob IS the body's depth, so asking
    // for a gap here would throw away the only frames that can measure depth.
    // The server range-checks the depth before it is believed.
    if (sideOn) return 'side';
    // There must be silhouette on BOTH sides of the torso run. Without this, a
    // pair of arms lying flat against the body is one blob and every joint line
    // "clears" a torso run that actually contains the arms.
    const left = runs.some((r) => r.x1 < torso.x0 - 1);
    const right = runs.some((r) => r.x0 > torso.x1 + 1);
    if (!left || !right) return 'no-gap';
    const lines = armLineAt(y);
    if (lines.length < 2) return 'no-line';
    return lines.every((x) => x < torso.x0 - margin || x > torso.x1 + margin) ? 'ok' : 'arm-over-torso';
  };

  // ---- torso widths ----
  const usable = [];
  const widthSeries = [];
  const verdicts = {};
  for (let y = shoulderRow + 1; y <= hipRowLM; y += 1) {
    const runs = rowRuns(mask, maskW, maskH, y);
    const torso = runAt(runs, centre);
    // A row with no torso run — the legs have split, or the mask has a hole — is
    // missing, not zero-width. Recording it as zero would make the crotch line
    // win "narrowest torso" and hand back a waist at the hips.
    if (!torso) continue;
    widthSeries.push({ y, w: torso.w });
    const verdict = rowVerdict(y, torso, runs);
    verdicts[verdict] = (verdicts[verdict] || 0) + 1;
    if (verdict === 'ok' || verdict === 'side') usable.push(y);
  }
  const smoothed = smooth(widthSeries.map((s) => s.w));
  const smoothedAt = new Map(widthSeries.map((s, i) => [s.y, smoothed[i]]));

  let chestRow = -1;
  let waistRow = -1;
  let hipRow = -1;
  if (usable.length >= 4) {
    const first = usable[0];
    if (sideOn) {
      // Seen from the side the deepest point of the upper body is the deltoid,
      // so "widest row" would hand back shoulder depth as if it were chest depth.
      // The chest is read at the nipple line instead: a fixed way down from the
      // shoulder to the hip, which is where a tape goes too.
      chestRow = Math.round(shoulderRow + (hipRowLM - shoulderRow) * 0.18);
    } else {
      const chestTo = Math.min(hipRowLM, Math.round(first + (hipRowLM - first) * 0.45));
      let best = -1;
      for (const y of usable) {
        if (y > chestTo) break;
        const v = smoothedAt.get(y) ?? 0;
        if (v > best) { best = v; chestRow = y; }
      }
      // A chest that only gets wider as far down as the search allows means the
      // real widest point is hidden behind an arm, so it is not a chest measure.
      // (The row cannot sit on the shoulder line either: nothing is measured that
      // close to it, so such a row would be silently discarded later.) No note is
      // raised here — the server words the gap from which regions came out blank,
      // and a note from one frame could otherwise contradict a chest read from
      // another.
      if (chestRow >= chestTo - 2 || chestRow <= shoulderRow + 2) chestRow = -1;
    }
    let least = Infinity;
    for (const y of usable) {
      if (y <= Math.max(chestRow, first) + 2) continue;
      const v = smoothedAt.get(y) ?? 0;
      if (v > 0 && v < least) { least = v; waistRow = y; }
    }
    const hipTo = crotchRow > 0 ? crotchRow : Math.min(botRow, hipRowLM + Math.round(maskH * 0.05));
    let widest = -1;
    for (let y = waistRow + 2; y <= hipTo; y += 1) {
      const v = smoothedAt.get(y) ?? 0;
      if (v > widest) { widest = v; hipRow = y; }
    }
  } else {
    unmeasured.push('torso');
  }
  // The armpit is where the arms first clear the torso. If that happens far down
  // the torso, the arms were lying against the chest and the widths below are
  // read lower than they should be — say so rather than hide it.
  const firstClear = sideOn ? -1 : (usable.length >= 4 ? usable[0] : -1);
  const torsoPx = Math.max(1, hipRowLM - shoulderRow);
  const armpitOffset = firstClear > 0 ? (firstClear - shoulderRow) / torsoPx : 0;
  if (firstClear > 0 && armpitOffset > 0.38) {
    notes.push('In some frames your arms were close to your sides, so those readings came from lower down the torso — hold your arms a little clear for the truest numbers.');
  }

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

  // ---- head: crown from the mask, chin from the crown-to-neck ratio ----
  const headHeightPx = neckRow > 0 ? (neckRow - topRow) * HEAD_NECK_RATIO : 0;
  const chinRow = headHeightPx > 4 ? Math.round(topRow + headHeightPx) : -1;

  // ---- landmarks, in the 0-100 scale the measurement engine reads ----
  const P = (xCol, yRow) => ({ x: r1((xCol / maskW) * 100), y: r1((yRow / maskH) * 100) });
  const landmarks = { headTop: P(centre, topRow) };
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
    const r = y > 0 ? torsoAt(y) : null;
    if (!r) continue;
    // A row pressed against the bottom of the frame is the frame's edge, not the
    // body's; and a "hip" with no leg split and no legs below it is a guess.
    if (!(y > shoulderRow + 2) || y > botRow - Math.round(maskH * 0.04)) continue;
    if (key === 'hip' && crotchRow <= 0 && botRow - y < maskH * 0.25) continue;
    landmarks[`${key}L`] = P(r.x0, y);
    landmarks[`${key}R`] = P(r.x1, y);
  }
  if (armRun) { landmarks.armL = P(armRun.x0, armRow); landmarks.armR = P(armRun.x1, armRow); }

  const legsVisible = !feetCut || (vis(25) > 0.5 && vis(27) > 0.5);
  if (crotchRow > 0) landmarks.crotch = P(centre, crotchRow);
  if (!feetCut && vis(27) > 0.4 && vis(28) > 0.4) {
    const runs = rowRuns(mask, maskW, maskH, botRow - 1);
    if (runs.length >= 2) {
      landmarks.footL = P((runs[0].x0 + runs[0].x1) / 2, botRow);
      landmarks.footR = P((runs[runs.length - 1].x0 + runs[runs.length - 1].x1) / 2, botRow);
    } else if (runs.length === 1) {
      landmarks.footL = P(runs[0].x0 + runs[0].w * 0.25, botRow);
      landmarks.footR = P(runs[0].x0 + runs[0].w * 0.75, botRow);
    }
  }

  // ---- which way the person is facing (detected near the top, before widths) ----

  const visible = {
    head: !headCut && chinRow > 0,
    torso: shoulderRow > 0 && (shoulderRun?.w ?? 0) > 4,
    hips: hipRow > 0 && crotchRow > 0,
    legs: crotchRow > 0 && legsVisible && vis(25) > 0.4,
    feet: !feetCut && Math.min(vis(27), vis(28)) > 0.4,
  };
  // Height is decided by the server from the landmarks it receives; if the feet
  // are missing it says so itself, so no note is written here.

  const keyVis = [11, 12, 13, 14, 23, 24, 25, 26, 27, 28].map(vis);
  const confidence = clamp01(keyVis.reduce((s, x) => s + x, 0) / keyVis.length);

  const poseScale = metricScale({ lm, world, imgW, imgH });

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
      rows: { chestRow, waistRow, hipRow },
      widths: {
        shoulder: shoulderRun?.w ?? null,
        neck: neckRow > 0 ? widthAt(neckRow) : null,
        chest: chestRow > 0 ? widthAt(chestRow) : null,
        waist: waistRow > 0 ? widthAt(waistRow) : null,
        hips: hipRow > 0 ? widthAt(hipRow) : null,
        arm: armRun ? armRun.w : null,
      },
      headHeightPx,
      headCmPerWidth: headHeightPx > 0 ? (23.5 / headHeightPx) * maskW : null,
      poseCmPerWidth: poseScale ? poseScale.cmPerPx * imgW : null,
      poseSpread: poseScale ? poseScale.spread : null,
      mask: [maskW, maskH],
      img: [imgW, imgH],
    },
  };
}
