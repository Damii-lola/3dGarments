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
import { buildCatalogue } from '../src/lib/catalogue.js';

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
  const upperChest = at(37, 48);
  const bust = at(38, 54);
  const underbust = at(34, 59);
  const waist = at(33, 71);
  const lowWaist = at(35, 82);
  const hips = at(36, 87);
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
checkTrue('the jersey sleeve starts at the nape, so it is longer', item(men, 'sleeveJersey')?.in > item(men, 'sleeveLength')?.in, `${item(men, 'sleeveJersey')?.in} vs ${item(men, 'sleeveLength')?.in} in`);
checkTrue('waist to knee, hip and floor are all measured', [item(men, 'waistToKnee'), item(men, 'waistToHip'), item(men, 'waistToFloor')].every((i) => near(i?.in, 3, 50)), `waist->knee ${item(men, 'waistToKnee')?.in}, ->hip ${item(men, 'waistToHip')?.in}, ->floor ${item(men, 'waistToFloor')?.in} in`);
checkTrue('body rise is the waist-to-crotch drop', near(item(men, 'bodyRise')?.in, 8, 11), `rise ${item(men, 'bodyRise')?.in} in`);
checkTrue('crotch length is the rise twice over, plus the seat depth', item(men, 'crotchLength')?.in > 25, `crotch ${item(men, 'crotchLength')?.in} in`);
checkTrue('total height comes out as the body was drawn', near(item(men, 'totalHeight')?.in, 68, 71), `height ${item(men, 'totalHeight')?.in} in`);
checkTrue('knee, calf, high ankle and ankle are measured', ['knee', 'calf', 'highAnkle', 'ankle'].every((k) => item(men, k)), ['knee', 'calf', 'highAnkle', 'ankle'].map((k) => item(men, k)?.in).join(', '));
checkTrue('a cuff is quoted from the measured wrist', item(men, 'cuffShirts')?.in >= item(men, 'wrist')?.in, `wrist ${item(men, 'wrist')?.in} -> cuff ${item(men, 'cuffShirts')?.in} in`);

console.log('\n== the catalogue: what the clip did NOT show is simply absent ==');
checkTrue('X-Shoulder needs a frame showing the back', item(men, 'xShoulder') === null, 'omitted');
checkTrue('X-Back needs a frame showing the back', item(men, 'xBack') === null, 'omitted');
checkTrue('X-Front is read from the front frame', near(item(men, 'xFront')?.in, 14, 17), `x-front ${item(men, 'xFront')?.in} in`);
checkTrue('Back Width is the same line, from any frame', item(men, 'backWidth') !== null, `back width ${item(men, 'backWidth')?.in} in`);
checkTrue('a bare ankle is not a trouser bottom', item(men, 'trouserBottom') === null, 'omitted');
checkTrue('jeans bottom needs jeans to have been seen', item(men, 'jeansBottom') === null, 'omitted');
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
checkTrue('jeans bottom still waits for jeans to be seen', item(trousered, 'jeansBottom') === null, 'omitted');

const women = buildCatalogue({ frames: [ready(catalogFrame())], gender: 'female' });
checkTrue('bust is the full bust line', near(item(women, 'bust')?.in, 39, 43), `bust ${item(women, 'bust')?.in} in`);
checkTrue('a woman\'s chest is the upper chest, above the bust', item(women, 'chest')?.in < item(women, 'bust')?.in, `chest ${item(women, 'chest')?.in} vs bust ${item(women, 'bust')?.in} in`);
checkTrue('dart is what the bust takes in over the underbust', near(item(women, 'dart')?.in, 1, 5), `dart ${item(women, 'dart')?.in} in`);
checkTrue('top arm, wrist and the leg tapes are all there', ['topArm', 'wrist', 'ankle', 'highAnkle'].every((k) => item(women, k)), ['topArm', 'wrist', 'ankle', 'highAnkle'].map((k) => item(women, k)?.in).join(', '));
checkTrue('no men\'s categories on a women\'s sheet', !item(women, 'xShoulder') && !item(women, 'xBack') && !item(women, 'crotchLength') && !item(women, 'totalHeight'), 'clean');

console.log('\n== the catalogue: an upper-body clip measures the upper body ==');
const upperOnly = ready(catalogFrame());
for (const k of ['hipL', 'hipR', 'lowWaistL', 'lowWaistR', 'kneeL', 'kneeR', 'kneeJL', 'kneeJR',
  'calfL', 'calfR', 'highAnkleL', 'highAnkleR', 'ankleL', 'ankleR', 'footL', 'footR', 'crotch',
  'wristL', 'wristR', 'wristJL', 'wristJR', 'elbowL', 'elbowR', 'elbowJL', 'elbowJR']) delete upperOnly.landmarks[k];
upperOnly.visible = { head: true, torso: true, hips: false, legs: false, feet: false };
const upper = buildCatalogue({ frames: [upperOnly], gender: 'male' });
checkTrue('the upper-body categories are still read', item(upper, 'chest') !== null && item(upper, 'neck') !== null && item(upper, 'shoulder') !== null, `${upper.items.length} items`);
checkTrue('and nothing below the waist is in the list', !item(upper, 'waistToFloor') && !item(upper, 'knee') && !item(upper, 'ankle') && !item(upper, 'totalHeight') && !item(upper, 'bodyRise'), 'omitted');
checkTrue('every item that IS listed carries a number', upper.items.every((i) => Number.isFinite(i.in) && i.in > 0), 'all measured');
checkTrue('each item can say how it was worked out', upper.items.every((i) => typeof i.how === 'string' && i.how.length > 8), upper.items[0]?.how);

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
