import { Router } from 'express';
import { db } from '../lib/supabase.js';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';

const RANGES = {
  height_cm: [120, 220],
  chest_cm: [60, 160],
  waist_cm: [50, 160],
  hips_cm: [60, 170],
};
const DEFAULTS = { height_cm: 172, chest_cm: 96, waist_cm: 80, hips_cm: 98 };

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
