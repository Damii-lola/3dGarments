import { config } from '../config.js';
import { HttpError } from './errors.js';
import { aiErrorMessage, classifyAiError, recordVision } from './cloudflare.js';

export const mistralConfigured = () => Boolean(config.vision.mistral.apiKey);

/**
 * Pacing, measured from the key rather than assumed.
 *
 * Every Mistral key has a request limit, and it is not the same on a free key as
 * on a paid one. This one states its own: `x-ratelimit-limit-req-minute: 30`, so a
 * scan's twelve reads fit inside a minute with room for another scan, but not
 * three. The pacer therefore keeps a rolling minute of request starts and lets
 * them go at once while there is budget - bursting is what makes a scan fast -
 * and waits out the oldest start when the budget is gone. A 429 still leaves its
 * mark: the burst is cut for the next minute and one start is held back.
 *
 * MISTRAL_REQ_PER_MINUTE overrides the measured limit (a paid key may state a
 * larger one); leaving 20% unused is what keeps a second scan from colliding with
 * the first.
 */
const WINDOW_MS = 60_000;
const REQ_PER_MINUTE = Number(process.env.MISTRAL_REQ_PER_MINUTE || 30);
const BURST = Math.max(1, Math.ceil(REQ_PER_MINUTE * 0.8));
let burstCap = BURST;
let heldUntil = 0;
let lastLimitAt = 0;
const starts = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pacedStart() {
  // A refusal is a fact about the last minute, not about this one. Give the cap
  // back after a quiet minute instead of carrying a slow key forever.
  if (burstCap < BURST && Date.now() - lastLimitAt > WINDOW_MS) burstCap = BURST;
  for (;;) {
    const now = Date.now();
    while (starts.length && now - starts[0] > WINDOW_MS) starts.shift();
    const waitHeld = heldUntil - now;
    const room = burstCap - starts.length;
    if (room > 0 && waitHeld <= 0) {
      starts.push(now);
      return;
    }
    const waitWindow = room <= 0 ? WINDOW_MS - (now - starts[0]) + 50 : 0;
    await sleep(Math.max(50, waitHeld, waitWindow));
  }
}

/** What the pacer has settled on — shown by /health so the pace is not a mystery. */
export const mistralPace = () => {
  const now = Date.now();
  const used = starts.filter((t) => now - t <= WINDOW_MS).length;
  return { used_last_minute: used, cap: burstCap, limit_per_minute: REQ_PER_MINUTE, held_for_ms: Math.max(0, heldUntil - now) };
};

/** A 429: hold the next start back, and stop bursting into the same wall. */
function noteLimit(retryAfterSec) {
  lastLimitAt = Date.now();
  burstCap = Math.max(2, Math.floor(BURST * 0.6));
  const suggested = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.min(5000, retryAfterSec * 1000) : 1200;
  heldUntil = Math.max(heldUntil, Date.now() + suggested);
}

/**
 * Mistral, spoken to directly.
 *
 * The shape is OpenAI's, which is the same shape `VISION_FORMATS[0]` in the body
 * scan already builds, so the frames, the prompt and the JSON parser do not
 * change — only the socket the message goes down. The reply is wrapped in
 * `{ result }` on the way out so everything above this line keeps reading the
 * one envelope it already understands.
 *
 * No retry loop of its own: the caller retries capacity errors, and a Mistral
 * 400 is a real 400 (bad image, bad model name), not a shape to try again.
 */
export async function mistralChat(messages, { maxTokens = 2600, json = false, timeoutMs = 90_000, temperature = 0.1 } = {}) {
  if (!mistralConfigured()) throw new HttpError(503, 'Mistral is not configured (set MISTRAL_API_KEY)');

  const payload = {
    model: config.vision.mistral.model,
    messages,
    max_tokens: maxTokens,
    // Placing a point on a photograph is not a creative act. The first read of a
    // frame stays cold; the repeat reads are sent warmer on purpose, so they look
    // again instead of returning the same answer three times.
    temperature,
  };
  if (json) payload.response_format = { type: 'json_object' };

  await pacedStart();

  const res = await fetch(`${config.vision.mistral.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.vision.mistral.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let json2 = null;
  try { json2 = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const msg = json2?.message || json2?.error?.message || text.slice(0, 300) || res.statusText;
    const kind = classifyAiError(res.status, msg);
    if (res.status === 429) {
      // The service just told us the pace. Take it, and let the retry wait.
      noteLimit(Number(res.headers.get('retry-after')));
    }
    recordVision(false, { status: res.status, kind, message: String(msg).slice(0, 300) });
    const err = new HttpError(502, aiErrorMessage(kind));
    err.upstream = { status: res.status, kind, message: String(msg).slice(0, 500) };
    throw err;
  }

  recordVision(true);
  return { result: json2 };
}

/**
 * A real round trip to Mistral that spends nothing: `GET /models` lists what the
 * key may call. That answers the only two questions worth asking about a pasted
 * key — is it accepted, and does it carry the model we are configured to use —
 * without sending a shopper's frame anywhere.
 */
export async function verifyMistral({ probe = false, probeModel = '' } = {}) {
  if (!mistralConfigured()) return { ok: false, error: 'not configured' };
  try {
    const res = await fetch(`${config.vision.mistral.apiBase}/models`, {
      headers: { Authorization: `Bearer ${config.vision.mistral.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    const json = await res.json().catch(() => null);
    const ids = Array.isArray(json?.data) ? json.data.map((m) => m.id) : [];
    const model = config.vision.mistral.model;
    const out = {
      ok: true,
      model,
      model_listed: ids.length ? ids.includes(model) : null,
      models: ids.slice(0, 40),
      key_length: config.vision.mistral.apiKey.length,
    };

    // `?probe=1`: one five-token completion, because a key that can list models
    // cannot necessarily answer — and because the rate-limit headers on that
    // reply are the only honest description of how fast this key may go. Ten
    // tokens spent to stop guessing at a pace.
    if (probe) {
      // Which models can this key actually call? One at a time tells you about
      // one model; `model=all` tells you whether the account is the problem.
      const list = probeModel === 'all'
        ? ['mistral-small-latest', 'ministral-3b-latest', 'mistral-small-2506']
        : [probeModel || model];
      out.probes = [];
      for (const m of list) {
        const t0 = Date.now();
        const r2 = await fetch(`${config.vision.mistral.apiBase}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.vision.mistral.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'Reply with one word: ok' }], max_tokens: 5, temperature: 0 }),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await r2.text().catch(() => '');
        out.probes.push({
          model: m,
          status: r2.status,
          ms: Date.now() - t0,
          body: text.slice(0, 300),
          rate_headers: Object.fromEntries([...r2.headers].filter(([k]) => /rate|limit|retry|quota/i.test(k))),
        });
      }
    }
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
