/**
 * One photo → the garments in it, made and worn on the model. Every system we have, each for what it does best:
 *
 *   parse.js       clothes parsing (SegFormer): which pixels are which garment; hem length measured on the wearer
 *   pose.js        the wearer's body in the photo (ViTPose keypoints)
 *   photofit.js    the garment's lengths / widths measured against that body, and the sewn garment re-cut until it sits
 *                  on our model exactly where it sits on the person (hem, sleeve ends, waistband, leg width)
 *   clean.js       what isn't the garment taken off it (the vision model names it — a necklace, a bag strap, a hand;
 *                  CLIPSeg + a jewellery detector find it; LaMa paints the fabric back) and its wrinkles smoothed out
 *   NGL (API)      Cloudflare vision → garment words: what each garment is, a second opinion on sleeves / neckline
 *   ChatGarment    (a GPU job, tools/garment_ml/chatgarment) → GarmentCode design: the garment's CUT, when we have it
 *   pattern (API)  py/pattern.py + py/combine.py: ChatGarment's cut + our lengths + the votes → a sewing pattern
 *                  sized to this body
 *   AIpparel       (a GPU job, tools/garment_ml/aipparel) → a whole sewing pattern; per zone, sewn too and kept when
 *                  it measures closer to the photo (py/pattern.py `spec`)
 *   sew.js         the pattern sewn and draped on the body (cloth simulation), textured from the photo
 *   TRELLIS.2      (a GPU job, tools/garment_ml/trellis2) → a textured 3D garment, when we have it: its look on
 *                  the sides the photo can't see, and its relief (mesh3d.js fits it on the same body)
 *
 * @param opts {
 *   describe(jpegDataUrl) → { garments: [NGL garment] }       (POST /api/ngl/describe)
 *   pattern(req) → pattern                                    (POST /api/ngl/pattern)
 *   designs?: { upper?, lower?, full? }  ChatGarment designs for this photo
 *   specs?:   { upper?, lower?, full? }  AIpparel patterns for this photo (tools/garment_ml/aipparel)
 *   models?:  { upper?, lower?, full? }  TRELLIS.2 GLB urls for this photo
 *   onStep?(text)
 * }
 * @returns [{ zone, garment (NGL), built (sew.js result: mesh, hide, posed, …), source }]  lower garments first
 */
import { parsePhoto, cutGarment, measuredLowerLength } from './parse.js';
import { cleanGarment, wearerSex } from './clean.js';
import { detectPose } from './pose.js';
import { photoMeasures, modelMeasures, nextOverrides, fitError, resolveTarget } from './photofit.js';
import { posedBody, Photo } from './fit.js';
import { sewPattern } from './sew.js';
import { loadGarmentGLB, fitMeshGarment } from './mesh3d.js';

const UPPER = ['top', 'shirt', 'sweater', 'hoodie', 'jacket', 'tank'], LOWER = ['skirt', 'pants', 'shorts'];
export const zoneOf = (t) => (UPPER.includes(t) ? 'upper' : LOWER.includes(t) ? 'lower' : 'full');
const CATEGORY = { upper: (t) => (t === 'jacket' ? 'outerwear' : 'top'), lower: (t) => t, full: () => 'dress' };

/** the body's measurements the pattern is sized to (cm) */
export function bodyMeasures(human) {
  const B = human.active, sh = B.ensureShape(), gi = sh.girths({ ...B.morphs, width: B.width }), s = human.scale * 100;
  const ctx = posedBody(B, human);
  return {
    height: human.heightM * 100, bust: gi.bust * s, underbust: gi.underbust * s, waist: gi.waist * s, hips: gi.hips * s,
    shoulder_w: human.measure().width * 100, neck_w: (2 * ctx.xN + 0.03) * 100,
    waist_line: (ctx.yNeckSide - ctx.L.waistY) * 100, hips_line: (ctx.L.waistY - ctx.L.hipY) * 100,
  };
}

