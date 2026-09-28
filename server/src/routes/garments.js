import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db, bucket, signUrls } from '../lib/supabase.js';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import { processGarment } from '../services/pipeline.js';
import { CATEGORIES } from '../shared/silhouette.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.uploadBytes, files: 1 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.mimetype)
      ? cb(null, true)
      : cb(new HttpError(415, `Unsupported image type: ${file.mimetype}`)),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: config.limits.uploadsPerHour,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Upload limit reached — try again later.' },
});

const COLUMNS = 'id, name, status, error, category, category_locked, fit, width, height, geometry, analysis, texture_path, preview_path, created_at, updated_at';
const UUID = /^[0-9a-f-]{36}$/i;

async function withUrls(rows) {
  const urls = await signUrls(rows.flatMap((r) => [r.texture_path, r.preview_path]));
  return rows.map((r) => ({ ...r, texture_url: urls[r.texture_path] || null, preview_url: urls[r.preview_path] || null }));
}

async function own(req) {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'Invalid garment id');
  const { data, error } = await db().from('garments').select(COLUMNS)
    .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Garment not found');
  return data;
}

export const garments = Router();
garments.use(requireUser);

garments.get('/', ah(async (req, res) => {
  const { data, error } = await db().from('garments').select(COLUMNS)
    .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(200);
  if (error) throw new HttpError(500, error.message);
  res.json({ garments: await withUrls(data) });
}));

garments.post('/', uploadLimiter, upload.single('image'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Attach the photo as multipart field "image"');
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) || null : null;
  const { data, error } = await db().from('garments')
    .insert({ user_id: req.user.id, name, status: 'processing' }).select(COLUMNS).single();
  if (error) throw new HttpError(500, error.message);

  const buffer = req.file.buffer;
  setImmediate(() => processGarment({ garmentId: data.id, userId: req.user.id, buffer }));
  res.status(202).json({ garment: { ...data, texture_url: null, preview_url: null } });
}));

garments.get('/:id', ah(async (req, res) => {
  const [row] = await withUrls([await own(req)]);
  res.json({ garment: row });
}));

garments.patch('/:id', ah(async (req, res) => {
  await own(req);
  const b = req.body || {};
  const patch = {};
  if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 60) || null;
  if (b.category !== undefined) {
    if (!CATEGORIES.includes(b.category)) throw new HttpError(400, `category must be one of ${CATEGORIES.join(', ')}`);
    patch.category = b.category;
    patch.category_locked = true;
  }
  if (b.fit !== undefined) {
    if (typeof b.fit !== 'object' || Array.isArray(b.fit)) throw new HttpError(400, 'fit must be an object');
    const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : undefined);
    patch.fit = JSON.parse(JSON.stringify({ size: num(b.fit.size, 0.7, 1.6), lift: num(b.fit.lift, -0.25, 0.25), sleeveAngle: num(b.fit.sleeveAngle, -30, 30) }));
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
  const { data, error } = await db().from('garments').update(patch)
    .eq('id', req.params.id).eq('user_id', req.user.id).select(COLUMNS).single();
  if (error) throw new HttpError(500, error.message);
  const [row] = await withUrls([data]);
  res.json({ garment: row });
}));

garments.post('/:id/reprocess', ah(async (req, res) => {
  const row = await own(req);
  if (row.status === 'processing') throw new HttpError(409, 'Already processing');
  await db().from('garments').update({ status: 'processing', error: null }).eq('id', row.id).eq('user_id', req.user.id);
  setImmediate(() => processGarment({ garmentId: row.id, userId: req.user.id }));
  res.status(202).json({ garment: { ...row, status: 'processing', error: null } });
}));

garments.delete('/:id', ah(async (req, res) => {
  const row = await own(req);
  const prefix = `${req.user.id}/${row.id}`;
  const { data: files } = await bucket().list(prefix);
  if (files?.length) await bucket().remove(files.map((f) => `${prefix}/${f.name}`));
  const { error } = await db().from('garments').delete().eq('id', row.id).eq('user_id', req.user.id);
  if (error) throw new HttpError(500, error.message);
  res.status(204).end();
}));
