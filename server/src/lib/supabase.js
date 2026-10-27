import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

let client = null;

export const supabaseConfigured = () => Boolean(config.supabase.url && config.supabase.serviceRoleKey);

/** Service-role client. Bypasses RLS — every query MUST filter by user_id. */
export function db() {
  if (!supabaseConfigured()) throw new HttpError(503, 'Supabase is not configured on the server');
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const bucket = () => db().storage.from(config.supabase.bucket);

export async function signUrls(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return {};
  const { data, error } = await bucket().createSignedUrls(list, config.signedUrlTtl);
  if (error) throw new HttpError(502, `Storage signing failed: ${error.message}`);
  const out = {};
  for (const row of data) if (row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}
