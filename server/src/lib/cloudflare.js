import { TYPES as WARDROBE_TYPES, ZONES as WARDROBE_ZONES, VIEWS as WARDROBE_VIEWS } from '../shared/wardrobe.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const API = 'https://api.cloudflare.com/client/v4';

export const cloudflareConfigured = () => Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);

function modelUrl(model) {
  const { accountId, gatewayId } = config.cloudflare;
  return gatewayId
    ? `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`
    : `${API}/accounts/${accountId}/ai/run/${model}`;
}

const authHeaders = () => ({
  Authorization: `Bearer ${config.cloudflare.apiToken}`,
  'Content-Type': 'application/json',
});

/** Run any Workers AI model over REST. Returns `result`. */
export async function runModel(model, input, { timeoutMs = 60_000 } = {}) {
  if (!cloudflareConfigured()) throw new HttpError(503, 'Cloudflare AI is not configured on the server');
  const res = await fetch(modelUrl(model), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok || json?.success === false) {
    const msg = json?.errors?.map((e) => e.message).join('; ') || text.slice(0, 300) || res.statusText;
    const err = new Error(`Cloudflare AI ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json?.result ?? json;
}

const licensed = new Set();
/** Some Meta models require a one-time "agree" call per account. Handle it transparently. */
async function runLicensed(model, input, opts) {
  try {
    return await runModel(model, input, opts);
  } catch (err) {
    if (/agree/i.test(err.message) && !licensed.has(model)) {
      await runModel(model, { prompt: 'agree' }).catch(() => {});
      licensed.add(model);
      return runModel(model, input, opts);
    }
    throw err;
  }
}

export async function verifyCloudflare() {
  if (!cloudflareConfigured()) return { ok: false, error: 'not configured' };
  const { accountId } = config.cloudflare;
  for (const url of [`${API}/user/tokens/verify`, `${API}/accounts/${accountId}/tokens/verify`]) {
    try {
      const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) return { ok: true, status: json.result?.status || 'active' };
    } catch { /* try next */ }
  }
  return { ok: false, error: 'token verification failed' };
}

/* ------------------------------------------------------------------ */
/* Garment description                                                 */
/* ------------------------------------------------------------------ */

const TYPES = [
  'tshirt', 'shirt', 'blouse', 'polo', 'sweater', 'hoodie', 'sweatshirt', 'tank', 'crop_top', 'jersey',
  'jacket', 'coat', 'blazer', 'cardigan', 'vest', 'dress', 'gown', 'jumpsuit', 'kaftan', 'agbada',
  'skirt', 'wrapper', 'trousers', 'jeans', 'leggings', 'joggers', 'chinos', 'shorts', 'other',
];
const ENUMS = {
  sleeve: ['none', 'short', 'elbow', 'three_quarter', 'long'],
  fit: ['tight', 'regular', 'loose', 'oversized'],
  view: ['front', 'back', 'unknown'],
  presentation: ['flat_lay', 'hanger', 'mannequin', 'worn', 'other'],
};

const PROMPT = `You are a fashion cataloguing system. Look at the single garment in the photo and reply with ONLY a JSON object, no prose, using exactly these keys:
{"name": short product-style name (max 5 words),
 "type": one of ${TYPES.join('|')},
 "sleeve": one of ${ENUMS.sleeve.join('|')},
 "fit": one of ${ENUMS.fit.join('|')},
 "view": one of ${ENUMS.view.join('|')},
 "presentation": one of ${ENUMS.presentation.join('|')},
 "primary_color": hex like "#1a2b3c",
 "pattern": short word e.g. solid|striped|checked|floral|graphic|ankara,
 "material": best guess e.g. cotton|denim|linen|knit|silk|leather|polyester,
 "confidence": number 0-1}`;

function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return {}; }
}

const pick = (v, allowed, fallback) => {
  const t = typeof v === 'string' ? v.toLowerCase().trim().replace(/[\s-]+/g, '_') : '';
  return allowed.includes(t) ? t : fallback;
};

export function normalizeAnalysis(raw) {
  const color = typeof raw.primary_color === 'string' && /^#?[0-9a-f]{6}$/i.test(raw.primary_color.trim())
    ? `#${raw.primary_color.trim().replace('#', '').toLowerCase()}` : null;
  const conf = Number(raw.confidence);
  return {
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : null,
    type: pick(raw.type, TYPES, 'other'),
    sleeve: pick(raw.sleeve, ENUMS.sleeve, null),
    fit: pick(raw.fit, ENUMS.fit, 'regular'),
    view: pick(raw.view, ENUMS.view, 'unknown'),
    presentation: pick(raw.presentation, ENUMS.presentation, 'other'),
    primary_color: color,
    pattern: typeof raw.pattern === 'string' ? raw.pattern.toLowerCase().slice(0, 24) : null,
    material: typeof raw.material === 'string' ? raw.material.toLowerCase().slice(0, 24) : null,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
}

/** Describe a garment image (JPEG buffer) with the configured vision model. */
export async function describeGarment(jpeg) {
  const model = config.cloudflare.visionModel;
  const b64 = jpeg.toString('base64');
  let input;
  if (/llama-3\.2-11b-vision/.test(model)) {
    input = { messages: [{ role: 'user', content: PROMPT }], image: Array.from(jpeg), max_tokens: 400, temperature: 0.1 };
  } else {
    input = {
      messages: [
        { role: 'system', content: 'You output strict JSON only.' },
        { role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ] },
      ],
      max_tokens: 400,
      temperature: 0.1,
    };
  }
  const result = await runLicensed(model, input, { timeoutMs: 45_000 });
  const raw = result?.response ?? result?.description ?? result;
  return { ...normalizeAnalysis(extractJson(raw)), model };
}

/* ------------------------------------------------------------------ */
/* Wardrobe: describe each photo of a group, then group them           */
/* ------------------------------------------------------------------ */


const W_TYPES = Object.keys(WARDROBE_TYPES);
const W_PROMPT = `You catalogue clothing photos for a virtual try-on. Describe ONLY what is visible in this photo of ONE item. Do not guess hidden parts.
Reply with ONLY a JSON object with exactly these keys:
{"name": short product-style name (max 5 words),
 "type": one of ${W_TYPES.join('|')}|other,
 "zone": where it is worn, one of ${WARDROBE_ZONES.join('|')} (head=hats, upper=tops/jackets, full=dresses/jumpsuits, lower=trousers/skirts/shorts, feet=shoes),
 "view": which side of the item the photo shows, one of ${WARDROBE_VIEWS.join('|')} (front has the neckline dip / buttons / main print; back is plainer with a higher neckline; side is a profile; detail is a close-up),
 "presentation": one of flat_lay|hanger|mannequin|worn|other,
 "fit": one of tight|regular|loose|oversized,
 "primary_color": hex like "#1a2b3c",
 "pattern": one word, e.g. solid|striped|checked|floral|graphic|print|ankara|denim|knit,
 "material": best guess e.g. cotton|denim|linen|knit|silk|leather|polyester|wool,
 "details": one short sentence of distinctive visible features (collar, buttons, pockets, prints, text, trims) to tell this item apart from similar ones,
 "confidence": number 0-1}`;

const pickW = (v, allowed, fallback) => {
  const t = typeof v === 'string' ? v.toLowerCase().trim().replace(/[\s-]+/g, '_') : '';
  return allowed.includes(t) ? t : fallback;
};

function visionInput(model, prompt, jpeg, maxTokens) {
  if (/llama-3\.2-11b-vision/.test(model)) {
    return { messages: [{ role: 'user', content: prompt }], image: Array.from(jpeg), max_tokens: maxTokens, temperature: 0.1 };
  }
  return {
    messages: [
      { role: 'system', content: 'You output strict JSON only.' },
      { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }] },
    ],
    max_tokens: maxTokens,
    temperature: 0.1,
  };
}

