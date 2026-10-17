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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('failed: ' + failures.join(', '));
  process.exit(1);
}
