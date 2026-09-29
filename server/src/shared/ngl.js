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
} ]}
Rules:
- One entry per separate garment that is visible (e.g. a top and a skirt are two entries; a dress or jumpsuit is ONE entry).
- "upper" is required for top/shirt/sweater/hoodie/jacket/tank/dress/jumpsuit; omit it for skirt/pants/shorts.
- "lower" is required for dress/jumpsuit/skirt/pants/shorts; omit it for tops. For a dress, "lower" describes its skirt part.
- "skirt_shape" is only for skirts/dresses; "leg" only for pants/shorts/jumpsuits.
- Lengths are where the hem falls on the wearer's body. For a flat-laid garment, judge from its proportions.
- If a detail is hidden, give your best guess from the options.`;

const pick = (v, allowed, dflt) => {
  const t = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.includes(t) ? t : dflt;
};

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
