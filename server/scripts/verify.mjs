#!/usr/bin/env node
/**
 * Connectivity check for every integration. Run from /server:
 *   npm run verify
 * Reads server/.env (SUPABASE_*, CLOUDFLARE_*). Exits non-zero on any failure.
 */
import { createClient } from '@supabase/supabase-js';

const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const bad = (m) => { console.log(`  \x1b[31m✖\x1b[0m ${m}`); failed = true; };
let failed = false;

const env = process.env;
console.log('\n3dGarments — integration check\n');

console.log('Environment');
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
  env[k] ? ok(`${k} set`) : bad(`${k} missing`);
}

console.log('\nSupabase');
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  for (const t of ['garments', 'body_profiles', 'outfits']) {
    const { error } = await sb.from(t).select('*', { head: true, count: 'exact' }).limit(1);
    error ? bad(`table ${t}: ${error.message} (run the migration)`) : ok(`table ${t}`);
  }
  const bucket = env.SUPABASE_BUCKET || 'garments';
  const { data, error } = await sb.storage.getBucket(bucket);
  if (error) bad(`bucket ${bucket}: ${error.message}`);
  else data.public ? bad(`bucket ${bucket} is PUBLIC — it must be private`) : ok(`bucket ${bucket} (private)`);
}

console.log('\nCloudflare Workers AI');
if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
  const H = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
  const run = async (model, body) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.errors?.map((e) => e.message).join('; ') || r.statusText);
    return j.result;
  };
  try {
    const r = await run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: 'Reply with the single word OK' }], max_tokens: 5 });
    ok(`text model responds: "${String(r.response).trim()}"`);
  } catch (e) { bad(`text model: ${e.message}`); }

  const model = env.CF_VISION_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct';
  try {
    // 8×8 red PNG
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
    const r = await run(model, { messages: [{ role: 'user', content: [
      { type: 'text', text: 'What colour is this image? One word.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
    ] }], max_tokens: 10 });
    ok(`vision model ${model}: "${String(r.response ?? JSON.stringify(r)).trim().slice(0, 40)}"`);
  } catch (e) { bad(`vision model ${model}: ${e.message}`); }
}

if (env.API_URL) {
  console.log('\nDeployed API');
  try {
    const r = await fetch(`${env.API_URL.replace(/\/$/, '')}/health/deep`);
    const j = await r.json();
    j.ok ? ok(`${env.API_URL} healthy`) : bad(`${env.API_URL}: ${JSON.stringify(j)}`);
  } catch (e) { bad(`${env.API_URL}: ${e.message}`); }
}

console.log(failed ? '\n\x1b[31mSome checks failed.\x1b[0m\n' : '\n\x1b[32mAll integrations linked.\x1b[0m\n');
process.exit(failed ? 1 : 0);
