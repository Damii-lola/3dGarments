import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { HttpError, ah } from '../lib/errors.js';
import { cloudflareConfigured, describeNGL } from '../lib/cloudflare.js';
import { buildPattern } from '../services/patterns.js';
import { parseNGL } from '../shared/ngl.js';

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

const patternLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 120, keyGenerator: (req) => req.ip, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many patterns — try again later.' } });
const SEXES = ['female', 'male'];
const MEASURES = ['height', 'bust', 'underbust', 'waist', 'hips', 'leg_circ', 'wrist', 'shoulder_w', 'arm_length', 'waist_line'];

/**
 * POST { garment?: NGL garment, design?: GarmentCode design (ChatGarment's), zone?: upper|lower|full, sex,
 *        body: { height, bust, waist, hips … in cm } } → the sewing pattern for that body.
 * With a design, its cut is used and the NGL garment's lengths win (py/combine.py).
 */
ngl.post('/pattern', express.json({ limit: '512kb' }), patternLimiter, ah(async (req, res) => {
  const [garment] = req.body?.garment ? parseNGL({ garments: [req.body.garment] }) : [];
  const design = req.body?.design && typeof req.body.design === 'object' && !Array.isArray(req.body.design) ? req.body.design : undefined;
  const zone = ['upper', 'lower', 'full'].includes(req.body?.zone) ? req.body.zone : undefined;
  // lengths / widths measured on the photo (py/combine.py FIT_KEYS; numbers only)
  const overrides = {};
  for (const [k, v] of Object.entries(req.body?.overrides || {})) if (typeof k === 'string' && k.length < 40 && Number.isFinite(Number(v))) overrides[k] = Number(v);
  if (!garment && !design) throw new HttpError(400, 'garment (an NGL garment) or design (GarmentCode) is required');
  const sex = SEXES.includes(req.body?.sex) ? req.body.sex : 'female';
  const body = {};
  for (const k of MEASURES) { const v = Number(req.body?.body?.[k]); if (Number.isFinite(v) && v > 1 && v < 300) body[k] = v; }
  try {
    res.json(await buildPattern({ garment, design, zone, overrides, sex, body }));
  } catch (e) {
    throw new HttpError(/ENOENT|No module/.test(e.message) ? 503 : 422, e.message);
  }
}));
