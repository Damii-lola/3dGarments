/**
 * Worked examples for the body-scan geometry.
 *
 * We build frames for people whose real measurements we know, hand them to the
 * same functions the API uses, and check the numbers that come back. Run with:
 *
 *   node scripts/geometry-check.mjs
 */

import {
  DEPTH_RATIO,
  checkFrame,
  depthRatio,
  ellipsePerimeter,
  frameScale,
  measureHeight,
  measurePath,
  measureRegion,
  normalizeLandmarks,
  tapeGirth,
  tapeShape,
  toIn,
} from '../src/lib/bodyGeometry.js';
import { buildCatalogue, depthRatioFor } from '../src/lib/catalogue.js';
import { bestSize, chartFromInput, chartKey, columnsFromRows } from '../src/lib/sizing.js';

const IN_CM = 2.54;

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
  const chest = pair(28, 0.30);
  const arm = pair(11, 0.30, 0.34);
  const waist = pair(29, 0.38);
  const hips = pair(33, 0.46);
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
  const chest = pair(24, 0.29);
  const waist = pair(21, 0.37);
  const hips = pair(23.5, 0.45);
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

/** A frame as the route hands it to the engine: scaled, then sanity-checked. */
function ready(frame) {
  const f = scaled(frame);
  const c = checkFrame(f);
  return { ...f, bad: c.bad, heightBad: c.heightBad };
}

/**
 * A male 176.25 cm tall (7.5 head-heights) carrying every named line a tailor's
 * sheet asks for, positioned where the anatomy actually puts them: the armpit
 * line at 48 cm below the crown, the waist at 71, the hip line at 87, the
 * crotch at 94, the knee at 128, the floor at 176.25.
 */
function catalogFrame() {
  const aspect = 0.75;
  const headY = 0.095;
  const cmPerWidth = 23.5 / (headY / aspect);
  const P = (cm) => cm / cmPerWidth;
  const headTopY = 0.06;
  const Y = (cm) => headTopY + P(cm) * aspect;
  /** A pair `cm` apart, centred `cmx` from the body's centre line. */
  const at = (cm, down, cmx = 0) => ({
    L: { x: 0.5 + P(cmx - cm / 2), y: Y(down) },
    R: { x: 0.5 + P(cmx + cm / 2), y: Y(down) },
  });
  const pt = (cmx, down) => ({ x: 0.5 + P(cmx), y: Y(down) });

  const head = at(15, 12);
  const neck = at(12, 26);
  const shoulders = at(46, 31);
  const upperChest = at(28, 48);
  const bust = at(28, 54);
  const underbust = at(26, 59);
  const waist = at(29, 71);
  const lowWaist = at(31, 82);
  const hips = at(33, 87);
  const arm = at(11, 40, -20);
  const elbow = at(8, 71, -20.5);
  const wrist = at(5.5, 91, -21);
  const knee = at(12, 128, -7);
  const calf = at(11, 145, -7);
  const highAnkle = at(8, 160, -7);
  const ankle = at(7, 168, -7);

  return {
    view: 'front',
    gender: 'male',
    aspect,
    confidence: 0.85,
    camera: { sharpness: 0.85, lighting: 0.85 },
    visible: { head: true, torso: true, hips: true, legs: true, feet: true },
    references: [],
    landmarks: {
      headTop: { x: 0.5, y: headTopY },
      chin: { x: 0.5, y: Y(23.5) },
      headL: head.L, headR: head.R,
      neckL: neck.L, neckR: neck.R,
      nape: { x: 0.5, y: Y(26) },
      shoulderL: shoulders.L, shoulderR: shoulders.R,
      upperChestL: upperChest.L, upperChestR: upperChest.R,
      armpitL: bust.L, armpitR: bust.R,
      underbustL: underbust.L, underbustR: underbust.R,
      waistL: waist.L, waistR: waist.R,
      lowWaistL: lowWaist.L, lowWaistR: lowWaist.R,
      hipL: hips.L, hipR: hips.R,
      armL: arm.L, armR: arm.R,
      elbowL: elbow.L, elbowR: elbow.R,
      wristL: wrist.L, wristR: wrist.R,
      kneeL: knee.L, kneeR: knee.R,
      calfL: calf.L, calfR: calf.R,
      highAnkleL: highAnkle.L, highAnkleR: highAnkle.R,
      ankleL: ankle.L, ankleR: ankle.R,
      shoulderJL: pt(-19, 31), shoulderJR: pt(19, 31),
      elbowJL: pt(-20.5, 71), elbowJR: pt(20.5, 71),
      wristJL: pt(-21, 91), wristJR: pt(21, 91),
      kneeJL: pt(-7, 128), kneeJR: pt(7, 128),
      crotch: { x: 0.5, y: Y(94) },
      footL: { x: 0.47, y: Y(176.25) }, footR: { x: 0.53, y: Y(176.25) },
    },
  };
}

