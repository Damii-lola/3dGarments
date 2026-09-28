const list = (v, fallback) =>
  (v ?? fallback).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 8787,
  corsOrigins: list(process.env.CORS_ORIGINS, 'http://localhost:5173,http://127.0.0.1:5173'),
  supabase: Object.freeze({
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'garments',
  }),
  cloudflare: Object.freeze({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    visionModel: process.env.CF_VISION_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct',
    gatewayId: process.env.CF_AI_GATEWAY_ID || '',
  }),
  limits: Object.freeze({
    uploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
    uploadsPerHour: Number(process.env.UPLOADS_PER_HOUR || 60),
  }),
  processingSize: Number(process.env.PROCESSING_SIZE || 1024),
  signedUrlTtl: 60 * 60 * 6,
});

export function missingConfig() {
  const missing = [];
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.cloudflare.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!config.cloudflare.apiToken) missing.push('CLOUDFLARE_API_TOKEN');
  return missing;
}
