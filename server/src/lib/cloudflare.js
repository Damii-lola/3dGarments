import { TYPES as WARDROBE_TYPES, ZONES as WARDROBE_ZONES, VIEWS as WARDROBE_VIEWS } from '../shared/wardrobe.js';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const API = 'https://api.cloudflare.com/client/v4';

export const cloudflareConfigured = () => Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);

/**
 * One place that knows where a model lives, so the body scan and the wardrobe
 * reader cannot drift apart — and so `CLOUDFLARE_API_BASE` can point the whole
 * pipeline at a local stub and exercise it without spending a neuron.
 */
export function modelUrl(model) {
  const { accountId, gatewayId, apiBase } = config.cloudflare;
  return gatewayId
    ? `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`
    : `${apiBase}/accounts/${accountId}/ai/run/${model}`;
}

export const authHeaders = () => ({
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

/* ------------------------------------------------------------------ */
/* What Workers AI last said                                          */
/* ------------------------------------------------------------------ */

/**
 * A running note of every vision call, so "are we out of allowance?" is a
 * question the deployment can answer itself instead of a guess made from a log
 * that Render has already scrolled past. In memory only: a restart resets the
 * count, which is honest — it is a monitor, not a ledger.
 */
const monitor = {
  calls: 0,
  callsToday: 0,
  day: new Date().toISOString().slice(0, 10),
  errors: 0,
  lastOkAt: null,
  lastError: null, // { at, status, kind, message }
};

export function recordVision(ok, info = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== monitor.day) {
    monitor.day = today;
    monitor.callsToday = 0;
  }
  monitor.calls += 1;
  monitor.callsToday += 1;
  if (ok) {
    monitor.lastOkAt = new Date().toISOString();
    return;
  }
  monitor.errors += 1;
  monitor.lastError = { at: new Date().toISOString(), ...info };
}

export function visionStatus() {
  return { ...monitor };
}

/**
 * What the SERVER is actually holding — not what a dashboard shows.
 *
 * A rejected token is the one failure that looks identical from the outside to
 * three different causes: the token on the host was never updated, it was
 * pasted with a leading space or a missing character, or it belongs to a
 * different Cloudflare account than the account id beside it. None of those are
 * secrets, and none of them can be told apart from a 401. So describe the shape
 * of the value (length, charset, a short fingerprint) and the account id
 * itself, which is not secret and is in every request URL anyway.
 *
 * The token itself is never returned, and the fingerprint is one-way.
 */
export function tokenDiagnostics() {
  const token = config.cloudflare.apiToken || '';
  const account = config.cloudflare.accountId || '';
  return {
    token_set: Boolean(token),
    token_length: token.length,
    // A token must NEVER be returned, but its TYPE is not a secret and it
    // decides which verify endpoint can even answer: a user token verifies at
    // /user/tokens/verify, an account-owned token only at /accounts/{id}/tokens/verify,
    // where the account id we hold has to be the account that owns it.
    token_kind: tokenKind(token),
    token_whitespace: token !== token.trim(),
    token_fingerprint: token ? createHash('sha256').update(token).digest('hex').slice(0, 8) : null,
    account_id: account || null,
    // Account ids are 32 hex characters.
    account_looks_right: /^[0-9a-f]{32}$/i.test(account),
  };
}

/**
 * Cloudflare 2026 credentials are prefixed and scannable: `cfut_` (user token),
 * `cfat_` (account token), `cfk_` (global key) followed by 40 characters and a
 * checksum. Tokens made before that are plain 40-character strings. The length
 * check that used to live here called a perfectly good 58-character prefixed
 * token "unexpected", which is the sort of diagnostic that sends someone to
 * re-create a credential that was never the problem.
 */
function tokenKind(token) {
  if (!token) return 'missing';
  if (token.startsWith('cfut_')) return 'user token (cfut_)';
  if (token.startsWith('cfat_')) return 'account token (cfat_)';
  if (token.startsWith('cfk_')) return 'global API key (cfk_)';
  if (/^[A-Za-z0-9_-]{40}$/.test(token)) return 'legacy token (40 chars)';
  return `unrecognized (${token.length} chars)`;
}

/**
 * Which kind of "no" is this? They are not interchangeable, and a new API key
 * does not fix the first one:
 *
 *   capacity — Cloudflare's shared GPUs are busy. Wait a minute, retry.
 *   quota    — the account's daily free neurons are spent. A new TOKEN on the
 *              same account does nothing; the allowance is per account, per day.
 *   auth     — the token itself was rejected/revoked. THIS is the one a new key
 *              fixes.
 */
export function classifyAiError(status, body) {
  const text = String(body || '');
  if (status === 401 || status === 403) return 'auth';
  if (/daily free allocation|neurons|\bquota\b|usage limit|exceeded your/i.test(text)) return 'quota';
  if (status === 429) return 'capacity';
  if (status >= 500) return 'upstream';
  return 'error';
}

/** Something a shopper can act on, rather than a status code. */
export function aiErrorMessage(kind) {
  switch (kind) {
    case 'quota':
      return 'The measuring service has used its daily allowance. Please try again tomorrow.';
    case 'capacity':
      return 'The measuring service is at capacity right now. Please try again in a minute.';
    case 'auth':
      return 'The measuring service cannot read anything at the moment (its key was rejected).';
    case 'upstream':
      return 'The measuring service did not answer. Please try again.';
    default:
      return 'The measuring service could not read this clip. Please try again.';
  }
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
  // Both paths, with what each one actually said. An account-owned token can
  // only answer the second, and the second is only meaningful if the account id
  // we hold is the account that owns the token — so a bare "failed" hides the
  // very distinction that matters.
  const attempts = [];
  for (const path of ['/user/tokens/verify', `/accounts/${accountId}/tokens/verify`]) {
    try {
      const res = await fetch(`${API}${path}`, { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
      const json = await res.json().catch(() => null);
      const err = json?.errors?.[0];
      attempts.push({ path, status: res.status, code: err?.code ?? null, message: err?.message || (res.ok ? 'ok' : null) });
      if (res.ok && json?.success) return { ok: true, status: json.result?.status || 'active', attempts };
    } catch (e) {
      attempts.push({ path, status: null, message: e.message });
    }
  }
  return { ok: false, error: 'token verification failed', attempts };
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

/* ------------------------------------------------------------------ */
/* Chart column names                                                 */
/* ------------------------------------------------------------------ */

/**
 * Names a shopper could not act on. "length" is the canonical one: it says a
 * number exists but not what it measures, so its column cannot be checked
 * against anything. The model catches spelling and the endless phrasings of the
 * same mistake; this list catches the plainest case even when the model is
 * unavailable, so the example that prompted the check always works.
 */
const VAGUE_LABELS = new Set([
  'length', 'size', 'width', 'measurement', 'measure', 'number', 'value',
  'circumference', 'fit', 'body', 'garment', 'cm', 'in', 'inch', 'inches',
  'centimetre', 'centimetres', 'centimeter', 'centimeters',
]);

/**
 * One tiny Workers AI call (~50 output tokens) over a chart's column names.
 * `{ ok: true }` means every name is clear and spelt correctly; `{ ok: false,
 * problem }` is the one answer that should stop a save. A checker that cannot
 * run answers `{ ok: true, skipped: true }`: being unable to check is not the
 * same as finding a fault, and must not stand between a store and its chart.
 */
export async function checkChartColumns(labels) {
  const names = (Array.isArray(labels) ? labels : [])
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!names.length) return { ok: true, skipped: true };

  const vague = names.find((name) => VAGUE_LABELS.has(name.toLowerCase()));
  if (vague) {
    return {
      ok: false,
      problem: `"${vague}" does not say what it measures \u2014 try "body length" or "sleeve length".`,
    };
  }

  if (!cloudflareConfigured()) return { ok: true, skipped: true };
  const model = config.cloudflare.textModel || config.cloudflare.visionModel;
  const prompt = `You review the column names of a clothing size chart. Every name must be spelt correctly and say what it measures, such as Chest, Waist, Hips, Shoulder, Sleeve length, Body length or Inseam. A name that is misspelt, or too vague to tell what is being measured, is a problem. Reply with ONLY compact JSON: {"ok":true} when all names are clear, or {"ok":false,"problem":"one short sentence naming the faulty column and a better name"}. Names: ${JSON.stringify(names)}`;
  try {
    const result = await runModel(model, {
      messages: [
        { role: 'system', content: 'You output strict JSON only.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 60,
      temperature: 0,
    }, { timeoutMs: 12_000 });
    const raw = extractJson(result?.response ?? result);
    if (raw.ok === false || raw.ok === 'false') {
      const problem = typeof raw.problem === 'string' && raw.problem.trim()
        ? raw.problem.trim().slice(0, 200)
        : 'One column name is unclear \u2014 say what it measures.';
      return { ok: false, problem };
    }
    if (raw.ok === true || raw.ok === 'true') return { ok: true };
    return { ok: true, skipped: true };
  } catch {
    return { ok: true, skipped: true };
  }
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
