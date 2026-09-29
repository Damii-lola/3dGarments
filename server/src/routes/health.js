import { Router } from 'express';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYDEPS = fileURLToPath(new URL('../../.pydeps', import.meta.url));
import { config, missingConfig } from '../config.js';
import { db, supabaseConfigured } from '../lib/supabase.js';
import { cloudflareConfigured, verifyCloudflare } from '../lib/cloudflare.js';

const started = Date.now();
export const health = Router();

health.get('/', (_req, res) => {
  const missing = missingConfig();
  res.json({
    ok: true,
    service: '3dgarments-api',
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'dev',
    uptime_s: Math.round((Date.now() - started) / 1000),
    integrations: { supabase: supabaseConfigured(), cloudflare_ai: cloudflareConfigured() },
    missing_env: missing,
  });
});

/** Live connectivity check for every integration. */
health.get('/deep', async (_req, res) => {
  const out = { supabase: { ok: false }, storage: { ok: false }, cloudflare_ai: { ok: false } };
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
  out.cloudflare_ai = await verifyCloudflare();
  out.cloudflare_ai.model = config.cloudflare.visionModel;
  // the sewing-pattern builder (GarmentCode) is Python: is it available on this machine?
  out.python = await new Promise((resolve) => {
    execFile('python3', ['-c', 'import sys, importlib.util as u; print(sys.version.split()[0], *[m for m in ("numpy","scipy","yaml","svgpathtools","svgwrite") if u.find_spec(m)])'],
      { timeout: 15_000, env: { ...process.env, PYTHONPATH: PYDEPS } },
      (err, stdout, stderr) => resolve(err ? { ok: false, error: String(stderr || err.message).slice(0, 300) } : { ok: true, version: stdout.trim() }));
  });
  const ok = Object.entries(out).every(([k, v]) => k === 'python' || v.ok);
  res.json({ ok, ...out }); // always 200 so the details are readable; check `ok`
});
