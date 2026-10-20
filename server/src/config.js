const list = (v, fallback) =>
  (v ?? fallback).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

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
    // How many times each frame is read. Three is the smallest number that can
    // outvote a wrong reading; two would only tie it. VISION_READS=1 returns to
    // one pass per frame.
    reads: Math.max(1, Math.round(Number(process.env.VISION_READS) || 3)),
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
  }),
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