console.log('\n== ellipse perimeter (sanity) ==');
check('circle r=10 cm -> 2*pi*10 cm, in inches', toIn(ellipsePerimeter(10, 10)), toIn(2 * Math.PI * 10), 0.001);

console.log('\n== a tape is not an ellipse, and the survey says how far off ==');
// ANSUR II measured a caliper width, a caliper depth AND a tape round the same
// 4,082 men and 1,986 women. These are its own means for the girths a size is
// built from, so the arithmetic that turns width + depth into a tape reading has
// to land on them — not on a clip, and not on a shape that was tuned by eye.
check('mean male chest tapes what ANSUR measured', toIn(tapeGirth(28.9, 25.4, 'chest', 'male')), 105.9 / IN_CM, 0.6);
check('mean male waist tapes what ANSUR measured', toIn(tapeGirth(32.6, 23.8, 'waist', 'male')), 94.1 / IN_CM, 0.6);
check('mean male hip tapes what ANSUR measured', toIn(tapeGirth(34.6, 24.6, 'hips', 'male')), 102.0 / IN_CM, 0.6);
check('mean female bust tapes what ANSUR measured', toIn(tapeGirth(26.9, 24.7, 'chest', 'female')), 94.7 / IN_CM, 0.6);
check('mean female waist tapes what ANSUR measured', toIn(tapeGirth(30.0, 21.3, 'waist', 'female')), 86.1 / IN_CM, 0.6);
check('mean female hip tapes what ANSUR measured', toIn(tapeGirth(35.4, 23.3, 'hips', 'female')), 102.1 / IN_CM, 0.6);
checkTrue('the plain ellipse was a fifth short on every male chest',
  tapeGirth(28.9, 25.4, 'chest', 'male') / ellipsePerimeter(28.9 / 2, 25.4 / 2) > 1.2,
  `x${(tapeGirth(28.9, 25.4, 'chest', 'male') / ellipsePerimeter(28.9 / 2, 25.4 / 2)).toFixed(3)}`);
checkTrue('a limb is round, so its ellipse was already right',
  Math.abs(tapeGirth(7.5, 7.5, 'ankle', 'male') / (Math.PI * 7.5) - 1) < 0.02,
  `${toIn(tapeGirth(7.5, 7.5, 'ankle', 'male')).toFixed(2)} in round a 7.5 cm ankle`);
checkTrue('a bust is deeper than a ribcage for the same width',
  depthRatioFor('chest', 'female') > DEPTH_RATIO.chest,
  `${depthRatioFor('chest', 'female')} vs ${DEPTH_RATIO.chest}`);
// The head's depth is always modelled, so the ratio has to be the survey's. It
// reproduced its own head tapes at 1.36 (men) / 1.40 (women) of the breadth.
check('a head is 1.38 as deep as it is wide', DEPTH_RATIO.head, 1.38, 0.001);
checkTrue('and a mean male head then tapes where ANSUR taped it',
  Math.abs(toIn(tapeGirth(15.43, 15.43 * DEPTH_RATIO.head, 'head', 'male')) - 57.44 / IN_CM) / (57.44 / IN_CM) < 0.03,
  `${toIn(tapeGirth(15.43, 15.43 * DEPTH_RATIO.head, 'head', 'male')).toFixed(2)} in vs ANSUR's ${(57.44 / IN_CM).toFixed(2)}`);

console.log('\n== front + side: the whole calculation ==');
const front = scaled(frontFrame());
const side = scaled(sideFrame());
const both = [front, side];
check('scale from the head alone (front)', front.scale.cmPerWidth, 185.53, 0.5);
check('chest girth (in)', measureRegion('chest', both).valueIn, 39.84, 0.4);
check('waist girth (in)', measureRegion('waist', both).valueIn, 32.80, 0.4);
check('hip girth (in)', measureRegion('hips', both).valueIn, 38.32, 0.4);
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

console.log('\n== the tape and the priors are the survey\'s own fits ==');
checkTrue('every torso part is taped by the survey fit, not a guessed shape',
  ['chest', 'waist', 'hips'].every((k) => tapeShape(k) === 'fitted') && tapeShape('neck') === 'ellipse',
  ['chest', 'waist', 'hips', 'neck', 'head'].map((k) => `${k}:${tapeShape(k)}`).join('  '));
checkTrue('a woman is wider than deep at the hip, a man less so — and the priors say so',
  depthRatio('hips', 'female') < depthRatio('hips', 'male') - 0.03,
  `female ${depthRatio('hips', 'female')} vs male ${depthRatio('hips', 'male')}`);
checkTrue('a head is taped from its breadth alone, the survey\'s own head model',
  Math.abs(tapeGirth(15.43, null, 'head', 'male') - 3.719 * 15.43) < 0.01,
  `${toIn(tapeGirth(15.43, null, 'head', 'male')).toFixed(2)} in from 15.43 cm across`);
