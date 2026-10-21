/**
 * Gemini, for the calculation step.
 *
 * The calculation is a small, strict question: here are four frames of the same
 * person, give me seven tape measurements in inches. It does not want an essay,
 * and it does not want deliberation - Gemini thinks before it answers by default,
 * and those thoughts are billed as output and can push the reply past the scan's
 * deadline. So the call asks for thinking to be switched OFF, and if the model
 * refuses that flag it is asked again without it rather than failing the scan.
 *
 * The reply is wrapped in the same `{ result: { choices, usage } }` envelope the
 * Workers AI path returns, so the caller never has to know which provider
 * answered - only the diagnostics do.
 */
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { classifyAiError } from './cloudflare.js';

export const geminiConfigured = () => Boolean(config.gemini?.apiKey);

const textOf = (json) => (json?.candidates?.[0]?.content?.parts || [])
  .map((p) => p?.text || '')
  .join('')
  .trim();

async function post(body, timeoutMs) {
  const { apiKey, model, apiBase } = config.gemini;
  const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300) || res.statusText;
    const err = new Error(`Gemini ${res.status}: ${msg}`);
    err.status = res.status;
    err.debug = { kind: classifyAiError(res.status, msg), body: msg.slice(0, 400) };
    throw err;
  }
  return json;
}

/**
 * Send the same one-line question several ways, to separate "the network will not
 * carry a POST" from "this model ignores the thinking switch". Only ever run when
 * asked for by hand: it spends a little quota to answer a question about wiring.
 *
 * The GET that lists models works, and the POST that asks a question does not, so
 * the variants walk across exactly that line: the OpenAI-shaped endpoint, the v1
 * path, the key in a header instead of the query, and a POST to a host that is not
 * Google at all.
 */
export async function geminiDiagnose(timeoutMs = 12000) {
  if (!geminiConfigured()) return { ok: false, error: 'not configured' };
  const { apiKey, model, apiBase } = config.gemini;
  const root = apiBase.replace(/\/v1beta$/, '');
  const ask = { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }] };
  const auth = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  const variants = [
    {
      name: 'get-model',
      method: 'GET',
      url: `${apiBase}/models/${encodeURIComponent(model)}`,
      headers: auth,
    },
    {
      name: 'openai-compat',
      url: `${apiBase}/openai/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 16 },
    },
    {
      name: 'v1-path',
      url: `${root}/v1/models/${encodeURIComponent(model)}:generateContent`,
      headers: auth,
      body: ask,
    },
    {
      name: 'header-key',
      url: `${apiBase}/models/${encodeURIComponent(model)}:generateContent`,
      headers: auth,
      body: ask,
    },
    {
      name: 'other-host',
      url: 'https://httpbin.org/post',
      headers: { 'Content-Type': 'application/json' },
      body: { hello: 'world' },
    },
  ];
  const results = [];
  for (const v of variants) {
    const t0 = Date.now();
    let phase = 'connect';
    try {
      const res = await fetch(v.url, {
        method: v.method || 'POST',
        headers: v.headers,
        ...(v.body ? { body: JSON.stringify(v.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const msHeaders = Date.now() - t0;
      phase = 'body';
      const text = await res.text();
      // Where the time went matters here: a request that never connects is a
      // network refusal, one whose headers arrive and whose body never ends is a
      // different animal entirely.
      results.push({ variant: v.name, status: res.status, msHeaders, ms: Date.now() - t0, bytes: text.length, body: text.slice(0, 300) });
    } catch (e) {
      results.push({ variant: v.name, phase, ms: Date.now() - t0, error: String(e?.message || e) });
    }
  }
  return { ok: true, model, results };
}

/**
 * One chat turn. `messages` is the same [{role, content}] the Workers AI path
 * builds; only the system message is separate here, which is where Gemini wants it.
 */
export async function geminiChat(messages, { maxTokens = 260, json = true, temperature = 0, timeoutMs = 8000 } = {}) {
  if (!geminiConfigured()) throw new HttpError(503, 'Gemini is not configured (set GEMINI_API_KEY)');

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] })),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let json2;
  try {
    json2 = await post(body, timeoutMs);
  } catch (e) {
    // A model that insists on thinking rejects the budget instead of ignoring it.
    // The answer is still worth having without the flag; it just costs a little more.
    if (e?.status === 400 && /think/i.test(String(e.message))) {
      delete body.generationConfig.thinkingConfig;
      json2 = await post(body, timeoutMs);
    } else {
      throw e;
    }
  }

  const usage = json2?.usageMetadata || null;
  const out = (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0);
  return {
    result: {
      choices: [{ message: { content: textOf(json2) }, finish_reason: json2?.candidates?.[0]?.finishReason ?? null }],
      usage: usage
        ? { prompt_tokens: usage.promptTokenCount ?? null, completion_tokens: out, thoughts_tokens: usage.thoughtsTokenCount ?? 0 }
        : null,
    },
  };
}

/** The model names this key may call. Used once, to confirm the configured model exists. */
export async function listGeminiModels() {
  if (!geminiConfigured()) return { ok: false, error: 'not configured' };
  try {
    const res = await fetch(`${config.gemini.apiBase}/models?key=${encodeURIComponent(config.gemini.apiKey)}`, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: json?.error?.message || res.statusText };
    const names = (json?.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
    return { ok: true, configured: config.gemini.model, present: names.includes(config.gemini.model), models: names.slice(0, 60) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
