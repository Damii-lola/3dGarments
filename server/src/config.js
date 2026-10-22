const list = (v, fallback) =>
  (v ?? fallback).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

/**
 * Every free Z.AI key, in the order they were numbered.
 *
 * Z_API_KEY_1, Z_API_KEY_2, Z_API_KEY_3, ... plus the older single Z_API_KEY. The
 * scan is by name, not by a fixed count, so adding Z_API_KEY_4 on Render is the whole
 * change - no deploy, no code. Duplicates are collapsed: pasting the same key twice
 * would buy nothing, because the limit being worked around is per key.
 */
const zaiKeys = (() => {
  const numbered = Object.keys(process.env)
    .filter((k) => /^(?:Z|ZAI)_API_KEY_\d+$/.test(k))
    .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
    .map((k) => (process.env[k] || '').trim())
    .filter(Boolean);
  const legacy = [(process.env.Z_API_KEY || '').trim(), (process.env.ZAI_API_KEY || '').trim()].filter(Boolean);
  return [...new Set([...legacy, ...numbered])];
})();

export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 8787,
  corsOrigins: list(process.env.CORS_ORIGINS, 'https://damii-lola.github.io,http://localhost:5173,http://127.0.0.1:5173'),
  supabase: Object.freeze({
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    // public (browser-safe) key; handed to the web app by GET /api/public-config
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'garments',
  }),
  cloudflare: Object.freeze({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    visionModel: process.env.CF_VISION_MODEL || '@cf/qwen/qwen3.8-27b',
    textModel: process.env.CF_TEXT_MODEL || '', // grouping step; defaults to the vision model
    gatewayId: process.env.CF_AI_GATEWAY_ID || '',
    // Where the REST API lives. Only ever changed for a local stub: the point of
    // a configurable base is that the whole scan can be checked end to end with
    // no quota spent, not that production points somewhere else.
    apiBase: process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4',
  }),
  /**
   * Who does the calculation step - the one that turns four frames of landmarks
   * into seven tape measurements. Cloudflare by default; `CALC_PROVIDER=gemini`
   * makes Gemini the first rung, and `?calcModel=gemini` asks for it on a single
   * scan without changing the deployment the shop is using.
   */
  calc: Object.freeze({
    // A key is the whole switch, the same way VISION_PROVIDER works: paste Z_API_KEY
    // and Z.AI becomes the calculator, delete it and the deployment goes back to
    // Cloudflare. CALC_PROVIDER overrides either.
    provider: (process.env.CALC_PROVIDER || (zaiKeys.length ? 'zai' : '')).toLowerCase(),
  }),
  gemini: Object.freeze({
    apiKey: process.env.GEMINI_API_KEY || '',
    // 3.8 and 3.7 Flash will not answer at all at the time of writing (they hang
    // until the deadline, or 503). 3.5 answers in ~2.5 s and is the one the numbers
    // in MEMORY.md were measured on, so it is the name a deployment gets by default.
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    apiBase: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta',
  }),
  /**
   * Two more free calculators, both OpenAI-shaped.
   *
   * Z.AI's GLM Flash line is $0 per token with no card; NVIDIA's NIM is a free
   * development tier. Neither is wired as the default: a key is the whole switch,
   * and `?calcModel=zai|nvidia` asks for one on a single scan without changing what
   * the shop is using.
   */
  zai: Object.freeze({
    // The pool. `apiKey` stays as the first key so the older single-key paths keep
    // working; the calculator itself reads `apiKeys` and gives each key its own slot.
    apiKeys: zaiKeys,
    apiKey: zaiKeys[0] || '',
    model: process.env.ZAI_MODEL || 'glm-4.5-flash',
    apiBase: (process.env.ZAI_API_BASE || 'https://api.z.ai/api/paas/v4').replace(/\/$/, ''),
    // A key allows one request at a time, so the next shopper waits for a free key
    // instead of collecting a 429. Past this wait the scan is better off taking the
    // next rung than standing in a queue.
    queueWaitMs: Math.max(0, Number(process.env.ZAI_QUEUE_WAIT_MS || 6_000)),
    maxQueue: Math.max(0, Number(process.env.ZAI_MAX_QUEUE || 2)),
  }),
  nvidia: Object.freeze({
    apiKey: process.env.NVIDIA_API_KEY || '',
    model: process.env.NVIDIA_MODEL || 'qwen/qwen3-32b',
    apiBase: (process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    queueWaitMs: Math.max(0, Number(process.env.NVIDIA_QUEUE_WAIT_MS || 6_000)),
    maxQueue: Math.max(0, Number(process.env.NVIDIA_MAX_QUEUE || 2)),
  }),
  /**
   * Who reads the frames. `mistral` when a Mistral key is present (or when
   * VISION_PROVIDER says so), otherwise Cloudflare — so pasting the key into
   * Render is the whole switch, and deleting it is the whole rollback.
   *
   * The provider only ever answers "where are these landmarks". Every
   * centimetre after that is arithmetic in geometry.js on this server.
   */
  vision: Object.freeze({
    provider: (process.env.VISION_PROVIDER
      || (process.env.MISTRAL_API_KEY ? 'mistral' : 'cloudflare')).toLowerCase(),
    concurrency: Number(process.env.VISION_CONCURRENCY || 4),
    // How many times each frame is read. One pass: the calculation step is what
    // reconciles the frames into one body, and a second and third opinion per frame
    // buy precision it never uses while tripling the wall clock and the vision bill.
    // VISION_READS=3 asks for three reads per frame again.
    reads: Math.max(1, Math.round(Number(process.env.VISION_READS) || 1)),
    // After the frames are read, hand the readings to Workers AI to be turned
    // into one consistent body (the calculation step). VISION_RECONCILE=0 keeps
    // the raw points as they came in.
    reconcile: process.env.VISION_RECONCILE !== '0',
    // If the chosen provider refuses, may Workers AI read the frame instead?
    // On by default: a key that cannot answer should not switch the shop off.
    // VISION_FALLBACK=0 makes the choice strict.
    fallback: process.env.VISION_FALLBACK !== '0',
    mistral: Object.freeze({
      apiKey: process.env.MISTRAL_API_KEY || '',
      model: process.env.MISTRAL_MODEL || 'ministral-14b-latest',
      apiBase: (process.env.MISTRAL_API_BASE || 'https://api.mistral.ai/v1').replace(/\/$/, ''),
    }),
  }),
  limits: Object.freeze({
    uploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
    uploadsPerHour: Number(process.env.UPLOADS_PER_HOUR || 60),
    // The body scan is open by design (a shopper never logs in), so these two
    // numbers are what stops one script from spending every vision token and
    // every megabyte of temporary disk. A phone clip of 30 s is 30-40 MB.
    bodyScanBytes: Number(process.env.MAX_BODY_SCAN_MB || 96) * 1024 * 1024,
    bodyScanPerHour: Number(process.env.BODY_SCAN_PER_HOUR || 20),
    bodyScanConcurrent: Number(process.env.BODY_SCAN_CONCURRENT || 3),
    // Ceiling on pixels decoded from any uploaded picture. A small file can
    // claim an enormous canvas; without this a "15 MB photo" can ask sharp for
    // more memory than the instance has.
    maxInputPixels: Number(process.env.MAX_INPUT_PIXELS || 50_000_000),
  }),
  // /health/deep can call paid providers and shows internals. It answers only to
  // this header, and only when the variable is set - empty means it is off.
  healthToken: (process.env.HEALTH_TOKEN || '').trim(),
  // optional shared secret that lets the lab (no login) call /api/scan; empty = off
  scanLabKey: process.env.SCAN_LAB_KEY || '',
  processingSize: Number(process.env.PROCESSING_SIZE || 1024),
  signedUrlTtl: 60 * 60 * 6,
});

export function missingConfig() {
  const missing = [];
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (config.vision.provider === 'mistral') {
    if (!config.vision.mistral.apiKey) missing.push('MISTRAL_API_KEY');
  } else {
    if (!config.cloudflare.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
    if (!config.cloudflare.apiToken) missing.push('CLOUDFLARE_API_TOKEN');
  }
  return missing;
}

/** One name for "the model that reads the frames", whichever provider runs it. */
export function visionModelName() {
  return config.vision.provider === 'mistral'
    ? config.vision.mistral.model
    : config.cloudflare.visionModel;
}

/** True when the chosen provider holds what it needs. */
export function visionConfigured() {
  return config.vision.provider === 'mistral'
    ? Boolean(config.vision.mistral.apiKey)
    : Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);
}