check('a turned frame is judged against both bands, not just the width one', (() => {
  const f = frontFrame({ view: 'three-quarter', turn: 45 });
  const P = (cm) => cm / 185.53;
  const y = f.landmarks.armpitL.y;
  f.landmarks.armpitL = { x: 0.5 - P(22) / 2, y };
  f.landmarks.armpitR = { x: 0.5 + P(22) / 2, y };
  return checkFrame({ ...f, scale: frameScale(f) }).bad.has('chest') ? 0 : 1;
})(), 1, 0);

console.log('\n== a turned frame is undone, not read as a width ==');
// The same chest (28 cm across, 24.55 cm deep) seen turned 45 degrees projects to
// sqrt(w^2 cos^2 + d^2 sin^2) = 26.33 cm — narrower than the body, and not a
// width at all. Reading that as the width is what a three-quarter frame used to
// do. Undoing the turn by the frame's own angle gives the body back, and the
// turned frame even carries the depth itself, so no profile frame is needed.
const beside = (() => {
  const f = frontFrame({ view: 'three-quarter', turn: 45 });
  const P = (cm) => cm / 185.53;
  const y = f.landmarks.armpitL.y;
  f.landmarks.armpitL = { x: 0.5 - P(26.33) / 2, y };
  f.landmarks.armpitR = { x: 0.5 + P(26.33) / 2, y };
  return f;
})();
const turned = measureRegion('chest', [scaled(beside)]);
checkTrue('a turned chest span is undone back to the body width',
  Math.abs(turned.widthIn - 28 / IN_CM) < 0.15,
  `${turned.widthIn.toFixed(2)}" across (square on: ${(28 / IN_CM).toFixed(2)}")`);
checkTrue('and it is wider than the raw span, which is not the width',
  turned.widthIn > 26.33 / IN_CM + 0.3, `raw span ${(26.33 / IN_CM).toFixed(2)}" -> ${turned.widthIn.toFixed(2)}"`);
checkTrue('the turned frame carries the depth itself, so no profile is needed',
  turned.depthMeasured === true, `${turned.depthIn.toFixed(1)}" deep, ${turned.depthSource}`);
checkTrue('so a 45-degree chest reads the same tape as a square-on one',
  Math.abs(turned.valueIn - chestF.valueIn) < 0.35,
  `${turned.valueIn.toFixed(2)} vs ${chestF.valueIn.toFixed(2)} in`);

console.log('\n== a shallow turn cannot invent a depth ==');
// A frame turned only 25 degrees is badly conditioned: 1/sin(25) magnifies a
// span error by 2.4x, so a corrupted neck span would report a neck deeper than a
// human neck can be. It is refused, the width goes on the survey's ratio, and
// the reading says the depth was modelled rather than measured.
const shallow = (() => {
  const f = frontFrame({ view: 'three-quarter', turn: 25 });
  const P = (cm) => cm / 185.53;
  const y = f.landmarks.neckL.y;
  f.landmarks.neckL = { x: 0.5 - P(15) / 2, y };
  f.landmarks.neckR = { x: 0.5 + P(15) / 2, y };
  return f;
})();
const shallowNeck = measureRegion('neck', [scaled(frontFrame()), scaled(shallow)]);
checkTrue('a depth outside the human band is refused, not reported',
  shallowNeck.depthMeasured === false, `${shallowNeck.depthIn}" deep, ${shallowNeck.depthSource}`);
checkTrue('and the reading still tapes a plausible neck',
  shallowNeck.valueIn > 11 && shallowNeck.valueIn < 20, `neck ${shallowNeck.valueIn.toFixed(1)} in`);

console.log('\n== arms read as part of the torso: the survey says no ==');
// The failure that matters most. With the arms against the ribcage the mask is
// one run from hand to hand, so a "chest" 45 cm wide sails past an absolute
// ceiling of 50 cm — and then tapes 65 in. Against the shoulder span (the same
// frame, so the same scale) it is obviously the shoulders.
const body = frontFrame();
const stretch = (p, k) => ({ x: 0.5 + (p.x - 0.5) * k, y: p.y });
const fusedChest = ready({
  ...body,
  landmarks: {
    ...body.landmarks,
    armpitL: stretch(body.landmarks.armpitL, 45 / 28),
    armpitR: stretch(body.landmarks.armpitR, 45 / 28),
  },
});
checkTrue('a 45 cm "chest" on a 46 cm shoulder is refused', fusedChest.bad.has('chest'), [...fusedChest.bad].join(',') || 'nothing dropped');
checkTrue('and that frame still gives up its shoulder line', !fusedChest.bad.has('shoulder'), 'shoulder kept');
const fusedHips = ready({
  ...body,
  landmarks: {
    ...body.landmarks,
    hipL: stretch(body.landmarks.hipL, 48 / 33),
    hipR: stretch(body.landmarks.hipR, 48 / 33),
  },
});
checkTrue('a hip row wider than the shoulders is refused too', fusedHips.bad.has('hips'), [...fusedHips.bad].join(',') || 'nothing dropped');
checkTrue('a chest the arms genuinely clear is kept', !ready(frontFrame()).bad.has('chest'), 'kept');

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

