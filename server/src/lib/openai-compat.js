import { config } from '../config.js';
import { HttpError } from './errors.js';
import { aiErrorMessage, classifyAiError, recordVision } from './cloudflare.js';

/**
 * Free, OpenAI-shaped calculators.
 *
 * Z.AI and NVIDIA NIM both speak the same `/chat/completions` dialect the rest of
 * this server already builds messages for, so the prompt, the payload and the JSON
 * parser do not change - only the socket the question goes down. Each reply is
 * wrapped in `{ result }` on the way out, which is the one envelope everything
 * above this line already understands.
 *
 * Both families think before they answer when they are not told not to, and a
 * thinking model spends the whole token budget in `reasoning` and leaves `content`
 * null. Each provider spells the switch differently, so the switch travels with the
 * provider - and if the endpoint rejects it, the request is tried once more without
 * it rather than failing the scan over a field name.
 */
const PROVIDERS = () => ({
  zai: {
    apiBase: config.zai.apiBase,
    apiKey: config.zai.apiKey,
    model: config.zai.model,
    noThink: { thinking: { type: 'disabled' } },
  },
  nvidia: {
    apiBase: config.nvidia.apiBase,
    apiKey: config.nvidia.apiKey,
    model: config.nvidia.model,
    noThink: { chat_template_kwargs: { enable_thinking: false } },
  },
});

export const oaConfigured = (name) => Boolean(PROVIDERS()[name]?.apiKey);
export const oaModel = (name) => PROVIDERS()[name]?.model || '';

export async function oaChat(name, messages, { maxTokens = 260, json = true, temperature = 0, timeoutMs = 20_000, model = '' } = {}) {
  const p = PROVIDERS()[name];
  if (!p) throw new HttpError(400, `Unknown calculator "${name}"`);
  if (!p.apiKey) throw new HttpError(503, `${name} is not configured`);

  const send = async (extras) => {
    const body = {
      model: model || p.model,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...extras,
    };
    const res = await fetch(`${p.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, parsed };
  };

  const extras = { ...(json ? { response_format: { type: 'json_object' } } : {}), ...p.noThink };
  let { res, text, parsed } = await send(extras);

  // A rejected extra field is a naming difference, not an outage. Try the plain
  // request once before giving up, because the prompt already asks for JSON.
  if (!res.ok && res.status === 400 && Object.keys(extras).length) {
    ({ res, text, parsed } = await send({}));
  }

  if (!res.ok) {
    const msg = parsed?.error?.message || parsed?.message || text.slice(0, 300) || res.statusText;
    const kind = classifyAiError(res.status, msg);
    recordVision(false, { status: res.status, kind, message: String(msg).slice(0, 300) });
    const err = new HttpError(502, aiErrorMessage(kind));
    err.upstream = { status: res.status, kind, message: String(msg).slice(0, 500) };
    throw err;
  }

  recordVision(true);
  return { result: parsed };
}

/**
 * One tiny completion, with the rate-limit headers kept.
 *
 * Free tiers publish a number and enforce another. The headers on a real reply are
 * the only description of what this key is actually allowed, so they travel with the
 * probe instead of being discarded.
 */
export async function oaProbe(name, { model = '', timeoutMs = 30_000 } = {}) {
  const p = PROVIDERS()[name];
  if (!p?.apiKey) return { ok: false, error: 'not configured' };
  const t0 = Date.now();
  try {
    const res = await fetch(`${p.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || p.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      model: model || p.model,
      status: res.status,
      ms: Date.now() - t0,
      rate_headers: Object.fromEntries([...res.headers].filter(([k]) => /rate|limit|quota|retry|reset|remaining/i.test(k))),
      body: text.slice(0, 400),
    };
  } catch (e) {
    return { ok: false, model: model || p.model, ms: Date.now() - t0, error: e.message };
  }
}

/** `GET /models` - what this key may call, without spending a completion. */export async function oaModels(name) {
  const p = PROVIDERS()[name];
  if (!p?.apiKey) return { ok: false, error: 'not configured' };
  try {
    const res = await fetch(`${p.apiBase}/models`, {
      headers: { Authorization: `Bearer ${p.apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 200) };
    const json = JSON.parse(text);
    const ids = Array.isArray(json?.data) ? json.data.map((m) => m.id) : [];
    return { ok: true, model: p.model, model_listed: ids.length ? ids.includes(p.model) : null, count: ids.length, models: ids.slice(0, 60) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
