/**
 * Runtime configuration. The web app is static (GitHub Pages), so its Supabase settings come from
 * the API on Render (GET /api/public-config: the project URL + the public anon key, both from
 * Render's env). They are cached in localStorage so later visits don't wait for a cold Render
 * start. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY still override for local development.
 */
const env = import.meta.env;
export const API_URL = (env.VITE_API_URL || 'https://threedgarments.onrender.com').replace(/\/$/, '');

const CACHE = '3dg.cloud.v1';
let cloudP = null;

/** @returns Promise<{ supabaseUrl, supabaseAnonKey } | null> — null = no cloud (local mode) */
export function cloudConfig() {
  if (cloudP) return cloudP;
  cloudP = (async () => {
    if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return { supabaseUrl: env.VITE_SUPABASE_URL, supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY };
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { /* private mode */ }
    const fresh = fetchConfig().then((c) => {
      try { if (c) localStorage.setItem(CACHE, JSON.stringify(c)); else localStorage.removeItem(CACHE); } catch { /* ignore */ }
      return c;
    });
    if (cached?.supabaseUrl) { fresh.catch(() => {}); return cached; } // refresh in the background
    return fresh.catch(() => null);
  })();
  return cloudP;
}

/** a free Render instance can take ~50 s to wake: allow it once, then give up (local mode) */
async function fetchConfig() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 75000);
  try {
    const r = await fetch(`${API_URL}/api/public-config`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`public-config ${r.status}`);
    const c = await r.json();
    return c.supabaseUrl && c.supabaseAnonKey ? c : null;
  } finally { clearTimeout(t); }
}