/** One photo of a group → normalized description (type, zone, view, colours, details …). */
export async function describeForWardrobe(jpeg) {
  const model = config.cloudflare.visionModel;
  const result = await runLicensed(model, visionInput(model, W_PROMPT, jpeg, 500), { timeoutMs: 45_000 });
  const raw = extractJson(result?.response ?? result?.description ?? result);
  const color = typeof raw.primary_color === 'string' && /^#?[0-9a-f]{6}$/i.test(raw.primary_color.trim()) ? `#${raw.primary_color.trim().replace('#', '').toLowerCase()}` : null;
  const conf = Number(raw.confidence);
  return {
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : null,
    type: pickW(raw.type, W_TYPES, 'other'),
    zone: pickW(raw.zone, WARDROBE_ZONES, null),
    view: pickW(raw.view, WARDROBE_VIEWS, null),
    presentation: pickW(raw.presentation, ['flat_lay', 'hanger', 'mannequin', 'worn', 'other'], 'other'),
    fit: pickW(raw.fit, ['tight', 'regular', 'loose', 'oversized'], 'regular'),
    primary_color: color,
    pattern: typeof raw.pattern === 'string' ? raw.pattern.toLowerCase().trim().slice(0, 24) : null,
    material: typeof raw.material === 'string' ? raw.material.toLowerCase().trim().slice(0, 24) : null,
    details: typeof raw.details === 'string' ? raw.details.trim().slice(0, 240) : null,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
    model,
  };
}

/**
 * Which photos show the same garment, decided from their descriptions and measured colour
 * distances. Returns { groups: [[i, …], …], names: [..] } or null when the answer is unusable.
 */
export async function groupWithAI(photos, distances) {
  const model = config.cloudflare.textModel || config.cloudflare.visionModel;
  const lines = photos.map((p, i) => `#${i}: type=${p.ai?.type || '?'} zone=${p.ai?.zone || '?'} view=${p.ai?.view || '?'} colours=${(p.signature?.colors || []).map((c) => `${c.hex}(${Math.round(c.share * 100)}%)`).join(' ')} pattern=${p.ai?.pattern || '?'} name="${p.ai?.name || ''}" details="${p.ai?.details || ''}"`);
  const close = [];
  for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) close.push(`#${i}-#${j}: ${distances[i][j]}`);
  const prompt = `These are ${photos.length} photos a shop owner uploaded together. Several photos can show the SAME garment from different sides (front, back, side). Decide which photos show the same physical garment.
Photos:
${lines.join('\n')}
Measured colour difference between photos (0 = identical colours, above 20 = clearly different garments):
${close.join('; ')}
Rules: same garment = same type, same colours, compatible views (e.g. a front and a back). Different colours or different types are different garments. Every photo belongs to exactly one garment.
Reply with ONLY JSON: {"garments":[{"photos":[indices],"name":"short product name"}]}`;
  const result = await runLicensed(model, { messages: [{ role: 'system', content: 'You output strict JSON only.' }, { role: 'user', content: prompt }], max_tokens: 400, temperature: 0 }, { timeoutMs: 45_000 });
  const raw = extractJson(result?.response ?? result);
  if (!Array.isArray(raw.garments)) return null;
  const groups = raw.garments.map((g) => (Array.isArray(g.photos) ? g.photos.map((x) => Number(String(x).replace('#', ''))) : null));
  if (groups.some((g) => !g || !g.length)) return null;
  return { groups, names: raw.garments.map((g) => (typeof g.name === 'string' ? g.name.trim().slice(0, 60) : null)) };
}
