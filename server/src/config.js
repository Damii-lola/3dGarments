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
  corsOrigins: list(process.env.CORS_ORIGINS, 'https://findmysize.org,https://damii-lola.github.io,http://localhost:5173,http://127.0.0.1:5173'),
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
    textModel: process.env.CF_TEXT_MODEL || '',
    gatewayId: process.env.CF_AI_GATEWAY_ID || '',
    apiBase: process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4',
  }),
  calc: Object.freeze({
    provider: (process.env.CALC_PROVIDER || (zaiKeys.length ? 'zai' : '')).toLowerCase(),
  }),
  gemini: Object.freeze({
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    apiBase: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta',
  }),
  zai: Object.freeze({
    apiKeys: zaiKeys,
    apiKey: zaiKeys[0] || '',
    model: process.env.ZAI_MODEL || 'glm-4.5-flash',
    apiBase: (process.env.ZAI_API_BASE || 'https://api.z.ai/api/paas/v4').replace(/\/$/, ''),
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
  vision: Object.freeze({
    provider: (process.env.VISION_PROVIDER || (process.env.MISTRAL_API_KEY ? 'mistral' : 'cloudflare')).toLowerCase(),
    concurrency: Number(process.env.VISION_CONCURRENCY || 4),
    reads: Math.max(1, Math.round(Number(process.env.VISION_READS) || 1)),
    reconcile: process.env.VISION_RECONCILE !== '0',
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
    bodyScanBytes: Number(process.env.MAX_BODY_SCAN_MB || 96) * 1024 * 1024,
    bodyScanPerHour: Number(process.env.BODY_SCAN_PER_HOUR || 20),
    bodyScanConcurrent: Number(process.env.BODY_SCAN_CONCURRENT || 3),
    maxInputPixels: Number(process.env.MAX_INPUT_PIXELS || 50_000_000),
  }),
  healthToken: (process.env.HEALTH_TOKEN || '').trim(),
  scanLabKey: process.env.SCAN_LAB_KEY || '',
  selarWebhookSecret: process.env.SELAR_WEBHOOK_SECRET || '',
  selarCheckoutUrl: process.env.SELAR_CHECKOUT_URL || '',
  adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase().trim(),
  gmail: Object.freeze({
    user: process.env.GMAIL_USER || '',
    pass: process.env.GmailAPI || process.env.GMAIL_API || '',
    imapHost: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    imapPort: Number(process.env.GMAIL_IMAP_PORT || 993),
  }),
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

export function visionModelName() {
  return config.vision.provider === 'mistral'
    ? config.vision.mistral.model
    : config.cloudflare.visionModel;
}

export function visionConfigured() {
  return config.vision.provider === 'mistral'
    ? Boolean(config.vision.mistral.apiKey)
    : Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);
}