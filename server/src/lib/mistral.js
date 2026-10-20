import { config } from '../config.js';
import { HttpError } from './errors.js';
import { aiErrorMessage, classifyAiError, recordVision } from './cloudflare.js';

export const mistralConfigured = () => Boolean(config.vision.mistral.apiKey);

/**
 * Pacing, learned rather than assumed.
 *
 * Every Mistral key has a requests-per-second limit, and it is not the same on a
 * free key as on a paid one — measured on this account: four frames fired at
 * once came back as four `429 Rate limit exceeded`. So the gap between request
 * STARTS begins at zero (a paid key should not be slowed for nothing) and only
 * ever grows when the service says "rate limit". Calls still overlap in flight —
 * the limit is on how often one may start, not on how many may run.
 *
 * One second and a bit, because the limit is one a second and a retry that lands
 * 5 ms early is another 429.
 */
let gapMs = Number(process.env.MISTRAL_MIN_GAP_MS || 0);
let nextStart = 0;
let lastLimitAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pacedStart() {
  // A limit met a minute ago says nothing about now. Without this the very first
  // 429 a process ever sees would slow every scan until the next deploy.
  if (gapMs && Date.now() - lastLimitAt > 60_000) {
    gapMs = 0;
    nextStart = Math.min(nextStart, Date.now());
  }
  const now = Date.now();
  const at = Math.max(now, nextStart);
  nextStart = at + gapMs;
  if (at > now) await sleep(at - now);
}

/** What the pacer has settled on — shown by /health so the pace is not a mystery. */
export const mistralPace = () => ({ gap_ms: gapMs, next_start_in_ms: Math.max(0, nextStart - Date.now()) });

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
      lastLimitAt = Date.now();
      const retryAfter = Number(res.headers.get('retry-after'));
      gapMs = Math.max(gapMs, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1150);
      nextStart = Math.max(nextStart, Date.now() + gapMs);
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