console.log('\n== the catalogue: every category the clip actually showed ==');
const men = buildCatalogue({ frames: [ready(catalogFrame())], gender: 'male' });
const item = (c, key) => c.items.find((i) => i.key === key) || null;
const near = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

checkTrue('the men\'s sheet is read out of one front frame', men.items.length >= 20, `${men.items.length} items`);
checkTrue('chest is a chest girth', near(item(men, 'chest')?.in, 39, 43), `chest ${item(men, 'chest')?.in} in`);
checkTrue('head, neck, waist, lower waist and hips all come out', ['head', 'neck', 'waist', 'lowWaist', 'hips'].every((k) => item(men, k)), men.items.slice(0, 6).map((i) => i.label).join(', '));
checkTrue('nape to waist is a real length', near(item(men, 'napeToWaist')?.in, 15, 19), `nape->waist ${item(men, 'napeToWaist')?.in} in`);
checkTrue('armscye depth is the shoulder-to-armpit drop', near(item(men, 'armholeDepth')?.in, 5, 8), `armscye ${item(men, 'armholeDepth')?.in} in`);
checkTrue('sleeve length runs shoulder -> elbow -> wrist', near(item(men, 'sleeveLength')?.in, 21, 26), `sleeve ${item(men, 'sleeveLength')?.in} in`);

console.log('\n== the arm survives both naming schemes and a turned frame ==');
// The vision model is asked for shoulderL / elbowL / wristL, the pose model
// reports shoulderJL / elbowJL / wristJL. The sleeve used to look only for the
// J names, so every scan that went through the vision path came back with no
// arm length at all — the arm was in shot, nobody had asked where it ended.
const armSpec = { points: ['shoulder', 'elbow', 'wrist'], range: [16, 33] };
const noJ = (() => {
  const f = catalogFrame();
  const l = { ...f.landmarks };
  for (const k of ['shoulderJL', 'shoulderJR', 'elbowJL', 'elbowJR', 'wristJL', 'wristJR']) delete l[k];
  return { ...f, landmarks: l };
})();
const square = measurePath([scaled(noJ)], armSpec);
checkTrue('a frame that names joints the vision way still measures the arm', near(square?.in, 16, 33), `sleeve ${square?.in?.toFixed(2)} in`);
// A three-quarter frame compresses only the horizontal part of the limb. Undoing
// that by the frame's own turn has to give the square-on length back, not a
// third less of it.
const turnedArm = (() => {
  const f = scaled(noJ);
  const c = Math.cos(Math.PI / 4);
  const l = {};
  for (const [k, p] of Object.entries(f.landmarks)) l[k] = { x: 0.5 + (p.x - 0.5) * c, y: p.y };
  return { ...f, landmarks: l, view: 'three-quarter', turn: 45 };
})();
const undone = measurePath([turnedArm], armSpec);
checkTrue('a three-quarter frame is undone, not read as a short arm',
  near(undone?.in, square.in - 0.4, square.in + 0.4), `turned ${undone?.in?.toFixed(2)} in vs square ${square?.in?.toFixed(2)} in`);
// The sheet asks each question once. A row that only restated another row — a
// jersey sleeve beside the sleeve, X-Back beside Back Width, Total Height beside
// the two body heights — was taken off both sheets.
const DUPLICATE_ROWS = ['sleeveJersey', 'cuffTwoPiece', 'jeansBottom', 'xShoulder', 'xBack', 'xFront', 'totalHeight'];
checkTrue('a row that only repeated another row is not in the sheet', DUPLICATE_ROWS.every((k) => item(men, k) === null), DUPLICATE_ROWS.filter((k) => item(men, k)).join(', ') || 'all absent');
checkTrue('and the rows they repeated are still there', ['sleeveLength', 'cuffShirts', 'backWidth'].every((k) => item(men, k)), 'kept');
checkTrue('waist to knee, hip and floor are all measured', [item(men, 'waistToKnee'), item(men, 'waistToHip'), item(men, 'waistToFloor')].every((i) => near(i?.in, 3, 50)), `waist->knee ${item(men, 'waistToKnee')?.in}, ->hip ${item(men, 'waistToHip')?.in}, ->floor ${item(men, 'waistToFloor')?.in} in`);
checkTrue('body rise is the waist-to-crotch drop', near(item(men, 'bodyRise')?.in, 8, 11), `rise ${item(men, 'bodyRise')?.in} in`);
checkTrue('crotch length is the rise twice over, plus the seat depth', item(men, 'crotchLength')?.in > 25, `crotch ${item(men, 'crotchLength')?.in} in`);
checkTrue('height is the two body heights, not a separate total', near(item(men, 'upperbodyHeight')?.in, 17, 33) && item(men, 'totalHeight') === null, `upper ${item(men, 'upperbodyHeight')?.in} in`);
checkTrue('knee, calf, high ankle and ankle are measured', ['knee', 'calf', 'highAnkle', 'ankle'].every((k) => item(men, k)), ['knee', 'calf', 'highAnkle', 'ankle'].map((k) => item(men, k)?.in).join(', '));
checkTrue('a cuff is quoted from the measured wrist', item(men, 'cuffShirts')?.in >= item(men, 'wrist')?.in, `wrist ${item(men, 'wrist')?.in} -> cuff ${item(men, 'cuffShirts')?.in} in`);

