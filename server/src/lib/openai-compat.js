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
    keys: config.zai.apiKeys,
    model: config.zai.model,
    queueWaitMs: config.zai.queueWaitMs,
    maxQueue: config.zai.maxQueue,
    noThink: { thinking: { type: 'disabled' } },
  },
  nvidia: {
    apiBase: config.nvidia.apiBase,
    keys: config.nvidia.apiKey ? [config.nvidia.apiKey] : [],
    model: config.nvidia.model,
    queueWaitMs: config.nvidia.queueWaitMs,
    maxQueue: config.nvidia.maxQueue,
    noThink: { chat_template_kwargs: { enable_thinking: false } },
  },
});

export const oaConfigured = (name) => (PROVIDERS()[name]?.keys?.length || 0) > 0;
export const oaKeyCount = (name) => PROVIDERS()[name]?.keys?.length || 0;
export const oaModel = (name) => PROVIDERS()[name]?.model || '';

/* ------------------------------ the key pool ------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Several keys, one queue per key.
 *
 * A Z.AI free key allows a single in-flight request; a second is refused with 429
 * rather than queued by them. Refusing is the wrong answer for a shopper standing in
 * front of a mirror, so each key gets one slot. A call takes the first key that is
 * free and not cooling down; if every key is busy it waits - for about the length of
 * one calculation - and only then falls through to the next rung.
 *
 * A 429 puts that key away for a while instead of failing the scan: the other keys
 * are tried first, and the cooling key rejoins the pool when its sentence is served.
 * This is why more keys are not "more tokens" but "more shoppers at once" - the limit
 * being worked around is concurrency, which is per key.
 */
const pools = new Map();
const pool = (name) => {
  if (!pools.has(name)) {
    pools.set(name, { busy: new Set(), cooling: new Map(), waiting: 0, lastWaitMs: 0, refused: 0, served: 0 });
  }
  return pools.get(name);
};

const keyReady = (p, key) => !p.busy.has(key) && (p.cooling.get(key) || 0) <= Date.now();

const busyError = (name) => {
  const err = new HttpError(503, 'The measuring service is busy right now. Please try again in a moment.');
  err.upstream = { status: 0, kind: 'capacity', message: `${name} has no free key` };
  return err;
};

async function acquire(name, keys, waitMs, maxQueue) {
  const p = pool(name);
  const at = Date.now();
  const pick = () => keys.find((k) => keyReady(p, k));

  let key = pick();
  if (key) {
    p.busy.add(key);
    p.served += 1;
    return { key, release: () => p.busy.delete(key) };
  }

  // Every key is busy or cooling. If the soonest one is beyond this call's patience,
  // say so now rather than making the shopper wait for an answer that is not coming.
  const soonest = Math.min(...keys.map((k) => (p.busy.has(k) ? at + 1 : (p.cooling.get(k) || 0))));
  if (soonest - at > waitMs || p.waiting >= maxQueue) {
    p.refused += 1;
    throw busyError(name);
  }

  p.waiting += 1;
  try {
    for (;;) {
      key = pick();
      if (key) {
        p.busy.add(key);
        p.served += 1;
        p.lastWaitMs = Date.now() - at;
        return { key, release: () => p.busy.delete(key) };
      }
      if (Date.now() - at >= waitMs) {
        p.refused += 1;
        throw busyError(name);
      }
      await sleep(120);
    }
  } finally {
    p.waiting -= 1;
  }
}

/** What the pool has been doing - shown by /health so a wait is not a mystery. */
export const oaPace = (name) => {
  const p = pool(name);
  const now = Date.now();
  return {
    keys: oaKeyCount(name),
    busy: p.busy.size,
    waiting: p.waiting,
    cooling: [...p.cooling.values()].filter((t) => t > now).length,
    last_wait_ms: p.lastWaitMs,
    refused: p.refused,
    served: p.served,
  };
};

/* ------------------------------- the calls -------------------------------- */

