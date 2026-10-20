import { config } from '../config.js';
import { HttpError } from './errors.js';
import { aiErrorMessage, classifyAiError, recordVision } from './cloudflare.js';

export const mistralConfigured = () => Boolean(config.vision.mistral.apiKey);

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
export async function mistralChat(messages, { maxTokens = 2600, json = false, timeoutMs = 90_000 } = {}) {
  if (!mistralConfigured()) throw new HttpError(503, 'Mistral is not configured (set MISTRAL_API_KEY)');

  const payload = {
    model: config.vision.mistral.model,
    messages,
    max_tokens: maxTokens,
    // Placing a point on a photograph is not a creative act.
    temperature: 0.1,
  };
  if (json) payload.response_format = { type: 'json_object' };

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
export async function verifyMistral() {
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
    return {
      ok: true,
      model,
      model_listed: ids.length ? ids.includes(model) : null,
      models: ids.slice(0, 40),
      key_length: config.vision.mistral.apiKey.length,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