console.log('\n== the catalogue: what the clip did NOT show is simply absent ==');
checkTrue('the X rows are gone; Back Width is the same line from any frame', ['xShoulder', 'xBack', 'xFront'].every((k) => item(men, k) === null) && item(men, 'backWidth') !== null, `back width ${item(men, 'backWidth')?.in} in`);
checkTrue('a bare ankle is not a trouser bottom', item(men, 'trouserBottom') === null, 'omitted');
checkTrue('one hem row, no second one for jeans', item(men, 'jeansBottom') === null, 'omitted');
checkTrue('no women\'s categories on a men\'s sheet', !item(men, 'bust') && !item(men, 'dart') && !item(men, 'topArm'), 'clean');

const trouser = ready(catalogFrame());
const wide = { L: { x: 0.5 - 0.0485, y: trouser.landmarks.ankleL.y }, R: { x: 0.5 + 0.0485, y: trouser.landmarks.ankleR.y } };
trouser.landmarks.ankleL = wide.L;
trouser.landmarks.ankleR = wide.R;
const trouserCheck = checkFrame(trouser);
trouser.bad = trouserCheck.bad;
const trousered = buildCatalogue({ frames: [trouser], gender: 'male' });
checkTrue('fabric across the ankle becomes a trouser bottom width', near(item(trousered, 'trouserBottom')?.in, 6, 9), `trouser bottom ${item(trousered, 'trouserBottom')?.in} in`);
checkTrue('and the ankle tape is not read off the trouser leg', item(trousered, 'ankle') === null, 'ankle omitted');
checkTrue('and still only one hem row', item(trousered, 'jeansBottom') === null, 'omitted');

const women = buildCatalogue({ frames: [ready(catalogFrame())], gender: 'female' });
checkTrue('bust is the full bust line', near(item(women, 'bust')?.in, 37, 40.5), `bust ${item(women, 'bust')?.in} in`);
checkTrue('each sex is taped on its own survey line, and both land plausible',
  item(women, 'bust')?.in > 36 && item(women, 'bust')?.in < 41 && item(men, 'chest')?.in > 38 && item(men, 'chest')?.in < 42,
  `bust ${item(women, 'bust')?.in} vs chest ${item(men, 'chest')?.in} in`);
checkTrue('and the woman\'s number says the depth was modelled', /modelled/.test(item(women, 'bust')?.how || ''), item(women, 'bust')?.how);
checkTrue('a man\'s chest stays on the ribcage ratio', /0\.877x width/.test(item(men, 'chest')?.how || ''), item(men, 'chest')?.how);
checkTrue('a woman\'s bust projects, so its prior is the larger one', /0\.919x width/.test(item(women, 'bust')?.how || ''), item(women, 'bust')?.how);
checkTrue('a woman\'s chest is the upper chest, above the bust', item(women, 'chest')?.in < item(women, 'bust')?.in, `chest ${item(women, 'chest')?.in} vs bust ${item(women, 'bust')?.in} in`);
checkTrue('dart is what the bust takes in over the underbust', near(item(women, 'dart')?.in, 1, 7.5), `dart ${item(women, 'dart')?.in} in`);
checkTrue('top arm, wrist and the leg tapes are all there', ['topArm', 'wrist', 'ankle', 'highAnkle'].every((k) => item(women, k)), ['topArm', 'wrist', 'ankle', 'highAnkle'].map((k) => item(women, k)?.in).join(', '));
checkTrue('no men\'s categories on a women\'s sheet', !item(women, 'upperbodyHeight') && !item(women, 'lowerbodyHeight') && !item(women, 'crotchLength') && !item(women, 'totalHeight') && !item(women, 'sleeveJersey'), 'clean');

console.log('\n== the catalogue: an upper-body clip measures the upper body ==');
const upperOnly = ready(catalogFrame());
for (const k of ['hipL', 'hipR', 'lowWaistL', 'lowWaistR', 'kneeL', 'kneeR', 'kneeJL', 'kneeJR',
  'calfL', 'calfR', 'highAnkleL', 'highAnkleR', 'ankleL', 'ankleR', 'footL', 'footR', 'crotch',
  'wristL', 'wristR', 'wristJL', 'wristJR', 'elbowL', 'elbowR', 'elbowJL', 'elbowJR']) delete upperOnly.landmarks[k];
