import { cloudConfig } from './config.js';

let client = null;
async function sb() {
  const cfg = await cloudConfig();
  if (!cfg) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
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
  const { data } = c.auth.onAuthStateChange((event, session) => cb(session, event));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const { data, error } = await (await sb()).auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

/**
 * Where a confirmation link comes back to: this site's account screen, from
 * which a session is handed straight to the scanner.
 *
 * It is written as an absolute URL because it travels in an email, and it is
 * built from the build's base rather than from the current path, so it is the
 * account page even when the signup happens somewhere else on the site.
 */
export function accountPageUrl() {
  return new URL(`${import.meta.env.BASE_URL}auth/`, window.location.origin).href;
}

/**
 * Sign up with the username the account will be known by. It travels in the
 * signup metadata, where the `handle_new_user` trigger (supabase/migrations/…
 * accounts.sql) picks it up and writes the profile row — so an account cannot
 * come into being without a name.
 *
 * Returns the raw supabase result: `data.session` is set when the project is
 * set to log people straight in, and null when it still wants a click on a
 * confirmation email first.
 */
export async function signUp(email, password, username) {
  const { data, error } = await (await sb()).auth.signUp({
    email,
    password,
    options: {
      data: { username },
      // The link in that email has to land somewhere real. This is the account
      // screen, which picks up the session the link carries and opens the
      // scanner — never a blank page, and never a page about nothing. The
      // project's "Site URL" and redirect allow-list have to include it; see
      // README.md, "The confirmation email".
      emailRedirectTo: accountPageUrl(),
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Is a username free? Answered by a SECURITY DEFINER function rather than by a
 * select: a profile is readable by its owner alone, so a plain select would come
 * back empty for everyone else's names and every one of them would look free.
 */
export async function usernameTaken(username) {
  const c = await sb();
  if (!c) return false;
  const { data, error } = await c.rpc('username_taken', { candidate: username });
  if (error) throw error;
  return Boolean(data);
}

/**
 * A session that is an account, as opposed to the anonymous ones the upload
 * tools sign in as. false = nobody is signed in.
 */
export function isAccount(session) {
  return Boolean(session && !session.user?.is_anonymous);
}

export async function signOut(scope = 'global') {
  const c = await sb();
  if (c) await c.auth.signOut(scope === 'local' ? { scope: 'local' } : undefined);
}

/* ---------------------------- second step: the inbox ---------------------------- */

/**
 * The six-digit code that finishes a login.
 *
 * Supabase calls this the magic link: the same email carries a code and a link,
 * and both prove the same thing — that the person holding the password can also
 * read the address. `shouldCreateUser: false` matters: a code is not a way to
 * conjure an account, so an address with no account gets no email.
 */
export async function sendLoginCode(email) {
  const c = await sb();
  if (!c) throw new Error('cloud not configured');
  const { error } = await c.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: accountPageUrl() },
  });
  if (error) throw error;
}

/** The code, checked. Gives the session the password step deliberately did not keep. */
export async function verifyLoginCode(email, token) {
  const c = await sb();
  const { data, error } = await c.auth.verifyOtp({ email, token: String(token).trim(), type: 'email' });
  if (error) throw error;
  return data.session;
}

/** The signup confirmation, again. Rate-limited by Supabase, so the page counts down. */
export async function resendConfirmation(email) {
  const c = await sb();
  if (!c) throw new Error('cloud not configured');
  const { error } = await c.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: accountPageUrl() },
  });
  if (error) throw error;
}

/** A reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(email) {
  const c = await sb();
  if (!c) throw new Error('cloud not configured');
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: `${accountPageUrl()}?reset=1` });
  if (error) throw error;
}

/** Set the new password on the session the reset link carried. */
export async function updatePassword(password) {
  const c = await sb();
  const { data, error } = await c.auth.updateUser({ password });
  if (error) throw error;
  return data;
}
