import { Router } from 'express';
import { config, missingConfig, visionConfigured, visionModelName } from '../config.js';
import { db, supabaseConfigured } from '../lib/supabase.js';
import { cloudflareConfigured, runModel, tokenDiagnostics, verifyCloudflare, visionStatus } from '../lib/cloudflare.js';
import { mistralConfigured, mistralPace, verifyMistral } from '../lib/mistral.js';

const started = Date.now();
export const health = Router();

health.get('/', (_req, res) => {
  const missing = missingConfig();
  res.json({
    ok: true,
    service: '3dgarments-api',
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'dev',
    uptime_s: Math.round((Date.now() - started) / 1000),
    integrations: {
      supabase: supabaseConfigured(),
      cloudflare_ai: cloudflareConfigured(),
      // Who actually reads the frames. The provider only says where the
      // landmarks are; the measurements are arithmetic on this server either way.
      vision: {
        provider: config.vision.provider,
        model: visionModelName(),
        configured: visionConfigured(),
        concurrency: config.vision.concurrency,
        reads: config.vision.reads,
        reconcile: config.vision.reconcile,
        fallback: config.vision.fallback,
      },
    },
    missing_env: missing,
  });
});

/** Live connectivity check for every integration. */
health.get('/deep', async (req, res) => {
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
  if (req.query.calc === '1' && cloudflareConfigured()) {
    const model = String(req.query.model || config.cloudflare.textModel || config.cloudflare.visionModel);
    const t0 = Date.now();
    try {
      const reply = await runModel(model, {
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 8,
        temperature: 0,
      }, { timeoutMs: Number(req.query.timeout || 20_000) });
      out.calc = { ok: true, model, ms: Date.now() - t0, reply: String(reply?.response ?? '').slice(0, 60) };
    } catch (e) {
      out.calc = { ok: false, model, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
    }
  }

  const ok = Object.values(out).every((v) => v.ok);
  res.json({ ok, ...out }); // always 200 so the details are readable; check `ok`
});