upperOnly.visible = { head: true, torso: true, hips: false, legs: false, feet: false };
const upper = buildCatalogue({ frames: [upperOnly], gender: 'male' });
checkTrue('the upper-body categories are still read', item(upper, 'chest') !== null && item(upper, 'neck') !== null && item(upper, 'shoulder') !== null, `${upper.items.length} items`);
checkTrue('and nothing below the waist is in the list', !item(upper, 'waistToFloor') && !item(upper, 'knee') && !item(upper, 'ankle') && !item(upper, 'lowerbodyHeight') && !item(upper, 'bodyRise'), 'omitted');
checkTrue('every item that IS listed carries a number', upper.items.every((i) => Number.isFinite(i.in) && i.in > 0), 'all measured');
checkTrue('each item can say how it was worked out', upper.items.every((i) => typeof i.how === 'string' && i.how.length > 8), upper.items[0]?.how);

console.log('\n== the size is the chart row that fits worst-case best ==');
// A chart lists three girths per size and a body need not agree with all three.
// Sizing off the chest alone is what put a real 38" chest - exactly on the 36/40
// boundary - on S while his hips were saying M.
const onTheLine = bestSize('male', { chest: 38.0, waist: 30.2, hips: 41.8 });
checkTrue('a body squarely in one row takes that row', bestSize('male', { chest: 36.2, waist: 30.1, hips: 38.2 }).sizeKey === 'S', bestSize('male', { chest: 36.2, waist: 30.1, hips: 38.2 }).sizeKey);
checkTrue('the live 38" chest is scored against the waist AND the hips', onTheLine.misfit > 3.7 && onTheLine.misfit < 3.9, `worst row disagreement ${onTheLine.misfit.toFixed(2)} in`);
checkTrue('and the same body with the survey waist picks the larger size', bestSize('male', { chest: 38.0, waist: 32.4, hips: 41.8 }).sizeKey === 'M', `${bestSize('male', { chest: 38.0, waist: 32.4, hips: 41.8 }).sizeKey} - his waist reads 2" narrow, and that is the whole reason the two rules disagree here`);
checkTrue('a chest-only measurement is still the nearest nominal', bestSize('male', { chest: 38.0 }).sizeKey === 'S' && bestSize('male', { chest: 41.5 }).sizeKey === 'M', `${bestSize('male', { chest: 38.0 }).sizeKey} / ${bestSize('male', { chest: 41.5 }).sizeKey}`);
checkTrue('women are scored on the bust column, waist and hips', bestSize('female', { chest: 36.0, waist: 28.0, hips: 38.0 }).sizeKey === 'M' && bestSize('female', { chest: 39.0, waist: 31.0, hips: 41.0 }).sizeKey === 'L', `${bestSize('female', { chest: 39, waist: 31, hips: 41 }).sizeKey}`);
checkTrue('no chest means no size', bestSize('male', { waist: 30, hips: 38 }) === null);
checkTrue('a size row can be read back for the chart the page shows', bestSize('male', { chest: 40, waist: 34, hips: 40 }).row.chest === 40);

console.log('\n== a store\'s own chart sizes its own shoppers ==');
// A store types its chart in, and that is the chart its shoppers must be sized
// against — not ours. The rules do not change with the table: same worst-case
// row, same tie. What changes is that the labels are the store's and the columns
// are the store's, and a column the chart does not have cannot move the answer.
const cmChart = chartFromInput({
  unit: 'cm',
  columns: [
    { id: 'c1', label: 'Chest', measure: 'chest' },
    { id: 'c2', label: 'Waist', measure: 'waist' },
  ],
  rows: [
    { key: 'S', c1: 96, c2: 81 },
    { key: 'M', c1: 101, c2: 86 },
    { key: 'L', c1: 107, c2: 91 },
  ],
});
const on = (girths, chart, sex = 'male') => bestSize(sex, girths, chart.rows, chart.columns);

checkTrue('a chart typed in centimetres is converted once, into inches', cmChart.rows.M.c1 === 39.8 && cmChart.rows.M.c2 === 33.9, `${cmChart?.rows?.M?.c1} in / ${cmChart?.rows?.M?.c2} in`);
checkTrue('and a body between two of its rows takes the nearer one', on({ chest: 40, waist: 32 }, cmChart).sizeKey === 'M', on({ chest: 40, waist: 32 }, cmChart)?.sizeKey);
checkTrue('a column the chart does not have cannot move the answer', on({ chest: 40, waist: 32, hips: 60 }, cmChart).sizeKey === 'M', `${on({ chest: 40, waist: 32, hips: 60 }, cmChart)?.sizeKey} - 60" hips against a chart with no hips column`);
checkTrue('the store\'s own labels are what comes back', on({ chest: 40, waist: 34 }, chartFromInput({ columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }], rows: [{ key: '38', c1: 38 }, { key: '40', c1: 40 }, { key: '42', c1: 42 }] })).sizeKey === '40', on({ chest: 40 }, chartFromInput({ columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }], rows: [{ key: '38', c1: 38 }, { key: '40', c1: 40 }, { key: '42', c1: 42 }] }))?.sizeKey);
checkTrue('a chest column is read as a chest column whoever it is for', chartKey({ A: { chest: 36 }, B: { chest: 40 } }) === 'chest' && chartKey({ A: { bust: 34 } }) === 'bust');
checkTrue('a chart with no girth column sizes nobody rather than everybody', chartKey({ A: { waist: 30 }, B: { waist: 34 } }) === null && bestSize('male', { chest: 40 }, { A: { waist: 30 }, B: { waist: 34 } }) === null);
checkTrue('a row that cannot be scored is dropped, and the others survive', (() => {
  const c = chartFromInput({
    columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }, { id: 'c2', label: 'Waist', measure: 'waist' }],
    rows: [{ key: 'M', c1: 40, c2: 34 }, { key: 'L', c1: 'lots' }, { key: 'XL', c1: 400 }],
  });
  return Object.keys(c.rows).length === 1 && c.rows.M.c1 === 40;
})());
checkTrue('two rows with one label are one size', Object.keys(chartFromInput({ columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }], rows: [{ key: 'M', c1: 40 }, { key: 'M', c1: 44 }] }).rows).length === 1);
checkTrue('an empty or unreadable chart is null, never an empty table', chartFromInput(null) === null && chartFromInput({ rows: [] }) === null && chartFromInput({ rows: [{ key: 'M', c1: 40 }] }) === null);
checkTrue('a store chart answers a tie with the row typed first', on({ chest: 39 }, chartFromInput({ columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }], rows: [{ key: 'S', c1: 38 }, { key: 'M', c1: 40 }] })).sizeKey === 'S', on({ chest: 39 }, chartFromInput({ columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }], rows: [{ key: 'S', c1: 38 }, { key: 'M', c1: 40 }] }))?.sizeKey);

