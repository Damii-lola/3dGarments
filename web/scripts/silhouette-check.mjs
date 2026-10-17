/**
 * Exact checks for the on-device silhouette measurement.
 *
 * silhouette.js is deliberately pure — a Float32 mask plus pose joints in, plain
 * numbers out — so the whole thing can be exercised on a synthetic body with a
 * known answer. The masks below are drawn to one shape, so every expected width
 * is arithmetic, not opinion.
 *
 * Run: node scripts/silhouette-check.mjs
 */
import { measureSilhouette } from '../src/body-scan/silhouette.js';

const W = 200;
const H = 400;

let passed = 0;
const failures = [];

function check(name, got, want, tol = 1.5) {
  const ok = typeof want === 'number'
    ? Number.isFinite(got) && Math.abs(got - want) <= tol
    : Object.is(got, want);
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}  ${typeof got === 'number' ? got.toFixed(1) : got}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}  got ${typeof got === 'number' ? got.toFixed(1) : got}  want ${want}`);
  }
}

const blank = () => new Float32Array(W * H);
const fill = (m, y0, y1, x0, x1, v = 0.9) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (y >= 0 && y < H && x >= 0 && x < W) m[y * W + x] = v;
};
/** A band whose left and right edges move linearly between two rows. */
const taper = (m, y0, y1, x0a, x1a, x0b, x1b, v = 0.9) => {
  for (let y = y0; y <= y1; y += 1) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const x0 = Math.round(x0a + (x0b - x0a) * t);
    const x1 = Math.round(x1a + (x1b - x1a) * t);
    for (let x = x0; x <= x1; x += 1) m[y * W + x] = v;
  }
};

/**
 * One synthetic body, in mask rows:
 *   crown taper 20-24, head 25-69 (cols 90-110), neck 70-79 (94-106),
 *   shoulders 80 -> waist 160 (60-140 narrowing to 75-125), hips 161-199
 *   (widening back out to 70-130), legs 200-379 split at cols 96|104.
 * Arms are added by the caller.
 */
function body({ armsClear }) {
  const m = blank();
  fill(m, 20, 24, 95, 105);
  fill(m, 25, 69, 90, 110);
  fill(m, 70, 79, 94, 106);
  taper(m, 80, 160, 60, 140, 75, 125);
  taper(m, 161, 199, 75, 125, 70, 130);
  if (armsClear) {
    fill(m, 85, 170, 40, 54);
    fill(m, 85, 170, 146, 160);
  } else {
    // Arms pressed to the sides: one solid band, no gap to find.
    fill(m, 85, 170, 40, 160);
  }
  fill(m, 200, 379, 72, 96);
  fill(m, 200, 379, 104, 128);
  return m;
}

/** Only the joints silhouette.js reads, placed on the drawn body. */
function joints() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const put = (i, x, y, visibility = 1) => { lm[i] = { x, y, visibility }; };
  put(11, 0.40, 0.20); // left shoulder    (col 80, row 80)
  put(12, 0.60, 0.20);
  put(13, 0.235, 0.42); // left elbow      (col 47, row 168 — over the arm)
  put(14, 0.765, 0.42);
  put(23, 0.44, 0.50); // left hip
  put(24, 0.56, 0.50);
  put(25, 0.43, 0.75); // left knee
  put(26, 0.57, 0.75);
  put(27, 0.42, 0.94); // left ankle
  put(28, 0.58, 0.94);
  return lm;
}

/**
 * Shoulder line turned 90°, i.e. one shoulder directly in front of the other, so
 * the shoulder joints are nearly coincident in x and far apart in z.
 */
function sideWorld() {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  w[11] = { x: 0, y: 0, z: 0 };
  w[12] = { x: 0.05, y: 0, z: 0.40 };
  w[23] = { x: 0, y: 0, z: 0 };
  w[24] = { x: 0.05, y: 0, z: 0.30 };
  return w;
}

/**
 * The same person seen from the side: one continuous blob, arm against the body.
 * The horizontal span of that blob is the body's DEPTH, so chest depth here is
 * 61 px (cols 70-130) narrowing to 41 px at the waist.
 */
function sideBody() {
  const m = blank();
  fill(m, 20, 24, 95, 105);
  fill(m, 25, 69, 90, 110);
  fill(m, 70, 79, 94, 106);
  taper(m, 80, 160, 70, 130, 80, 120);
  taper(m, 161, 199, 80, 120, 76, 124);
  fill(m, 200, 379, 72, 96);
  fill(m, 200, 379, 104, 128);
  return m;
}

const run = (mask, world) => measureSilhouette({ mask, maskW: W, maskH: H, lm: joints(), world, imgW: W, imgH: H });

/**
 * World landmarks consistent with a 0.522 cm pixel — the scale the synthetic
 * head implies (45 px of head for 23.5 cm). metricScale turns these back into the
 * same cm/px, which is what the pose-scale cross-check needs to corroborate a
 * face-measured head.
 */
const agreeWorld = (lm) => lm.map((p) => ({ x: p.x * W * 0.00522, y: p.y * H * 0.00522, z: 0 }));

const span = (r, a, b) => Math.abs(r.landmarks[a].x - r.landmarks[b].x);
const yOf = (r, k) => r.landmarks[k].y;

console.log('\n— arms clear of the sides —');
const clear = run(body({ armsClear: true }));
if (!clear) {
  console.log('  FAIL returned null');
  failures.push('null');
} else {
  check('head top at the crown', yOf(clear, 'headTop'), 5, 1);
  check('chin below the head top, above the neck', yOf(clear, 'chin') > yOf(clear, 'headTop') && yOf(clear, 'chin') < yOf(clear, 'neckL'), true);
  check('body runs down in order', yOf(clear, 'neckL') < yOf(clear, 'shoulderL')
    && yOf(clear, 'shoulderL') < yOf(clear, 'armpitL')
    && yOf(clear, 'armpitL') < yOf(clear, 'waistL')
    && yOf(clear, 'waistL') < yOf(clear, 'hipL'), true);
  check('shoulder span (81 px of 200)', span(clear, 'shoulderL', 'shoulderR'), 40.5, 2);
  check('neck span (13 px)', span(clear, 'neckL', 'neckR'), 6.5, 1.5);
  check('upper arm span (15 px)', span(clear, 'armL', 'armR'), 7.5, 1.5);
  check('chest narrower than shoulders', span(clear, 'armpitL', 'armpitR') < span(clear, 'shoulderL', 'shoulderR'), true);
  check('waist narrower than chest', span(clear, 'waistL', 'waistR') < span(clear, 'armpitL', 'armpitR'), true);
  check('hips wider than waist', span(clear, 'hipL', 'hipR') > span(clear, 'waistL', 'waistR'), true);
  check('legs and feet believed visible', clear.visible.legs && clear.visible.feet, true);
  check('feet sit below the crotch', yOf(clear, 'footL') > yOf(clear, 'crotch'), true);
  check('no caveats raised', clear.notes.length, 0);
  check('nothing reported unmeasurable', clear.unmeasured.length, 0);
}

console.log('\n— arms pressed against the body —');
const glued = run(body({ armsClear: false }));
if (!glued) {
  console.log('  FAIL returned null');
  failures.push('null-glued');
} else {
  check('chest measure refused', glued.landmarks.armpitL === undefined, true);
  check('arm measure refused', glued.landmarks.armL === undefined, true);
  check('shoulder and neck still measured', Boolean(glued.landmarks.shoulderL && glued.landmarks.neckL), true);
  check('reports the torso as unmeasurable', glued.unmeasured.includes('torso'), true);
  check('reports the arm as unmeasurable', glued.unmeasured.includes('arm'), true);
}

console.log('\n— side-on frame: the arm hangs over the torso, one blob —');
const side = run(sideBody(), sideWorld());
if (!side) {
  console.log('  FAIL returned null');
  failures.push('null-side');
} else {
  check('facing is detected as side-on', side.view, 'side');
  check('torso is measurable (not refused for merged arms)', side.unmeasured.includes('torso'), false);
  check('chest depth read at the nipple line, not the deltoid (54 px)', span(side, 'armpitL', 'armpitR'), 27, 2);
  check('waist depth narrower than chest depth', span(side, 'waistL', 'waistR') < span(side, 'armpitL', 'armpitR'), true);
  check('hip depth measured', Boolean(side.landmarks.hipL && side.landmarks.hipR), true);
  check('no arms-not-clear caveat side-on', side.notes.some((n) => /arms were close/.test(n)), false);
}

console.log('\n— one arm clear, the other against the ribs —');
// The same body, with the right arm pressed back on: a gap on the left only.
// That is the common frame of a real turn, and the left edge alone is enough.
const oneSideMask = body({ armsClear: true });
fill(oneSideMask, 85, 170, 100, 146);
const oneSide = run(oneSideMask);
if (!oneSide) {
  console.log('  FAIL returned null');
  failures.push('null-one-side');
} else {
  check('the clear side is still measured', Boolean(oneSide.landmarks.armpitL && oneSide.landmarks.armpitR), true);
  check('torso not reported unmeasurable', oneSide.unmeasured.includes('torso'), false);
  check('one-sided rows were recognised', (oneSide.debug.verdicts['one-side'] || 0) > 0, true);
  check('mirrored row matches the two-gap answer', span(oneSide, 'armpitL', 'armpitR'), span(clear, 'armpitL', 'armpitR'), 0.6);
  check('waist still narrower than chest', span(oneSide, 'waistL', 'waistR') < span(oneSide, 'armpitL', 'armpitR'), true);
}

console.log('\n— feet out of shot —');
const cropped = blank();
{
  const src = body({ armsClear: true });
  // Keep only the top 55%: no legs, no feet.
  cropped.set(src.subarray(0, Math.round(H * 0.55) * W));
}
const cut = run(cropped);
if (!cut) {
  console.log('  FAIL returned null');
  failures.push('null-cut');
} else {
  check('feet not claimed visible', cut.visible.feet, false);
  check('no foot landmarks', cut.landmarks.footL === undefined, true);
  check('head still measured', Boolean(cut.landmarks.headTop && cut.landmarks.neckL), true);
}

console.log('\n— the silhouette stops above the ankles (a skirt hem, a knee crop) —');
// The frame still contains the ankle joints, so nothing runs off the edge; the
// mask simply never reaches them. The height chain used to run down to them
// anyway, once for a confident ankle and once for a half-believed one.
const hemMask = blank();
{
  const src = body({ armsClear: true });
  hemMask.set(src.subarray(0, Math.round(H * 0.70) * W));
}
const hem = run(hemMask);
if (!hem) {
  console.log('  FAIL returned null');
  failures.push('null-hem');
} else {
  check('feet not claimed visible off the silhouette', hem.visible.feet, false);
  check('no foot landmarks placed off the body', hem.landmarks.footL === undefined, true);
  check('head and torso still measured', Boolean(hem.landmarks.headTop && hem.landmarks.armpitL), true);
}
// The real clip's case: the pose put the ankles in mid-air with a visibility
// just over the "visible" threshold, which the old visibility guard let through.
const halfJoints = joints();
halfJoints[27] = { ...halfJoints[27], visibility: 0.45 };
halfJoints[28] = { ...halfJoints[28], visibility: 0.45 };
const hemLow = measureSilhouette({ mask: hemMask, maskW: W, maskH: H, lm: halfJoints, imgW: W, imgH: H });
check('a half-seen ankle below the silhouette is refused', hemLow.visible.feet, false);
check('and no height can be built from it', hemLow.landmarks.footL === undefined, true);

console.log('\n— a head of hair above the skull —');
// The same body under hair that reaches 17 px above the skull. The mask's
// crown-to-neck reading is then far too long (which is what shrank one real
// clip's scale by 16% and reported a grown adult at 137 cm). The pose's face
// still reports the drawn head: eyes at row 47 (the head's midpoint), mouth at
// 62, so 3 x (62 - 47) = 45 px, exactly the head's drawn length.
function hairyBody() {
  const m = body({ armsClear: true });
  fill(m, 8, 24, 86, 114);
  return m;
}
const hairyLM = joints();
hairyLM[2] = { x: 0.5, y: 47 / H, visibility: 1 };  // left eye
hairyLM[5] = { x: 0.5, y: 47 / H, visibility: 1 };  // right eye
hairyLM[9] = { x: 0.5, y: 62 / H, visibility: 1 };  // mouth
hairyLM[10] = { x: 0.5, y: 62 / H, visibility: 1 };
const hair = measureSilhouette({ mask: hairyBody(), maskW: W, maskH: H, lm: hairyLM, world: agreeWorld(hairyLM), imgW: W, imgH: H });
check('head read from the face, not the hair', hair.debug.headPx.from, 'face');
check('head length is the drawn head (45 px of 200)', hair.debug.headHeightPx, 45, 2);
check('the crown is the skull, not the top of the hair', yOf(hair, 'headTop'), 6.3, 0.6);
check('the hair-based reading would have been longer', hair.debug.headPx.mask > hair.debug.headHeightPx + 4, true);

console.log('\n— ankles dreamt up at the hem of a long skirt —');
// The pose places the ankles right at the hem, so nothing looks "cut off" against
// the silhouette and the joints are fully confident. Only the head-to-chain
// proportion gives it away: 5.7 heads is not a standing adult.
const hemLM = joints();
hemLM[2] = { x: 0.5, y: 47 / H, visibility: 1 };
hemLM[5] = { x: 0.5, y: 47 / H, visibility: 1 };
hemLM[9] = { x: 0.5, y: 62 / H, visibility: 1 };
hemLM[10] = { x: 0.5, y: 62 / H, visibility: 1 };
hemLM[27] = { x: 0.42, y: 280 / H, visibility: 1 };
hemLM[28] = { x: 0.58, y: 280 / H, visibility: 1 };
const skirtBody = blank();
skirtBody.set(hairyBody().subarray(0, 281 * W));
const skirt = measureSilhouette({ mask: skirtBody, maskW: W, maskH: H, lm: hemLM, world: agreeWorld(hemLM), imgW: W, imgH: H });
check('the height is refused, not faked', skirt.visible.feet, false);
check('no foot landmarks', skirt.landmarks.footL === undefined, true);
check('the torso is still measured', Boolean(skirt.landmarks.armpitL), true);

console.log('\n— the named lines a tailor\'s sheet asks for —');
// The same body with everything the catalogue can read: ears for the head's
// breadth, wrists, and the arm carried down past the hip so the wrist row is on
// the arm and not on the torso.
function limbBody() {
  const m = body({ armsClear: true });
  fill(m, 171, 200, 40, 54);
  fill(m, 171, 200, 146, 160);
  return m;
}
function fullJoints() {
  const lm = joints();
  lm[7] = { x: 0.44, y: 0.12, visibility: 1 };   // left ear  (col 88, row 48)
  lm[8] = { x: 0.56, y: 0.12, visibility: 1 };   // right ear (col 112)
  lm[15] = { x: 0.235, y: 0.45, visibility: 1 }; // left wrist  (col 47, row 180)
  lm[16] = { x: 0.765, y: 0.45, visibility: 1 };
  return lm;
}
const full = measureSilhouette({ mask: limbBody(), maskW: W, maskH: H, lm: fullJoints(), world: agreeWorld(fullJoints()), imgW: W, imgH: H });
check('the head is read across the ears, widened to the skull', span(full, 'headL', 'headR'), 13.4, 1.5);
check('and sits at the ear row', yOf(full, 'headL'), 12, 1.5);
check('an armscye line is read at the first row the arms clear', Boolean(full.landmarks.upperChestL), true);
check('and never sits below the chest line', yOf(full, 'upperChestL') <= yOf(full, 'armpitL'), true);
check('underbust between the chest and the waist', yOf(full, 'armpitL') < yOf(full, 'underbustL') && yOf(full, 'underbustL') < yOf(full, 'waistL'), true);
check('lower waist between the waist and the hips', yOf(full, 'waistL') < yOf(full, 'lowWaistL') && yOf(full, 'lowWaistL') < yOf(full, 'hipL'), true);
check('the elbow is one arm across (14 px)', span(full, 'elbowL', 'elbowR'), 7, 1.5);
check('the wrist is one arm across', span(full, 'wristL', 'wristR'), 7, 1.5);
check('the knee is one leg across (24 px)', span(full, 'kneeL', 'kneeR'), 12, 1.5);
check('calf, high ankle and ankle too', Boolean(full.landmarks.calfL && full.landmarks.highAnkleL && full.landmarks.ankleL), true);
check('the leg lines run knee -> calf -> ankle', yOf(full, 'kneeL') < yOf(full, 'calfL') && yOf(full, 'calfL') < yOf(full, 'highAnkleL') && yOf(full, 'highAnkleL') < yOf(full, 'ankleL'), true);
check('joint points for a sleeve: shoulder, elbow, wrist', Boolean(full.landmarks.shoulderJL && full.landmarks.elbowJL && full.landmarks.wristJL), true);
check('the nape is the middle of the neck', Math.abs(full.landmarks.nape.x - full.landmarks.neckL.x - (span(full, 'neckL', 'neckR') / 2)) < 0.01, true);

// Both legs inside one run — a wide skirt, or trousers loose enough to merge.
// The run is as wide as the body, which is not a knee, so no knee is reported.
const merged = body({ armsClear: true });
fill(merged, 200, 379, 72, 128);
const mergedRun = measureSilhouette({ mask: merged, maskW: W, maskH: H, lm: fullJoints(), imgW: W, imgH: H });
check('legs merged into one run are not a knee', mergedRun.landmarks.kneeL === undefined, true);
check('but the torso is still read', Boolean(mergedRun.landmarks.armpitL), true);

// A side-on frame: the ears overlap in x and the head's breadth is not visible.
const sideEars = measureSilhouette({ mask: sideBody(), maskW: W, maskH: H, lm: fullJoints(), world: sideWorld(), imgW: W, imgH: H });
check('no head breadth claimed from a side-on head', sideEars.landmarks.headL === undefined, true);

// Arm hanging against the ribs: one blob with the torso, so no elbow.
const gluedArm = measureSilhouette({ mask: body({ armsClear: false }), maskW: W, maskH: H, lm: fullJoints(), imgW: W, imgH: H });
check('an arm that is one blob with the torso is not an elbow', gluedArm.landmarks.elbowL === undefined, true);

// A forearm that narrows toward the wrist — which is what a forearm does. The
// widest row under the wrist joint is the forearm's near end, so the wrist has to
// be taken as the narrowest point between the elbow and the joint.
function taperArmBody() {
  const m = body({ armsClear: true });
  for (let y = 150; y <= 205; y += 1) {
    for (let x = 20; x < 58; x += 1) m[y * W + x] = 0;
    for (let x = 143; x <= 180; x += 1) m[y * W + x] = 0;
  }
  taper(m, 150, 180, 40, 64, 46, 58);
  taper(m, 150, 180, 136, 160, 142, 154);
  return m;
}
const taperRun = measureSilhouette({ mask: taperArmBody(), maskW: W, maskH: H, lm: fullJoints(), imgW: W, imgH: H });
check('the elbow is read at its own row (16 px)', span(taperRun, 'elbowL', 'elbowR'), 8, 1);
check('the wrist is the narrowest point of the forearm (12 px), not the joint row', span(taperRun, 'wristL', 'wristR'), 6, 1);
check('and it sits above the wrist joint', yOf(taperRun, 'wristL') <= yOf(taperRun, 'wristJL') + 0.01, true);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('failed: ' + failures.join(', '));
  process.exit(1);
}