/** an AIpparel pattern (GarmentCodeData specification) has the panels this garment needs in this zone */
export function specFits(spec, zone, type) {
  const names = Object.keys((spec.pattern || spec).panels || {});
  const has = (re) => names.some((n) => re.test(n));
  if (zone === 'upper') return has(/torso/);
  if (zone === 'lower') return /pants|jeans|trousers|shorts/.test(type) ? has(/^pant_/) : has(/skirt/) && !has(/^pant_/);
  return has(/torso/) && has(/skirt/);
}

export async function garmentsFromPhoto(human, image, { describe, pattern, designs = {}, specs = {}, models = {}, under = [], onStep = () => {}, fitRounds = 3 }) {
  onStep('Finding the clothes in the photo…');
  const parsed = await parsePhoto(image);
  const c = document.createElement('canvas'), k = Math.min(1, 1024 / Math.max(image.width, image.height));
  c.width = Math.round(image.width * k); c.height = Math.round(image.height * k);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  onStep('Reading what each garment is…');
  let { garments = [], onGarment: named = [], madeFor = 'unisex', wornBy = 'nobody' } = await describe(c.toDataURL('image/jpeg', 0.9));
  // what the vision model named on the garments, plus what's always worth a look (its list varies from run to run)
  const onGarment = [...new Set([...named, 'necklace', 'chain', 'hand', 'long_hair', 'bag_strap'])];
  // whose clothes: menswear on the male model, womenswear on the female one (unisex: the one shown)
  // (unisex: whoever wears them in the photo; nobody: the model already shown)
  let sex = madeFor === 'men' ? 'male' : madeFor === 'women' ? 'female' : wornBy === 'man' ? 'male' : wornBy === 'woman' ? 'female' : null;
  // the vision model can't tell (a torso without a face): the photo itself decides (CLIPSeg over the person)
  if (!sex) sex = (await wearerSex(parsed).catch(() => null)) || human.sex;
  if (sex !== human.sex) { onStep(`These are ${madeFor}'s clothes: dressing the ${sex} model…`); human.setSex(sex); }
  const B = human.active;
  const body = bodyMeasures(human);
  onStep('Finding the body in the photo…');
  const kp = await detectPose(parsed).catch(() => null);
  // the vision model named nothing (it happens): the clothes-parsing model's own classes stand in
  if (!garments.length) {
    const cnt = new Map(); for (const l of parsed.label) cnt.set(l, (cnt.get(l) || 0) + 1);
    const share = (...ls) => ls.reduce((a, l) => a + (cnt.get(l) || 0), 0) / parsed.label.length;
    if (share(7) > 0.03) garments.push({ type: 'dress', upper: {}, lower: {} });
    else {
      if (share(4) > 0.02) garments.push({ type: 'top', upper: {} });
      if (share(6) > 0.02) garments.push({ type: 'pants', lower: {} });
      else if (share(5) > 0.02) garments.push({ type: 'skirt', lower: {} });
    }
  }
  const out = [], worn = [...under], seen = new Set();
  const order = garments.map((g) => ({ g, zone: zoneOf(g.type) })).sort((a, b) => (a.zone === 'lower' ? -1 : 1) - (b.zone === 'lower' ? -1 : 1));
  for (const { g, zone } of order) {
    if (seen.has(zone)) continue;
    const cut = cutGarment(parsed, zone);
    const share = cut.mask.reduce((a, v) => a + v, 0) / (parsed.w * parsed.h);
    if (share < 0.015 || cut.bbox.h / parsed.h < 0.25) continue;               // not really in this photo
    seen.add(zone);
    const garment = structuredClone(g);
    if (zone !== 'upper' && garment.lower) garment.lower.length = measuredLowerLength(parsed, cut.mask) || garment.lower.length;
    // the other garments the vision model saw in this zone are worn under this one (it's the one that got cut)
    const underIt = garments.filter((o) => o !== g && zoneOf(o.type) === zone).map((o) => o.type);
    const clean = await cleanGarment(parsed, cut, { onGarment, under: underIt, onStep });
    onStep(`Cutting the ${g.type}'s sewing pattern…`);
    const pat = await pattern({ garment, design: designs[zone], zone, sex: human.sex, body });
    // how close it sits (sew.js hugs a fitted / tight garment onto the body: negative ease, as a knit is worn)
    const snug = zone === 'lower' ? (/skinny/.test(garment.lower?.leg) ? 'skinny' : /pencil|straight|bodycon/.test(garment.lower?.skirt_shape) && g.type === 'skirt' ? 'fitted' : null)
      : garment.upper?.fit;
    const item = { id: `${g.type}-${zone}`, name: g.type, type: g.type, category: CATEGORY[zone](g.type), zone, backFill: 'color', fit: snug };
    let detail = null;
    if (models[zone]) {
      onStep(`Fitting the ${g.type}'s 3D model…`);
      const fm = await fitMeshGarment(B, human, { ...item, length: zone === 'upper' ? garment.upper?.length : garment.lower?.length },
        await loadGarmentGLB(models[zone]), { under: worn.map((w) => w.posed) });
      detail = fm.detail; fm.dispose();
    }
    onStep(`Sewing the ${g.type} on the model…`);
    const photo = { front: new Photo(clean.cut, clean.geometry) };
    const sew = (p) => sewPattern(B, human, item, p, photo, { under: worn.map((w) => w.posed), detail });
    let built = sew(pat);
    // the fit: measured on the photo, measured on our model, re-cut until they agree
    const measured = kp ? photoMeasures(parsed, cut.mask, kp, zone, { kind: /pants|jeans|trousers/.test(g.type) ? 'pants' : g.type }) : {};
    const lowerWorn = out.find((o) => o.zone === 'lower');
    const target = resolveTarget(human, measured, lowerWorn ? lowerWorn.built.posed.pts : null);
    let now = modelMeasures(human, built.posed.pts, zone), err = fitError(target, now), fit = pat.fit || {}, ov = {};
    const fitLog = [{ now, err }];
    for (let r = 0; r < fitRounds && Object.keys(target).length && err > 0.05; r++) {
      const o = nextOverrides(zone, target, now, fit, ov);
      if (JSON.stringify(o) === JSON.stringify(ov)) break;
      onStep(`Matching the ${g.type} to the photo (${r + 1}/${fitRounds})…`);
      const p2 = await pattern({ garment, design: designs[zone], zone, sex: human.sex, body, overrides: o });
      const b2 = sew(p2), n2 = modelMeasures(human, b2.posed.pts, zone), e2 = fitError(target, n2);
      fitLog.push({ overrides: o, now: n2, err: e2 });
      if (e2 < err) { built.dispose(); built = b2; now = n2; err = e2; fit = p2.fit || fit; ov = o; } else { b2.dispose(); break; }
    }
    // AIpparel's pattern for this zone (a whole sewing pattern from the photo): a candidate when its panels are the
    // right kind of garment (it reads nearly everything as a dress: no trouser legs for trousers → not used), sewn on
    // the same body and kept only if it measures closer to the photo than the fitted ChatGarment/NGL pattern
    let source = designs[zone] ? 'chatgarment' : 'ngl';
    if (specs[zone] && specFits(specs[zone], zone, g.type)) {
      onStep(`Trying AIpparel's pattern for the ${g.type}…`);
      const p3 = await pattern({ spec: specs[zone], zone, sex: human.sex, body });
      const b3 = sew(p3), n3 = modelMeasures(human, b3.posed.pts, zone), e3 = Object.keys(target).length ? fitError(target, n3) : Infinity;
      fitLog.push({ source: 'aipparel', now: n3, err: e3 });
      if (e3 < err) { built.dispose(); built = b3; now = n3; err = e3; source = 'aipparel'; } else b3.dispose();
    }
    worn.push(built);
    out.push({ zone, garment, built, target, fit: fitLog, sex, source });
  }
  return out;
}
