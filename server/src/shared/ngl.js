/**
 * NGL — Natural Garment Language (the method of Badalyan et al. 2026, "NGL: Natural Garment Language
 * for Training-Free Sewing Pattern Estimation"). A vision-language model describes a garment's cut by
 * picking words from a fixed vocabulary (it describes well in words but guesses numbers badly); the
 * words are then mapped deterministically onto GarmentCode sewing-pattern parameters
 * (tools/garment_ml/ngl/ngl.py). The vocabulary is ngl-vocab.json, shared with that mapper.
 * Runs unchanged in Node and the browser.
 */
import VOCAB from './ngl-vocab.json' with { type: 'json' };

export { VOCAB };

const opts = (o) => Object.entries(o).map(([k, v]) => `"${k}": ${v.join('|')}`).join(', ');

export const NGL_PROMPT = `You are a fashion pattern-maker. Look at the garment(s) in the photo and describe their CUT (not colour).
Answer with strict JSON only, no prose, choosing every value ONLY from the options listed:
{"garments": [ {
  "type": one of ${VOCAB.types.join('|')},
  "upper": { ${opts(VOCAB.upper)} },
  "lower": { ${opts(VOCAB.lower)} }
} ],
 "made_for": one of ${VOCAB.made_for.join('|')} (whose clothes these are: the cut, the fit, the styling and who wears them in the photo),
 "on_garment": [ things that are NOT part of the garments but lie on or in front of them in this photo, only from: ${VOCAB.on_garment.join('|')} ] }
Rules:
- One entry per separate garment that is visible (e.g. a top and a skirt are two entries; a dress or jumpsuit is ONE entry).
- "upper" is required for top/shirt/sweater/hoodie/jacket/tank/dress/jumpsuit; omit it for skirt/pants/shorts.
- "lower" is required for dress/jumpsuit/skirt/pants/shorts; omit it for tops. For a dress, "lower" describes its skirt part.
- "skirt_shape" is only for skirts/dresses; "leg" only for pants/shorts/jumpsuits.
- Lengths are where the hem falls on the wearer's body. For a flat-laid garment, judge from its proportions.
- If a detail is hidden, give your best guess from the options.
- "on_garment": list every accessory or body part covering part of a garment (a necklace or chain over a top, a bag strap
  across it, a hand on it, long hair over it …); an empty list if nothing covers them. Prints, logos, pockets, buttons
  and patches ARE part of the garment: never list them.`;

const pick = (v, allowed, dflt) => {
  const t = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.includes(t) ? t : dflt;
};

/** whose clothes these are → 'men' | 'women' | 'unisex' (unisex when unsure) */
export function parseMadeFor(answer) {
  if (typeof answer === 'string') {
    const s = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
    try { answer = s ? JSON.parse(s) : {}; } catch { answer = {}; }
  }
  return pick(answer?.made_for, VOCAB.made_for, 'unisex');
}

/** what the model says lies on the garments (accessories, hands …) → words from VOCAB.on_garment */
export function parseOnGarment(answer) {
  if (typeof answer === 'string') {
    const s = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
    try { answer = s ? JSON.parse(s) : {}; } catch { answer = {}; }
  }
  const list = Array.isArray(answer?.on_garment) ? answer.on_garment : [];
  return [...new Set(list.map((w) => pick(w, VOCAB.on_garment, null)).filter(Boolean))];
}

/** the model's answer (object or text) → [{ type, upper?, lower? }] with every value from the vocabulary */
export function parseNGL(answer) {
  if (typeof answer === 'string') {
    const s = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
    try { answer = s ? JSON.parse(s) : {}; } catch { answer = {}; }
  }
  const out = [];
  for (const g of (answer?.garments || []).slice(0, 3)) {
    const type = pick(g?.type, VOCAB.types, null);
    if (!type) continue;
    const e = { type };
    if (!['skirt', 'pants', 'shorts'].includes(type)) {
      e.upper = Object.fromEntries(Object.entries(VOCAB.upper).map(([k, v]) => [k, pick(g.upper?.[k], v, VOCAB.defaults.upper[k])]));
    }
    if (['dress', 'jumpsuit', 'skirt', 'pants', 'shorts'].includes(type)) {
      e.lower = Object.fromEntries(Object.entries(VOCAB.lower).map(([k, v]) => [k, pick(g.lower?.[k], v, VOCAB.defaults.lower[k])]));
    }
    out.push(e);
  }
  return out;
}
