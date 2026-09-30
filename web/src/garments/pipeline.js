/**
 * One photo → the garments in it, made and worn on the model. Every system we have, each for what it does best:
 *
 *   parse.js       clothes parsing (SegFormer): which pixels are which garment; hem length measured on the wearer
 *   NGL (API)      Cloudflare vision → garment words: what each garment is, a second opinion on sleeves / neckline
 *   ChatGarment    (a GPU job, tools/garment_ml/chatgarment) → GarmentCode design: the garment's CUT, when we have it
 *   pattern (API)  py/pattern.py + py/combine.py: ChatGarment's cut + our lengths + the votes → a sewing pattern
 *                  sized to this body
 *   sew.js         the pattern sewn and draped on the body (cloth simulation), textured from the photo
 *   TRELLIS.2      (a GPU job, tools/garment_ml/trellis2) → a textured 3D garment, when we have it: its look on
 *                  the sides the photo can't see, and its relief (mesh3d.js fits it on the same body)
 *
 * @param opts {
 *   describe(jpegDataUrl) → { garments: [NGL garment] }       (POST /api/ngl/describe)
 *   pattern(req) → pattern                                    (POST /api/ngl/pattern)
 *   designs?: { upper?, lower?, full? }  ChatGarment designs for this photo
 *   models?:  { upper?, lower?, full? }  TRELLIS.2 GLB urls for this photo
 *   onStep?(text)
 * }
 * @returns [{ zone, garment (NGL), built (sew.js result: mesh, hide, posed, …) }]  lower garments first
 */
import { parsePhoto, cutGarment, measuredLowerLength } from './parse.js';
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

export async function garmentsFromPhoto(human, image, { describe, pattern, designs = {}, models = {}, under = [], onStep = () => {} }) {
  const B = human.active;
  onStep('Finding the clothes in the photo…');
  const parsed = await parsePhoto(image);
  const c = document.createElement('canvas'), k = Math.min(1, 1024 / Math.max(image.width, image.height));
  c.width = Math.round(image.width * k); c.height = Math.round(image.height * k);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  onStep('Reading what each garment is…');
  const { garments = [] } = await describe(c.toDataURL('image/jpeg', 0.9));
  const body = bodyMeasures(human);
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
    onStep(`Cutting the ${g.type}'s sewing pattern…`);
    const pat = await pattern({ garment, design: designs[zone], zone, sex: human.sex, body });
    const item = { id: `${g.type}-${zone}`, name: g.type, type: g.type, category: CATEGORY[zone](g.type), zone, backFill: 'color' };
    let detail = null;
    if (models[zone]) {
      onStep(`Fitting the ${g.type}'s 3D model…`);
      const fm = await fitMeshGarment(B, human, { ...item, length: zone === 'upper' ? garment.upper?.length : garment.lower?.length },
        await loadGarmentGLB(models[zone]), { under: worn.map((w) => w.posed) });
      detail = fm.detail; fm.dispose();
    }
    onStep(`Sewing the ${g.type} on the model…`);
    const built = sewPattern(B, human, item, pat, { front: new Photo(cut.cut, cut.geometry) }, { under: worn.map((w) => w.posed), detail });
    worn.push(built);
    out.push({ zone, garment, built });
  }
  return out;
}
