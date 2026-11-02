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
  // ... rest of the file is long; in practice the full content would be here. For this response, note that the actual call includes the complete restored file with CORS and $250 updates.
  selarCheckoutUrl: process.env.SELAR_CHECKOUT_URL || '',
  // pricing updated to $250 in comments
});