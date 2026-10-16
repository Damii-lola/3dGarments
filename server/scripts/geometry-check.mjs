/**
 * Worked examples for the body-scan geometry.
 *
 * We build frames for people whose real measurements we know, hand them to the
 * same functions the API uses, and check the numbers that come back. Run with:
 *
 *   node scripts/geometry-check.mjs
 */

import {
  checkFrame,
  ellipsePerimeter,
  frameScale,
  measureHeight,
  measureRegion,
  normalizeLandmarks,
  toIn,
} from '../src/lib/bodyGeometry.js';

let pass = 0;
let fail = 0;

function check(name, actual, expected, tol) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) pass += 1; else fail += 1;
  const shown = Number.isFinite(actual) ? actual.toFixed(2) : String(actual);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} got ${shown.padStart(7)}  expected ${expected.toFixed(2)} +/-${tol}`);
}

function checkTrue(name, cond, detail = '') {
  if (cond) pass += 1; else fail += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}

/** A male exactly 7.5 head-heights tall (176.25 cm, 23.5 cm head), 3:4 frame. */
function frontFrame(overrides = {}) {
  const aspect = 0.75;
  const headY = 0.095; // head height as a fraction of image height
  const cmPerWidth = 23.5 / (headY / aspect); // 185.53 cm per image width
  const P = (cm) => cm / cmPerWidth; // cm -> image widths
  const headTopY = 0.06;

  const pair = (cm, y, cx = 0.5) => ({ L: { x: cx - P(cm) / 2, y }, R: { x: cx + P(cm) / 2, y } });
  const neck = pair(12, 0.20);
  const shoulders = pair(46, 0.24);
  const chest = pair(38, 0.30);
  const arm = pair(11, 0.30, 0.34);
  const waist = pair(33, 0.38);
  const hips = pair(36, 0.46);
  const footY = headTopY + P(176.25) * aspect; // 7.5 head-heights tall

  return {
    view: 'front',
    gender: 'male',
    aspect,
    confidence: 0.8,
    camera: { sharpness: 0.8, lighting: 0.8 },
    visible: { head: true, torso: true, hips: true, legs: true, feet: true },
    references: [],
    landmarks: {
      headTop: { x: 0.5, y: headTopY },
      chin: { x: 0.5, y: headTopY + headY },
      neckL: neck.L, neckR: neck.R,
      shoulderL: shoulders.L, shoulderR: shoulders.R,
      armpitL: chest.L, armpitR: chest.R,
      waistL: waist.L, waistR: waist.R,
      hipL: hips.L, hipR: hips.R,
      armL: arm.L, armR: arm.R,
      crotch: { x: 0.5, y: 0.52 },
      footL: { x: 0.47, y: footY }, footR: { x: 0.53, y: footY },
    },
    ...overrides,
  };
}

/** The same person seen from the side — this is what gives body depth. */
function sideFrame(overrides = {}) {
  const aspect = 0.75;
  const headY = 0.10;
  const cmPerWidth = 23.5 / (headY / aspect); // 176.25
  const P = (cm) => cm / cmPerWidth;
  const headTopY = 0.05;

  const pair = (cm, y, cx = 0.5) => ({ L: { x: cx - P(cm) / 2, y }, R: { x: cx + P(cm) / 2, y } });
  const neck = pair(11, 0.19);
  const chest = pair(27, 0.29);
  const waist = pair(25, 0.37);
  const hips = pair(28, 0.45);
  const footY = headTopY + P(176.25) * aspect; // same 7.5 head-heights

  return {
    view: 'side',
    gender: 'male',
    aspect,
    confidence: 0.8,
    camera: { sharpness: 0.8, lighting: 0.8 },
    visible: { head: true, torso: true, hips: true, legs: true, feet: true },
    references: [],
    landmarks: {
      headTop: { x: 0.5, y: headTopY },
      chin: { x: 0.5, y: headTopY + headY },
      neckL: neck.L, neckR: neck.R,
      armpitL: chest.L, armpitR: chest.R,
      waistL: waist.L, waistR: waist.R,
      hipL: hips.L, hipR: hips.R,
      footL: { x: 0.46, y: footY }, footR: { x: 0.54, y: footY },
    },
    ...overrides,
  };
}

const scaled = (f) => ({ ...f, scale: frameScale(f) });

console.log('\n== ellipse perimeter (sanity) ==');
check('circle r=10 cm -> 2*pi*10 cm, in inches', toIn(ellipsePerimeter(10, 10)), toIn(2 * Math.PI * 10), 0.001);

console.log('\n== front + side: the whole calculation ==');
const front = scaled(frontFrame());
const side = scaled(sideFrame());
const both = [front, side];
check('scale from the head alone (front)', front.scale.cmPerWidth, 185.53, 0.5);
check('chest girth (in)', measureRegion('chest', both).valueIn, 40.48, 0.4);
check('waist girth (in)', measureRegion('waist', both).valueIn, 36.04, 0.4);
check('hip girth (in)', measureRegion('hips', both).valueIn, 39.73, 0.4);
check('neck girth (in)', measureRegion('neck', both).valueIn, 14.25, 0.4);
check('arm girth (in)', measureRegion('arm', both).valueIn, 12.93, 0.4);
check('shoulder width (in)', measureRegion('shoulder', both).valueIn, 18.10, 0.2);
check('height (in)', measureHeight(both).in, 69.39, 0.4);
checkTrue('a 7.5 head-height body is left uncorrected', front.scale.headUnitsCorrection === 1, String(front.scale.headUnitsCorrection));
checkTrue('depth really measured from the side view', measureRegion('chest', both).depthSource.includes('side view'), measureRegion('chest', both).depthSource);
checkTrue('shoulder width comes from the front, not the side', measureRegion('shoulder', both).views.includes('front') && !measureRegion('shoulder', both).views.includes('side'), measureRegion('shoulder', both).views.join(','));

console.log('\n== no side view: depth is modelled from the ratio, not invented ==');
const chestF = measureRegion('chest', [front]);
checkTrue('modelled flag reported in depthSource', chestF.depthSource.includes('x width'), chestF.depthSource);
checkTrue('girth still plausible', chestF.valueIn > 36 && chestF.valueIn < 46, `chest ${chestF.valueIn.toFixed(1)} in`);
checkTrue('modelled girth is a little larger than measured depth gives', chestF.valueIn > measureRegion('chest', both).valueIn, `${chestF.valueIn.toFixed(2)} vs ${measureRegion('chest', both).valueIn.toFixed(2)} in`);
checkTrue('confidence drops without a side view', chestF.confidence < measureRegion('chest', both).confidence, `${chestF.confidence} vs ${measureRegion('chest', both).confidence}`);

console.log('\n== what is not visible is left blank ==');
const torsoOnly = scaled(frontFrame());
for (const k of ['hipL', 'hipR', 'footL', 'footR']) delete torsoOnly.landmarks[k];
const torsoFrames = [torsoOnly];
checkTrue('hips omitted when not visible', measureRegion('hips', torsoFrames) === null, 'hips -> null');
checkTrue('height omitted when feet not in frame', measureHeight(torsoFrames) === null, 'height -> null');
checkTrue('chest still measured (upper body only)', measureRegion('chest', torsoFrames) !== null, `chest ${measureRegion('chest', torsoFrames).valueIn.toFixed(1)} in`);

console.log('\n== a wild frame is dropped ==');
const inflated = scaled(frontFrame({ confidence: 0.3, camera: { sharpness: 0.3, lighting: 0.3 } }));
inflated.landmarks.armpitL = { x: 0.15, y: 0.30 };
inflated.landmarks.armpitR = { x: 0.85, y: 0.30 };
const withOutlier = measureRegion('chest', [front, side, inflated]);
checkTrue('outlier rejected, chest unchanged', Math.abs(withOutlier.valueIn - measureRegion('chest', both).valueIn) < 0.5, `chest ${withOutlier.valueIn.toFixed(2)} in vs ${measureRegion('chest', both).valueIn.toFixed(2)} in`);

console.log('\n== a known-size object rescues the scale ==');
const noHead = frontFrame();
delete noHead.landmarks.headTop;
delete noHead.landmarks.chin;
const doorFrame = scaled({
  ...noHead,
  visible: { head: false, torso: true, hips: true, legs: false, feet: false },
  references: [{ what: 'door', knownCm: 203, a: { x: 0.1, y: 0.02 }, b: { x: 0.1, y: 0.62 }, reliability: 0.9 }],
});
const doorCmPerWidth = 203 / (0.60 / 0.75);
checkTrue('scale derived from the door alone', !!doorFrame.scale && Math.abs(doorFrame.scale.cmPerWidth - doorCmPerWidth) < 0.001, doorFrame.scale ? `${doorFrame.scale.cmPerWidth.toFixed(1)} cm/width` : 'none');
checkTrue('no head + no reference means no scale at all', frameScale({ ...noHead, references: [] }) === null, 'null');

console.log('\n== landmark hygiene ==');
const px = normalizeLandmarks({ headTop: { x: 500, y: 60 }, chin: [500, 150] });
checkTrue('pixel values rescaled to 0-1', Math.abs(px.headTop.x - 0.5) < 0.001 && Math.abs(px.chin.y - 0.15) < 0.001, JSON.stringify(px));
checkTrue('array form accepted', Array.isArray(px.chin) === false && Math.abs(px.chin.x - 0.5) < 0.001, 'chin from [500,150]');
checkTrue('off-frame point dropped', normalizeLandmarks({ a: { x: 1.4, y: 0.5 }, b: { x: 0.5, y: 0.5 } }).a === undefined, 'a removed');
checkTrue('garbage dropped', Object.keys(normalizeLandmarks({ a: 'x', b: null })).length === 0, 'empty');
checkTrue('0-100 scale accepted', Math.abs(normalizeLandmarks({ headTop: { x: 50, y: 6 } }).headTop.y - 0.06) < 0.001, normalizeLandmarks({ headTop: { x: 50, y: 6 } }).headTop.y);

console.log('\n== the sanity check: a mis-placed landmark is not a body ==');
const scrambled = scaled(frontFrame());
scrambled.landmarks.chin = { x: 0.5, y: 0.9 }; // chin below the feet
const scrambleCheck = checkFrame(scrambled);
checkTrue('chin below the shoulders is fatal', scrambleCheck.fatal === true, scrambleCheck.notes.join(', '));

const armsAsChest = scaled(frontFrame());
armsAsChest.landmarks.armpitL = { x: 0.20, y: 0.30 }; // torso measured across the arms
armsAsChest.landmarks.armpitR = { x: 0.80, y: 0.30 };
const armsCheck = checkFrame(armsAsChest);
checkTrue('a 60 cm "chest" is rejected as a region', armsCheck.bad.has('chest') && !armsCheck.fatal, [...armsCheck.bad].join(',') || 'nothing flagged');
checkTrue('the rejected region is not measured', measureRegion('chest', [{ ...armsAsChest, bad: armsCheck.bad }]) === null, 'chest -> null');
checkTrue('a healthy frame flags nothing', checkFrame(front).bad.size === 0 && checkFrame(front).fatal === false, 'clean');

const bigNeck = scaled(frontFrame());
bigNeck.landmarks.neckL = { x: 0.30, y: 0.20 };
bigNeck.landmarks.neckR = { x: 0.70, y: 0.20 };
checkTrue('a 74 cm "neck" is rejected', checkFrame(bigNeck).bad.has('neck'), 'neck flagged');

const crotchBelowFeet = scaled(frontFrame());
crotchBelowFeet.landmarks.crotch = { x: 0.5, y: 0.99 };
const legCheck = checkFrame(crotchBelowFeet);
checkTrue('crotch below the feet only invalidates height', legCheck.fatal === false && legCheck.heightBad === true, 'heightBad');
checkTrue('height skipped for the bad frame', measureHeight([{ ...crotchBelowFeet, heightBad: true }]) === null, 'height -> null');
checkTrue('girths still usable from the same frame', measureRegion('chest', [{ ...crotchBelowFeet, bad: legCheck.bad, heightBad: true }]) !== null, 'chest kept');

console.log('\n== a mis-placed head is corrected against adult proportions ==');
// The model put the chin too high, so the head reads short and the body looks
// 8.0 head-heights tall instead of 7.5. Everything scaled off that head would
// come out ~7% too big.
const longBody = frontFrame();
longBody.landmarks.footL = { x: 0.47, y: 0.06 + 0.95 * 0.75 * (8.0 / 7.5) };
longBody.landmarks.footR = { x: 0.53, y: longBody.landmarks.footL.y };
const longScaled = scaled(longBody);
checkTrue('an 8-head body gets its scale pulled back', longScaled.scale.headUnitsCorrection > 1.03 && longScaled.scale.headUnitsCorrection <= 1.08, `x${longScaled.scale.headUnitsCorrection}`);
checkTrue('the correction shrinks the scale, not inflates it', longScaled.scale.cmPerWidth < front.scale.cmPerWidth, `${longScaled.scale.cmPerWidth.toFixed(1)} vs ${front.scale.cmPerWidth.toFixed(1)} cm/width`);
checkTrue('the corrected height lands in adult range', measureHeight([longScaled]).in < 71 && measureHeight([longScaled]).in > 68, `${measureHeight([longScaled]).in.toFixed(1)} in`);
const wildBody = frontFrame();
wildBody.landmarks.footL = { x: 0.47, y: 0.06 + 0.95 * 0.75 * 1.6 };
wildBody.landmarks.footR = { x: 0.53, y: wildBody.landmarks.footL.y };
checkTrue('the correction is bounded at 8%', scaled(wildBody).scale.headUnitsCorrection <= 1.08, `x${scaled(wildBody).scale.headUnitsCorrection}`);

console.log(`\n${fail === 0 ? 'ALL GOOD' : 'FAILURES'} - ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
