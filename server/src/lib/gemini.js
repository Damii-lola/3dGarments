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

async function post(body, timeoutMs, model = config.gemini.model) {
  const { apiKey, apiBase } = config.gemini;
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
 * Ask several model names the same one-line question and report which ones answer,
 * how fast, and how many tokens it took. Gemini's model list is long and half of it
 * is image or speech models, so the only reliable way to find one that will do the
 * calculation is to ask it something and see. Run by hand, never by a scan.
 */
export async function geminiSweep(models, { prompt = 'Reply with the single word: ready', maxTokens = 32, timeoutMs = 12000 } = {}) {
  if (!geminiConfigured()) return { ok: false, error: 'not configured' };
  const list = (Array.isArray(models) ? models : String(models || '').split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return { ok: false, error: 'no models named' };
  const results = [];
  for (const model of list) {
    const t0 = Date.now();
    try {
      const r = await geminiChat([{ role: 'user', content: prompt }], { model, maxTokens, json: false, temperature: 0, timeoutMs });
      results.push({
        model,
        ok: true,
        ms: Date.now() - t0,
        text: String(r?.result?.choices?.[0]?.message?.content ?? '').slice(0, 200),
        usage: r?.result?.usage || null,
      });
    } catch (e) {
      results.push({ model, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return { ok: true, results };
}

/**
 * One chat turn. `messages` is the same [{role, content}] the Workers AI path
 * builds; only the system message is separate here, which is where Gemini wants it.
 */
export async function geminiChat(messages, { maxTokens = 260, json = true, temperature = 0, timeoutMs = 8000, model = '' } = {}) {
  if (!geminiConfigured()) throw new HttpError(503, 'Gemini is not configured (set GEMINI_API_KEY)');
  const useModel = model || config.gemini.model;

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
    json2 = await post(body, timeoutMs, useModel);
  } catch (e) {
    // A model that insists on thinking rejects the budget instead of ignoring it.
    // The answer is still worth having without the flag; it just costs a little more.
    if (e?.status === 400 && /think/i.test(String(e.message))) {
      delete body.generationConfig.thinkingConfig;
      json2 = await post(body, timeoutMs, useModel);
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