console.log('\n== the chart\'s own columns decide what is scored ==');
// The store names its own columns, and adding one is the point: a shoulder that
// the chart carries is a shoulder the body is held against. A column this app
// cannot read off a body (a garment length) is carried and shown, never scored.
const shirt = chartFromInput({
  columns: [
    { id: 'a', label: 'Shoulder', measure: 'shoulder' },
    { id: 'b', label: 'Chest', measure: 'chest' },
  ],
  rows: [
    { key: 'S', a: 17, b: 38 },
    { key: 'M', a: 18, b: 40 },
    { key: 'L', a: 19, b: 42 },
  ],
});
checkTrue('a column the store added is scored, and can change the size', on({ chest: 38, shoulder: 20 }, shirt).sizeKey === 'M', `${on({ chest: 38, shoulder: 20 }, shirt)?.sizeKey} - the chest alone would have said S`);
checkTrue('the first measurable column is the one that decides', (() => {
  const c = chartFromInput({
    columns: [
      { id: 'a', label: 'Body length', measure: '' },
      { id: 'b', label: 'Chest', measure: 'chest' },
      { id: 'c', label: 'Shoulder', measure: 'shoulder' },
    ],
    rows: [{ key: 'M', a: 29, b: 40, c: 18 }],
  });
  const s = on({ chest: 41, shoulder: 18 }, c);
  return s.field === 'chest' && s.label === 'Chest' && s.key === 'b';
})(), 'a length column typed first does not become the anchor');
checkTrue('a column this app cannot read is carried but never scored', (() => {
  const plain = chartFromInput({ columns: [{ id: 'b', label: 'Chest', measure: 'chest' }], rows: [{ key: 'S', b: 38 }, { key: 'M', b: 40 }] });
  const withLength = chartFromInput({
    columns: [{ id: 'b', label: 'Chest', measure: 'chest' }, { id: 'a', label: 'Body length', measure: '' }],
    rows: [{ key: 'S', b: 38, a: 29 }, { key: 'M', b: 40, a: 30 }],
  });
  return withLength.columns.length === 2
    && on({ chest: 39, height: 66 }, plain).sizeKey === on({ chest: 39, height: 66 }, withLength).sizeKey;
})(), 'the same chest answers the same size with or without a length column');
checkTrue('a column with a blank cell is scored on nobody, so the blank cannot win a row', (() => {
  const c = chartFromInput({
    columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }, { id: 'c2', label: 'Waist', measure: 'waist' }],
    rows: [{ key: 'S', c1: 36, c2: 30 }, { key: 'M', c1: 40 }],
  });
  // Filled in, M would win (11" off) over S (15" off). Blank, the column counts
  // for neither row: the chest alone answers S, and M gains nothing from the gap.
  return c.columns.length === 2 && on({ chest: 37, waist: 45 }, c).sizeKey === 'S';
})());
checkTrue('trousers are sized off a waist with no chest column at all', (() => {
  const c = chartFromInput({
    columns: [
      { id: 'w', label: 'Waist', measure: 'waist' },
      { id: 'i', label: 'Inseam', measure: '' },
    ],
    rows: [{ key: '30', w: 30, i: 30 }, { key: '32', w: 32, i: 31 }, { key: '34', w: 34, i: 32 }],
  });
  return on({ waist: 32.4 }, c).sizeKey === '32';
})());
checkTrue('rows saved before columns were named still size the body', (() => {
  const legacy = { S: { chest: 36 }, M: { chest: 40 } };
  return columnsFromRows(legacy).length === 1 && bestSize('male', { chest: 39 }, legacy).sizeKey === 'M';
})());
checkTrue('a chart with no measurable column is not a size chart', chartFromInput({
  columns: [{ id: 'a', label: 'Body length', measure: '' }],
  rows: [{ key: 'M', a: 29 }],
}) === null);