async function send(p, key, { model, maxTokens, json, temperature, timeoutMs, messages }) {
  const extras = { ...(json ? { response_format: { type: 'json_object' } } : {}), ...p.noThink };
  const base = { model: model || p.model, messages, max_tokens: maxTokens, temperature };

  const once = async (body) => {
    const res = await fetch(`${p.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, parsed };
  };

  let out = await once({ ...base, ...extras });
  // A rejected extra field is a naming difference, not an outage. Try the plain
  // request once before giving up, because the prompt already asks for JSON.
  if (!out.res.ok && out.res.status === 400 && Object.keys(extras).length) {
    out = await once(base);
  }

  if (!out.res.ok) {
    const msg = out.parsed?.error?.message || out.parsed?.message || out.text.slice(0, 300) || out.res.statusText;
    const kind = classifyAiError(out.res.status, msg);
    recordVision(false, { status: out.res.status, kind, message: String(msg).slice(0, 300) });
    const err = new HttpError(502, aiErrorMessage(kind));
    err.upstream = {
      status: out.res.status,
      kind,
      message: String(msg).slice(0, 500),
      retryAfter: Number(out.res.headers.get('retry-after')) || 0,
    };
    throw err;
  }

  return out.parsed;
}

export async function oaChat(name, messages, { maxTokens = 260, json = true, temperature = 0, timeoutMs = 20_000, model = '', waitMs = null } = {}) {
  const p = PROVIDERS()[name];
  if (!p) throw new HttpError(400, `Unknown calculator "${name}"`);
  if (!p.keys.length) throw new HttpError(503, `${name} is not configured`);

  const patience = waitMs ?? p.queueWaitMs ?? 0;
  let lastErr = null;

  // One attempt per key: a 429 on one key is a reason to try the next, not to fail.
  for (let attempt = 0; attempt < p.keys.length; attempt += 1) {
    const slot = await acquire(name, p.keys, patience, p.maxQueue ?? 0);
    try {
      const parsed = await send(p, slot.key, { model, maxTokens, json, temperature, timeoutMs, messages });
      recordVision(true);
      return { result: parsed };
    } catch (e) {
      lastErr = e;
      if (e?.upstream?.status === 429) {
        // Put this key away for as long as it asked, or half a minute if it did not
        // say. The next attempt takes another key, or this one when it comes back.
        const wait = Math.min(300_000, (e.upstream.retryAfter || 30) * 1000);
        pool(name).cooling.set(slot.key, Date.now() + wait);
        continue;
      }
      throw e;
    } finally {
      slot.release();
    }
  }

  throw lastErr;
}

/**
 * One tiny completion, with the rate-limit headers kept.
 *
 * Free tiers publish a number and enforce another. The headers on a real reply are
 * the only description of what this key is actually allowed, so they travel with the
 * probe instead of being discarded. `?index=2` probes the second key without ever
 * printing one.
 */
export async function oaProbe(name, { model = '', timeoutMs = 30_000, index = 0 } = {}) {
  const p = PROVIDERS()[name];
  const key = p?.keys?.[index];
  if (!key) return { ok: false, error: index ? `no key #${index + 1}` : 'not configured' };
  const t0 = Date.now();
  try {
    const res = await fetch(`${p.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || p.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 16,
        temperature: 0,
        ...p.noThink,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      key_index: index + 1,
      model: model || p.model,
      status: res.status,
      ms: Date.now() - t0,
      rate_headers: Object.fromEntries([...res.headers].filter(([k]) => /rate|limit|quota|retry|reset|remaining/i.test(k))),
      body: text.slice(0, 400),
    };
  } catch (e) {
    return { ok: false, key_index: index + 1, model: model || p.model, ms: Date.now() - t0, error: e.message };
  }
}

/** `GET /models` - what this key may call, without spending a completion. */
export async function oaModels(name) {
  const p = PROVIDERS()[name];
  const key = p?.keys?.[0];
  if (!key) return { ok: false, error: 'not configured' };
  try {
    const res = await fetch(`${p.apiBase}/models`, {
      headers: { Authorization: `Bearer ${key}` },
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
