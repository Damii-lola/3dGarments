/**
 * Body scan API: video frames -> estimated body measurements -> size recommendation.
 *
 * POST   /api/body-scan   multipart: frames (image files, 1-8), sex
 *                      -> { id, measurements: {chest, waist, hips, height, ...}, size, notes }
 * GET    /api/body-scan/:id -> stored result
 *
 * Uses Cloudflare Workers AI vision to estimate body measurements from each frame,
 * then combines front/side/back views into a single estimate.
 */

import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, ah } from '../lib/errors.js';
import { db } from '../lib/supabase.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp)$/i.test(file.mimetype) ? cb(null, true) : cb(new HttpError(415, 'Unsupported image type'))),
});

export const bodyScan = Router();

/**
 * Ask Cloudflare vision to estimate body measurements from a single frame.
 * Returns { chestIn?, waistIn?, hipsIn?, heightIn?, view?, confidence? } or null.
 */
async function estimateFromFrame(imageBase64, mime, sex) {
  const prompt = `
You are a body measurement estimator. Analyze this photo of a person (${sex}) standing and facing the camera (or side/back as they turn).
Estimate their body measurements in inches:
- chest (for men) / bust (for women): around the fullest part of the chest/bust
- waist: natural waist, narrowest part of the torso
- hips: fullest part of the hips/seat
- height: total height

Also identify the view: front, side, or back.
And rate your confidence 0-1.

Respond ONLY with JSON like:
{"view":"front","chestIn":38,"waistIn":32,"hipsIn":39,"heightIn":70,"confidence":0.7}

If a measurement cannot be seen from this view, omit it. Be conservative - only estimate what is visible.
`.trim();

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: [{ type: 'image', image: { data: imageBase64 } }] },
      ],
    }),
  });

  if (!res.ok) throw new HttpError(502, `Cloudflare AI error: ${res.status}`);
  const data = await res.json();
  const text = data?.result?.response || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // try to extract JSON from the response
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
  }
  return parsed;
}

bodyScan.post('/', upload.array('frames', 8), ah(async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) throw new HttpError(400, 'Upload at least one frame');
  const sex = String(req.body?.sex || 'male');
  if (!['male', 'female'].includes(sex)) throw new HttpError(400, 'sex must be male or female');

  const analyses = [];
  for (const file of files) {
    const base64 = file.buffer.toString('base64');
    const est = await estimateFromFrame(base64, file.mimetype, sex);
    if (est) analyses.push({ ...est, file: file.originalname });
  }

  if (analyses.length === 0) throw new HttpError(422, 'Could not estimate measurements from any frame');

  // Combine estimates across views
  const combined = {};
  const keys = ['chestIn', 'waistIn', 'hipsIn', 'heightIn'];
  for (const k of keys) {
    const vals = analyses.filter((a) => a[k] != null && (a.confidence || 0) > 0.3).map((a) => a[k]);
    if (vals.length) combined[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const measurements = {
    chest: combined.chestIn,
    bust: combined.chestIn, // alias for female
    waist: combined.waistIn,
    hips: combined.hipsIn,
    height: combined.heightIn,
    views: analyses.map((a) => a.view),
    frameCount: analyses.length,
  };

  // Size recommendation
  const chart = {
    male: {
      XS: { chest: 32, waist: 26, hips: 34, height: 66 },
      S: { chest: 36, waist: 30, hips: 38, height: 68 },
      M: { chest: 40, waist: 34, hips: 40, height: 70 },
      L: { chest: 44, waist: 38, hips: 44, height: 71 },
      XL: { chest: 48, waist: 42, hips: 48, height: 72 },
      XXL: { chest: 52, waist: 46, hips: 52, height: 73 },
    },
    female: {
      XS: { bust: 32, waist: 24, hips: 34, height: 62 },
      S: { bust: 34, waist: 26, hips: 36, height: 64 },
      M: { bust: 36, waist: 28, hips: 38, height: 65 },
      L: { bust: 38, waist: 30, hips: 40, height: 66 },
      XL: { bust: 40, waist: 33, hips: 43, height: 67 },
      XXL: { bust: 42, waist: 36, hips: 46, height: 68 },
    },
  }[sex];

  const sizeKey = combined.chestIn ? Object.keys(chart).reduce((best, key) => {
    const diff = Math.abs(combined.chestIn - (chart[key].chest ?? chart[key].bust));
    return diff < (best.diff ?? Infinity) ? { key, diff } : best;
  }, {}).key : null;

  const size = sizeKey ? chart[sizeKey] : null;

  const notes = [];
  if (size && combined.chestIn) {
    const d = combined.chestIn - (size.chest ?? size.bust);
    if (d > 1.5) notes.push(`Chest may be snug in size ${sizeKey}`);
    else if (d < -2) notes.push(`Size ${sizeKey} chest may be loose`);
  }
  if (size && combined.waistIn) {
    const d = combined.waistIn - size.waist;
    if (d > 1.5) notes.push(`Waist may be snug in size ${sizeKey}`);
    else if (d < -2) notes.push(`Size ${sizeKey} waist may be loose`);
  }

  const result = {
    id: crypto.randomUUID(),
    sex,
    measurements,
    size: sizeKey,
    sizeChart: size,
    notes,
    analyses,
    createdAt: new Date().toISOString(),
  };

  // Store in Supabase if configured
  try {
    if (config.supabase.url && config.supabase.serviceRoleKey) {
      const { data, error } = await db().from('body_profiles').insert({
        id: result.id,
        user_id: req.user?.id || 'anonymous',
        settings: result,
      });
      if (error) console.warn('body_scan: supabase insert failed:', error.message);
    }
  } catch (e) { console.warn('body_scan: supabase unavailable:', e.message); }

  res.json(result);
}));

bodyScan.get('/:id', ah(async (req, res) => {
  let result;
  try {
    if (config.supabase.url && config.supabase.serviceRoleKey) {
      const { data } = await db().from('body_profiles').select('settings').eq('id', req.params.id).maybeSingle();
      result = data?.settings;
    }
  } catch (e) { console.warn('body_scan: fetch failed:', e.message); }
  if (!result) throw new HttpError(404, 'Scan not found');
  res.json(result);
}));
