import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_AVAILABLE } from './config.js';

let client = null;
async function sb() {
  if (!CLOUD_AVAILABLE) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return client;
}

/** the supabase-js client (null in local mode) */
export const supabaseClient = sb;

/**
 * A session to write the user's own rows / files with: the current one, else an anonymous one
 * (needs "Allow anonymous sign-ins" in the Supabase project's Auth settings).
 */
export async function ensureSession() {
  const c = await sb();
  if (!c) throw new Error('cloud not configured');
  const { data } = await c.auth.getSession();
  if (data.session) return data.session;
  const { data: anon, error } = await c.auth.signInAnonymously();
  if (error) throw error;
  return anon.session;
}

export async function getSession() {
  const c = await sb();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export async function accessToken() {
  return (await getSession())?.access_token || null;
}

export async function onAuthChange(cb) {
  const c = await sb();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const { data, error } = await (await sb()).auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const { data, error } = await (await sb()).auth.signUp({
    email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const c = await sb();
  if (c) await c.auth.signOut();
}
