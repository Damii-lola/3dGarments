import { Router } from 'express';
import { db } from '../lib/supabase.js';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { changePassword, createAttemptLog } from '../services/account-security.js';
import { parseAppearance, shapeSettings } from '../services/user-settings.js';

const RANGES = {
  height_cm: [120, 220],
  chest_cm: [60, 160],
  waist_cm: [50, 160],
  hips_cm: [60, 170],
};
const DEFAULTS = { height_cm: 172, chest_cm: 96, waist_cm: 80, hips_cm: 98 };

/** Service-role Supabase client (bypasses RLS — every query must filter by user_id). */
function admin() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client that is only used to test a password: it keeps no session of its own. */
function probe() {
  return createClient(config.supabase.url, config.supabase.anonKey || config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const passwordAttempts = createAttemptLog();

export const me = Router();
me.use(requireUser);

me.get('/', (req, res) => res.json({ user: { id: req.user.id, email: req.user.email } }));

me.get('/body', ah(async (req, res) => {
  const { data, error } = await db().from('body_profiles').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  res.json({ body: data || { user_id: req.user.id, ...DEFAULTS } });
}));

me.put('/body', ah(async (req, res) => {
  const row = { user_id: req.user.id };
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(req.body?.[k]);
    row[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 10) / 10)) : DEFAULTS[k];
  }
  if (typeof req.body?.skin_tone === 'string' && /^#[0-9a-f]{6}$/i.test(req.body.skin_tone)) row.skin_tone = req.body.skin_tone;
  const { data, error } = await db().from('body_profiles').upsert(row).select('*').single();
  if (error) throw new HttpError(500, error.message);
  res.json({ body: data });
}));

me.get('/outfits', ah(async (req, res) => {
  const { data, error } = await db().from('outfits').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) throw new HttpError(500, error.message);
  res.json({ outfits: data });
}));

me.post('/outfits', ah(async (req, res) => {
  const ids = Array.isArray(req.body?.garment_ids) ? req.body.garment_ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 12) : [];
  if (!ids.length) throw new HttpError(400, 'garment_ids required');
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : 'Outfit';
  const { data, error } = await db().from('outfits').insert({ user_id: req.user.id, name, garment_ids: ids }).select('*').single();
  if (error) throw new HttpError(500, error.message);
  res.status(201).json({ outfit: data });
}));

me.delete('/outfits/:id', ah(async (req, res) => {
  const { error } = await db().from('outfits').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) throw new HttpError(500, error.message);
  res.status(204).end();
}));

/* ---------- account profile ---------- */

me.patch('/profile', ah(async (req, res) => {
  const { username, full_name, brand_name } = req.body || {};
  const updates = {};
  if (typeof username === 'string') updates.user_metadata = { ...(req.body?.user_metadata || {}), username: username.trim().slice(0, 30) };
  if (typeof full_name === 'string') updates.user_metadata = { ...(updates.user_metadata || {}), full_name: full_name.trim().slice(0, 60) };
  if (typeof brand_name === 'string') updates.user_metadata = { ...(updates.user_metadata || {}), brand_name: brand_name.trim().slice(0, 60) };

  const { data, error } = await admin().auth.admin.updateUserById(req.user.id, updates);
  if (error) throw new HttpError(500, error.message);
  res.json({ ok: true, user: data.user });
}));

/* ---------- everything the settings page shows ---------- */

me.get('/settings', ah(async (req, res) => {
  const { data, error } = await db().from('user_settings').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  // Fresh from the auth service: req.user is cached for a minute after each request.
  const { data: auth, error: authErr } = await admin().auth.admin.getUserById(req.user.id);
  if (authErr) throw new HttpError(500, authErr.message);
  const meta = auth?.user?.user_metadata || {};
  res.json({
    settings: shapeSettings(data),
    profile: { username: meta.username || '', full_name: meta.full_name || '', brand_name: meta.brand_name || '' },
  });
}));

/* ---------- password ---------- */

me.patch('/password', ah(async (req, res) => {
  await changePassword({
    user: req.user,
    current: req.body?.current_password,
    next: req.body?.new_password,
    attempts: passwordAttempts,
    // Right or wrong is the only answer wanted; anything else is not "wrong password".
    verify: async (email, password) => {
      const { error } = await probe().auth.signInWithPassword({ email, password });
      if (!error) return true;
      if (error.status === 429) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      if (error.status === 400 || /invalid login credentials/i.test(error.message)) return false;
      throw new HttpError(502, 'Could not check your password just now. Try again.');
    },
    update: async (userId, password) => {
      const { error } = await admin().auth.admin.updateUserById(userId, { password });
      if (!error) return;
      throw new HttpError(error.status === 422 || error.status === 400 ? 400 : 500, error.message);
    },
  });
  res.json({ ok: true });
}));

/* ---------- notifications ---------- */

me.patch('/notifications', ah(async (req, res) => {
  const { results, digest, marketing, security } = req.body || {};
  const { error } = await db().from('user_settings').upsert({
    user_id: req.user.id,
    notify_results: results,
    notify_digest: digest,
    notify_marketing: marketing,
    notify_security: security,
  }, { onConflict: 'user_id' });
  if (error) throw new HttpError(500, error.message);
  res.json({ ok: true });
}));

/* ---------- billing ---------- */

me.patch('/billing', ah(async (req, res) => {
  const { billing_email, tax_id } = req.body || {};
  const { error } = await db().from('user_settings').upsert({
    user_id: req.user.id,
    billing_email: billing_email || null,
    tax_id: tax_id || null,
  }, { onConflict: 'user_id' });
  if (error) throw new HttpError(500, error.message);
  res.json({ ok: true });
}));

/* ---------- appearance ---------- */

me.patch('/appearance', ah(async (req, res) => {
  const row = parseAppearance(req.body);
  const { error } = await db().from('user_settings').upsert({ user_id: req.user.id, ...row }, { onConflict: 'user_id' });
  if (error) throw new HttpError(500, error.message);
  res.json({ ok: true, appearance: row });
}));

/* ---------- delete account ---------- */

me.delete('/account', ah(async (req, res) => {
  const { error } = await db().from('user_settings').delete().eq('user_id', req.user.id);
  if (error) throw new HttpError(500, error.message);
  const { error: authErr } = await admin().auth.admin.deleteUser(req.user.id);
  if (authErr) throw new HttpError(500, authErr.message);
  res.status(204).end();
}));
