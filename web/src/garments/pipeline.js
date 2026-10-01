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
 *   Hunyuan3D 2.1  (tools/garment_ml/hunyuan3d) → an untextured 3D garment shape: its relief, where TRELLIS.2 has none
 *
 * @param opts {
 *   describe(jpegDataUrl) → { garments: [NGL garment] }       (POST /api/ngl/describe)
 *   pattern(req) → pattern                                    (POST /api/ngl/pattern)
 *   designs?: { upper?, lower?, full? }  ChatGarment designs for this photo
 *   specs?:   { upper?, lower?, full? }  AIpparel patterns for this photo (tools/garment_ml/aipparel)
 *   models?:  { upper?, lower?, full? }  3D model GLB url(s) for this photo, best first (TRELLIS.2, Hunyuan3D 2.1)
 *   onStep?(text)
 *   onSex?(sex)   the model being dressed (the clothes' sex), before anything is made for it
 *   fitRounds?    re-cuts to match the photo (3), while the fit error is above fitTolerance (0.05)
 *   search?       CLIPSeg looks for what the vision model named on the garments (false: the app; see clean.js)
 *   painter?      'patch' (instant) | 'lama'
 *   onDraft?(builts)  each garment's first drape, as soon as it's sewn (the app shows it; the re-cuts to the photo
 *                 follow). Replaced drafts are then returned in result.retired for the caller to dispose
 *   alive?()      false once the caller has given up: the pipeline stops (throws an Error with .cancelled)
 *   parseSize?    the clothes parser's input (512²; 384²: half the time, the cut-outs ~97 % the same)
 * }
 * @returns [{ zone, garment (NGL), built (sew.js result: mesh, hide, posed, …), source }]  lower garments first
 */
import { parsePhoto, cutGarment, measuredLowerLength } from './parse.js';
import { cleanGarment, wearerSex } from './clean.js';
import { detectPose } from './pose.js';
import { photoMeasures, modelMeasures, nextOverrides, fitError, resolveTarget } from './photofit.js';
import { posedBody, Photo } from './fit.js';
import { sewPattern } from './sew.js';
import { loadGarmentGLB, fitMeshGarment, isVolumetric } from './mesh3d.js';

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

export async function garmentsFromPhoto(human, image, { describe, pattern, designs = {}, specs = {}, models = {}, under = [], onStep = () => {}, onSex = null,
  fitRounds = 3, fitTolerance = 0.05, search = false, painter = 'patch', parseSize = 512, onDraft = null, alive = () => true }) {
  // the caller gave up on this photo (the clothes taken off, the other model chosen): stop where we are
  const check = () => { if (!alive()) { const e = new Error('cancelled'); e.cancelled = true; throw e; } };
  onStep('Finding the clothes in the photo…');
  // the vision model (a server round trip) reads the photo while the clothes parser and the pose model run here
  const c = document.createElement('canvas'), k = Math.min(1, 768 / Math.max(image.width, image.height));
  c.width = Math.round(image.width * k); c.height = Math.round(image.height * k);
  // (a CPU canvas: reading a GPU one back costs seconds on some devices)
  c.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, c.width, c.height);
  // (encoded asynchronously, and sent BEFORE the parser starts: its model run holds the page for seconds, and the
  // request would only leave after it)
  const jpeg = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not encode the photo'))), 'image/jpeg', 0.88))
    .then((b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }));
  const described = describe(jpeg);
  described.catch(() => {});
  await new Promise((r) => setTimeout(r, 0));           // (let the request go out)
  const parsed = await parsePhoto(image, 1024, parseSize);
  const posed = detectPose(parsed).catch(() => null);
  onStep('Reading what each garment is…');
  let { garments = [], onGarment: named = [], madeFor = 'unisex', wornBy = 'nobody' } = await described;
  check();
  // what the vision model named on the garments, plus what's always worth a look (its list varies from run to run)
  const onGarment = [...new Set([...named, 'necklace', 'chain', 'hand', 'long_hair', 'bag_strap'])];
  // whose clothes: menswear on the male model, womenswear on the female one (unisex: the one shown)
  // (unisex: whoever wears them in the photo; nobody: the model already shown)
  let sex = madeFor === 'men' ? 'male' : madeFor === 'women' ? 'female' : wornBy === 'man' ? 'male' : wornBy === 'woman' ? 'female' : null;
  // the vision model can't tell (a torso without a face): the photo itself decides (CLIPSeg over the person)
  if (!sex && search) sex = await wearerSex(parsed).catch(() => null);
  sex ||= human.sex;
  if (sex !== human.sex) { onStep(`These are ${madeFor}'s clothes: dressing the ${sex} model…`); human.setSex(sex); }
  // the app puts that model's own body settings on before anything is cut for it
  if (onSex) await onSex(sex);
  check();
  const B = human.active;
  const body = bodyMeasures(human);
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
  // every garment's region, and its first sewing pattern asked for right away: the server cuts them while the
  // photo is cleaned and the garments before it are sewn
  const jobs = [];
  for (const { g, zone } of order) {
    if (seen.has(zone)) continue;
    const cut = cutGarment(parsed, zone);
    const share = cut.mask.reduce((a, v) => a + v, 0) / (parsed.w * parsed.h);
    if (share < 0.015 || cut.bbox.h / parsed.h < 0.25) continue;               // not really in this photo
    seen.add(zone);
    const garment = structuredClone(g);
    if (zone !== 'upper' && garment.lower) garment.lower.length = measuredLowerLength(parsed, cut.mask) || garment.lower.length;
    const pat = pattern({ garment, design: designs[zone], zone, sex: human.sex, body });
    pat.catch(() => {});
    jobs.push({ g, zone, cut, garment, pat });
  }
  /* ---- pass 1, drafts: every garment cleaned, sewn on the body (over the drafts under it) and shown at once ---- */
  const drafts = [];
  for (const job of jobs) {
    const { g, zone, cut, garment, pat: patP } = job;
    // the other garments the vision model saw in this zone are worn under this one (it's the one that got cut)
    const underIt = garments.filter((o) => o !== g && zoneOf(o.type) === zone).map((o) => o.type);
    const clean = await cleanGarment(parsed, cut, { onGarment, under: underIt, onStep, search, painter });
    onStep(`Cutting the ${g.type}'s sewing pattern…`);
    const pat = await patP;
    check();
    // how close it sits (sew.js hugs a fitted / tight garment onto the body: negative ease, as a knit is worn)
    const snug = zone === 'lower' ? (/skinny/.test(garment.lower?.leg) ? 'skinny' : /pencil|straight|bodycon/.test(garment.lower?.skirt_shape) && g.type === 'skirt' ? 'fitted' : null)
      : garment.upper?.fit;
    const item = { id: `${g.type}-${zone}`, name: g.type, type: g.type, category: CATEGORY[zone](g.type), zone, backFill: 'color', fit: snug };
    // the 3D models of this garment, best first (TRELLIS.2: look + relief; Hunyuan3D 2.1: relief): the first that is
    // a real 3D garment (not a flat relief of the photo) gives the sewn garment its relief and unseen sides
    let detail = null;
    for (const url of [].concat(models[zone] || [])) {
      const src = await loadGarmentGLB(url).catch(() => null);
      if (!src || !isVolumetric(src)) continue;
      onStep(`Fitting the ${g.type}'s 3D model…`);
      const fm = await fitMeshGarment(B, human, { ...item, length: zone === 'upper' ? garment.upper?.length : garment.lower?.length },
        src, { under: drafts.map((d) => d.built.posed) });
      detail = fm.detail; fm.dispose();
      break;
    }
    onStep(`Sewing the ${g.type} on the model…`);
    const photo = { front: new Photo(clean.cut, clean.geometry) };
    Object.assign(job, { item, detail, photo, pat, best: pat });
    job.built = await sewPattern(B, human, item, pat, photo, { under: [...under, ...drafts.map((d) => d.built)].map((w) => w.posed), detail });
    if (!alive()) { job.built.dispose(); check(); }
    drafts.push(job);
    await onDraft?.(drafts.map((d) => d.built));
  }

  /* ---- pass 2, the fit: measured on the photo and on our model, re-cut until they agree (each garment over the
     final ones under it: one under it that changed means this one is sewn again) ---- */
  const retired = [];
  let changedUnder = false;
  for (const job of drafts) {
    check();
    const { g, zone, cut, garment, item, photo, detail } = job;
    const sew = (p) => sewPattern(B, human, item, p, photo, { under: worn.map((w) => w.posed), detail });
    let built = job.built;
    if (changedUnder) { retired.push(built); built = await sew(job.best); }
    const kp = await posed;                    // (the pose model ran while the server was busy)
    const measured = kp ? photoMeasures(parsed, cut.mask, kp, zone, { kind: /pants|jeans|trousers/.test(g.type) ? 'pants' : g.type }) : {};
    const lowerWorn = out.find((o) => o.zone === 'lower');
    const target = resolveTarget(human, measured, lowerWorn ? lowerWorn.built.posed.pts : null);
    let now = modelMeasures(human, built.posed.pts, zone), err = fitError(target, now), fit = job.pat.fit || {}, ov = {};
    const fitLog = [{ now, err }];
    const keep = (b) => { if (built === job.built) retired.push(built); else built.dispose(); built = b; };
    const hist = [{ fit: { ...fit }, now }];       // every cut measured: its knob values → its measures
    for (let r = 0; r < fitRounds && Object.keys(target).length && err > fitTolerance; r++) {
      const last = hist[hist.length - 1];
      const o = nextOverrides(zone, target, last.now, last.fit, ov, hist);
      if (JSON.stringify(o) === JSON.stringify(ov)) break;
      onStep(`Matching the ${g.type} to the photo (${r + 1}/${fitRounds})…`);
      // a round that can't be had (the pattern service unreachable) keeps the garment as it is
      const p2 = await pattern({ garment, design: designs[zone], zone, sex: human.sex, body, overrides: o }).catch((e) => { console.warn('fit round skipped:', e.message); return null; });
      if (!p2) break;
      check();
      const b2 = await sew(p2), n2 = modelMeasures(human, b2.posed.pts, zone), e2 = fitError(target, n2);
      fitLog.push({ overrides: o, now: n2, err: e2 });
      hist.push({ fit: { ...(p2.fit || {}) }, now: n2 });
      ov = o;
      // the best cut so far is kept; a worse one still tells the next round which way the measure moves
      if (e2 < err) { keep(b2); now = n2; err = e2; fit = p2.fit || fit; } else b2.dispose();
    }
    // AIpparel's pattern for this zone (a whole sewing pattern from the photo): a candidate when its panels are the
    // right kind of garment (it reads nearly everything as a dress: no trouser legs for trousers → not used), sewn on
    // the same body and kept only if it measures closer to the photo than the fitted ChatGarment/NGL pattern
    let source = designs[zone] ? 'chatgarment' : 'ngl';
    if (specs[zone] && specFits(specs[zone], zone, g.type)) {
      onStep(`Trying AIpparel's pattern for the ${g.type}…`);
      const p3 = await pattern({ spec: specs[zone], zone, sex: human.sex, body }).catch(() => null);
      if (p3) {
        const b3 = await sew(p3), n3 = modelMeasures(human, b3.posed.pts, zone), e3 = Object.keys(target).length ? fitError(target, n3) : Infinity;
        fitLog.push({ source: 'aipparel', now: n3, err: e3 });
        if (e3 < err) { keep(b3); now = n3; err = e3; source = 'aipparel'; } else b3.dispose();
      }
    }
    if (built !== job.built) changedUnder = true;
    worn.push(built);
    out.push({ zone, garment, built, target, fit: fitLog, sex, source });
  }
  // drafts that were replaced: the caller that showed them takes them off once the final ones are on
  if (onDraft) out.retired = retired; else for (const b of retired) b.dispose();
  return out;
}