console.log('\n== the head stays the ruler; the whole body only cross-checks it ==');
// The scale used to be pulled to the middle of the adult band on every frame that
// had the feet in shot, which made the whole body the ruler and the head a
// decoration: every measurement came out multiplied by (176.25 cm / the person's
// real height). Projecting 80 real ANSUR II bodies into camera geometry showed
// what that costs - if the feet are in shot, the error roughly doubles on every
// row for both sexes (a man's chest 1.84% -> 3.52% mean absolute, p90 3.9% ->
// 8.0%) and every woman gains a +3% bias, because "7.5 head-heights" is a man's
// ratio. A ratio outside the band is still treated as a mis-placed head.
const bodyOfUnits = (units) => {
  const f = frontFrame();
  f.landmarks.footL = { x: 0.47, y: 0.06 + 0.95 * 0.75 * (units / 7.5) };
  f.landmarks.footR = { x: 0.53, y: f.landmarks.footL.y };
  return f;
};
const inside = scaled(bodyOfUnits(7.7));
checkTrue('a body inside the adult band keeps its own head as the ruler', inside.scale.headUnitsCorrection === 1, `x${inside.scale.headUnitsCorrection}`);
const noFeet = bodyOfUnits(7.7);
delete noFeet.landmarks.footL;
delete noFeet.landmarks.footR;
noFeet.visible.feet = false;
checkTrue('so a full-body frame scales exactly as the same head on its own', Math.abs(scaled(noFeet).scale.cmPerWidth - inside.scale.cmPerWidth) < 1e-9, `${scaled(noFeet).scale.cmPerWidth.toFixed(3)} vs ${inside.scale.cmPerWidth.toFixed(3)} cm/width`);
checkTrue('and its height is measured, not assumed to be 176.25 cm tall', Math.abs(measureHeight([inside]).in - 71.24) < 0.5, `${measureHeight([inside]).in.toFixed(1)} in for a 7.7-head body`);
const longBody = scaled(bodyOfUnits(8.4));
checkTrue('a body over the band is nudged to its edge, not to the middle', longBody.scale.headUnitsCorrection > 1.05 && longBody.scale.headUnitsCorrection <= 1.08, `x${longBody.scale.headUnitsCorrection}`);
checkTrue('the nudge shrinks the scale, not inflates it', longBody.scale.cmPerWidth < front.scale.cmPerWidth, `${longBody.scale.cmPerWidth.toFixed(1)} vs ${front.scale.cmPerWidth.toFixed(1)} cm/width`);
checkTrue('a body under the band is nudged the other way', scaled(bodyOfUnits(6.6)).scale.headUnitsCorrection < 0.95, `x${scaled(bodyOfUnits(6.6)).scale.headUnitsCorrection}`);
checkTrue('the correction is bounded at 8%', scaled(bodyOfUnits(12)).scale.headUnitsCorrection <= 1.08, `x${scaled(bodyOfUnits(12)).scale.headUnitsCorrection}`);

console.log('\n== a ruler the rest of the clip disowns cannot set a height ==');
// Height is the one row that needs the floor, so it is usually the work of a
// single frame — and the frame that shows the floor is the frame with the most
// body in it to mis-place. A real 16-frame turning clip had fifteen frames with
// no feet in shot and one with phantom feet whose head measured a third of the
// others; the height that came back was 86 in, the top of the allowed range.
const stripFeet = (f) => {
  const g = { ...f, landmarks: { ...f.landmarks }, visible: { ...f.visible } };
  delete g.landmarks.footL;
  delete g.landmarks.footR;
  g.visible.feet = false;
  return g;
};
const noFeetClip = [scaled(stripFeet(frontFrame())), scaled(stripFeet(sideFrame()))];
const phantomFrame = scaled(bodyOfUnits(7.7));
phantomFrame.landmarks = { ...phantomFrame.landmarks, chin: { x: 0.5, y: 0.06 + 0.095 * 0.4 } };
phantomFrame.scale = frameScale(phantomFrame);
checkTrue('a phantom-foot frame whose ruler the clip disowns', Math.abs(phantomFrame.scale.cmPerWidth / noFeetClip[0].scale.cmPerWidth - 1) > 0.15, `${phantomFrame.scale.cmPerWidth.toFixed(0)} vs ${noFeetClip[0].scale.cmPerWidth.toFixed(0)} cm/width`);
checkTrue('cannot set the height', measureHeight([...noFeetClip, phantomFrame]) === null, 'height -> null');
check('while a frame the clip does agree with still gives one', measureHeight([...noFeetClip, scaled(bodyOfUnits(7.7))]).in, 71.24, 0.5);

console.log(`\n${fail === 0 ? 'ALL GOOD' : 'FAILURES'} - ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
