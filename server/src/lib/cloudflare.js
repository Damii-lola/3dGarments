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
