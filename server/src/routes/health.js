import { Router } from 'express';
import crypto from 'node:crypto';
import { config, missingConfig } from '../config.js';
import { db, supabaseConfigured } from '../lib/supabase.js';
import { cloudflareConfigured, runModel, verifyCloudflare, visionStatus } from '../lib/cloudflare.js';
import { mistralConfigured, mistralPace, verifyMistral } from '../lib/mistral.js';
import { geminiChat, geminiConfigured, geminiSweep, listGeminiModels } from '../lib/gemini.js';
import { oaConfigured, oaModels, oaProbe } from '../lib/openai-compat.js';

const started = Date.now();
export const health = Router();

health.get('/', (_req, res) => {
  // Public and deliberately boring: enough for Render and a status page to see
  // that the process is alive, and nothing about keys, models or pace. The
  // details live behind /health/deep and HEALTH_TOKEN.
  res.json({
    ok: true,
    service: '3dgarments-api',
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'dev',
    uptime_s: Math.round((Date.now() - started) / 1000),
    ready: missingConfig().length === 0,
  });
});

/**
 * /health/deep runs real calls against the providers. On an open URL that is a
 * free way to spend someone else's quota, so it is off unless HEALTH_TOKEN is
 * set, and it only accepts the value in `x-health-token` (never a query string,
 * which would end up in access logs and browser history).
 */
function requireHealthToken(req, res, next) {
  const expected = config.healthToken;
  if (!expected) {
    return res.status(503).json({ error: 'Deep health checks are off. Set HEALTH_TOKEN on the server to enable them.' });
  }
  const given = String(req.get('x-health-token') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Missing or wrong x-health-token.' });
  }
  next();
}

/** Live connectivity check for every integration. */
health.get('/deep', requireHealthToken, async (req, res) => {
  const out = { supabase: { ok: false }, storage: { ok: false }, vision: { ok: false } };
  if (supabaseConfigured()) {
    try {
      const { error } = await db().from('garments').select('id', { head: true, count: 'exact' }).limit(1);
      out.supabase = error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) { out.supabase = { ok: false, error: e.message }; }
    try {
      const { data, error } = await db().storage.getBucket(config.supabase.bucket);
      out.storage = error ? { ok: false, error: error.message } : { ok: true, bucket: data.name, public: data.public };
    } catch (e) { out.storage = { ok: false, error: e.message }; }
  } else {
    out.supabase.error = out.storage.error = 'not configured';
  }

  // The provider in use, and only that one, so an unused leftover key cannot
  // make a broken path look healthy.
  out.vision = config.vision.provider === 'mistral'
    ? { provider: 'mistral', ...(await verifyMistral({ probe: req.query.probe === '1', probeModel: String(req.query.model || '') })) }
    : { provider: 'cloudflare', ...(await verifyCloudflare()), model: config.cloudflare.visionModel };
  out.vision.last_calls = visionStatus();
  // What the client learned about the key's rate limit, so a slow scan has a
  // visible reason instead of a mystery.
  if (config.vision.provider === 'mistral') out.vision.pace = mistralPace();
  if (mistralConfigured()) out.vision.mistral_key_present = true;

  // Ask the calculation model a one-line question and time it. The scan's slow
  // tail is that call waiting on a shared queue, so being able to measure the
  // queue from outside the scan is worth more than a log line nobody kept.
  //
  // `?calc=1&model=gemini` probes Gemini instead; `?geminiModels=1` lists the
  // model names the key may call, which is the quickest way to find out that the
  // configured name is not one of them.
  if (req.query.geminiModels === '1') out.gemini_models = await listGeminiModels();
  if (req.query.geminiSweep) {
    out.gemini_sweep = await geminiSweep(String(req.query.geminiSweep), {
      timeoutMs: Number(req.query.timeout || 15_000),
      maxTokens: Number(req.query.maxTokens || 32),
    });
  }

  if (req.query.calc === '1' && (cloudflareConfigured() || geminiConfigured())) {
    const wantsGemini = String(req.query.model || '') === 'gemini' || (req.query.provider === 'gemini');
    const model = wantsGemini ? 'gemini' : String(req.query.model || config.cloudflare.textModel || config.cloudflare.visionModel);
    const t0 = Date.now();
    try {
      const reply = wantsGemini
        ? await geminiChat([{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: 16, json: false, timeoutMs: Number(req.query.timeout || 20_000) })
        : await runModel(model, {
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          max_tokens: 8,
          temperature: 0,
          // Thinking models answer into `reasoning` and leave `content` null. The
          // switch that turns that off is spelled differently by each family, so the
          // probe can try either: `?think=zai` or `?think=template`.
          ...(req.query.think === 'zai' ? { thinking: { type: 'disabled' } } : {}),
          ...(req.query.think === 'template' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }, { timeoutMs: Number(req.query.timeout || 20_000) });
      const text = wantsGemini ? reply?.result?.choices?.[0]?.message?.content : reply?.response;
      out.calc = {
        ok: true,
        model,
        ms: Date.now() - t0,
        reply: String(text ?? '').slice(0, 60),
        tokens: wantsGemini ? reply?.result?.usage : null,
        // `?raw=1` returns the whole envelope: a model that answers somewhere the
        // text extractor does not look is indistinguishable from one that says nothing.
        ...(req.query.raw === '1' ? { raw: reply } : {}),
      };
    } catch (e) {
      out.calc = { ok: false, model, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
    }
  }

  // `?oa=zai|nvidia` asks a free calculator one word and shows the whole envelope.
  // A timeout is not a diagnosis: the status line and the body say whether the key,
  // the model name or the pace is the problem. `&models=a,b,c` sweeps names, because
  // a provider's free line moves and `/models` does not always list it.
  if (req.query.oa) {
    const name = String(req.query.oa);
    const list = String(req.query.models || '').split(',').map((s) => s.trim()).filter(Boolean);
    const models = list.length ? list : [''];
    const probes = [];
    const keyIndex = Math.max(0, Number(req.query.index || 0));
    for (const m of models) {
      probes.push(await oaProbe(name, { model: m, timeoutMs: Number(req.query.timeout || 30_000), index: keyIndex }));
    }
    // `&burst=3` asks for N at the same instant. The free tier's published limit is
    // concurrency, not tokens, so this is the number that decides whether two
    // shoppers can scan together.
    if (Number(req.query.burst) > 0) {
      const n = Math.min(6, Number(req.query.burst));
      const at = Date.now();
      const together = await Promise.all([...Array(n)].map(() => oaProbe(name, { model: models[0], timeoutMs: Number(req.query.timeout || 30_000) })));
      out.burst = {
        n,
        wall_ms: Date.now() - at,
        statuses: together.map((p) => p.status ?? p.error),
        ok: together.filter((p) => p.ok).length,
      };
    }
    out.oa = { ok: probes.every((p) => p.ok), name, probes };
  }

  const ok = Object.values(out).every((v) => v.ok);
  // `?providers=1` lists what the free calculator keys may call. A key that can
  // list models can still fail on a completion, so this is the cheap first
  // question - the scan itself is the verdict.
  if (req.query.providers === '1') {
    out.calc_models = {};
    for (const name of ['zai', 'nvidia']) {
      out.calc_models[name] = oaConfigured(name) ? await oaModels(name) : { ok: false, error: 'not configured' };
    }
  }
  res.json({ ok, ...out }); // always 200 so the details are readable; check `ok`
});

