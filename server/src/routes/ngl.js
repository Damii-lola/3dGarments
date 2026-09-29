import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { HttpError, ah } from '../lib/errors.js';
import { cloudflareConfigured, describeNGL } from '../lib/cloudflare.js';

// no sign-in needed: strict limits per address and in total keep the vision model's cost bounded
const perDay = rateLimit({ windowMs: 24 * 60 * 60_000, limit: 200, keyGenerator: () => 'all', standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'The garment describer is busy today — try again tomorrow.' } });
const limiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many garment descriptions — try again later.' },
});

export const ngl = Router();

/** POST { image: base64 (jpeg/png/webp) } → the garment's cut in Natural Garment Language */
ngl.post('/describe', express.json({ limit: '8mb' }), limiter, perDay, ah(async (req, res) => {
  if (!cloudflareConfigured()) throw new HttpError(503, 'The vision model is not configured');
  const b64 = String(req.body?.image || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw new HttpError(400, 'image (base64) is required');
  const jpeg = await sharp(Buffer.from(b64, 'base64'), { failOn: 'none' }).rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer()
    .catch(() => { throw new HttpError(400, 'Unreadable image'); });
  res.json(await describeNGL(jpeg));
}));
