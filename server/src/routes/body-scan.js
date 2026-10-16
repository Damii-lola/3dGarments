/**
 * Body scan API: video frames -> body analysis -> size recommendation.
 *
 *   POST /api/body-scan   multipart: frames (image files, 1-8)   <- from the recorded video
 *     -> {
 *          id,
 *          gender:       { guess: 'male'|'female'|'unsure', confidence, scores },
 *          clothing:     { items[], fit, density, thicknessIn, note },
 *          measurements: { chest, bust, waist, hips, height, shoulder, ... },  // as seen, over clothes
 *          adjusted:     { chest, waist, hips, shoulder },                     // clothing width removed
 *          proportions:  { build, shoulderToHip, legToTorso },
 *          size, sizeChart, sizeBasis,
 *          notes[], views[], frameCount, createdAt
 *        }
 *   GET /api/body-scan/:id -> stored result
 *
 * The vision model is instructed to ignore background noise, focus on the single
 * person in frame, identify gender, gauge clothing density, and estimate
 * proportions. The width the clothing adds is subtracted from the girth
 * measurements before a size is chosen.
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

/** US retail size charts (inches). Men size on chest, women on bust. */
const CHARTS = {
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
};

const PROMPT = `You are a body-proportion analyst for a clothing-size app. You get ONE frame from a video of a person slowly turning a full 360.

Do all of the following:
1. NOISE — ignore the background, furniture, other people, text and objects. Analyse ONLY the single person in the foreground. If no person is clearly visible, set "personVisible": false and stop.
2. GENDER — infer whether the person is male or female from their build, silhouette, shoulders/hips and presentation. Give a confidence 0-1.
3. CLOTHING — list the garments worn, how they fit (tight / regular / loose / oversized), the fabric density (light / medium / heavy) and the "density" of the garment (thick knit & fleece = heavy, thin cotton & lycra = light). Estimate "thicknessIn": how much extra width, in inches, the clothing adds on ONE side of the body (thin t-shirt ~0.15, hoodie/sweater ~0.6, puffer coat ~1.2). Note anything the clothing hides.
4. MEASUREMENTS — estimate the person's measurements IN INCHES as they appear over the clothing: chest/bust, waist, hips, total height, shoulder width. Use the subject's proportions and any visible reference (door height, floor-to-head). Omit what cannot be judged from this view. Be conservative.
5. PROPORTIONS — describe the build (slim / average / athletic / heavyset / petite / tall) and rough ratios: shoulder-to-hip, leg-to-torso.

Respond with ONLY this JSON (no prose, no markdown):
{
  "personVisible": true,
  "view": "front" | "side" | "back" | "three-quarter",
  "gender": "male" | "female" | "unsure",
  "genderConfidence": 0.0,
  "clothing": {
    "items": ["t-shirt", "jeans"],
    "fit": "tight|regular|loose|oversized",
    "density": "light|medium|heavy",
    "thicknessIn": 0.3,
    "note": "loose hoodie hides the torso outline"
  },
  "measurements": { "chestIn": 0, "waistIn": 0, "hipsIn": 0, "heightIn": 0, "shoulderIn": 0 },
  "proportions": { "build": "average", "shoulderToHip": 1.0, "legToTorso": 0.95 },
  "confidence": 0.0
}`;

/** Ask Cloudflare vision to analyse a single frame. Returns the parsed JSON or null. */
async function analyseFrame(imageBase64) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/${config.cloudflare.visionModel}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: [{ type: 'image', image: { data: imageBase64 } }] },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(502, `Cloudflare AI error: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.result?.response || '';
  return parseJson(text);
}

function parseJson(text) {
  if (!text) return null;
  const candidates = [text];
  const m = text.match(/\{[\s\S]*\}/);
  if (m) candidates.push(m[0]);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* next */ }
  }
  return null;
}

/** Confidence-weighted average, pulling a value out of each frame analysis. */
function avg(analyses, get) {
  const pts = analyses
    .map((a) => ({ v: get(a), c: a.confidence ?? 0.5 }))
    .filter((p) => p.v != null && Number.isFinite(p.v) && p.c > 0.2);
  if (!pts.length) return null;
  const wsum = pts.reduce((s, p) => s + p.c, 0);
  return pts.reduce((s, p) => s + p.v * p.c, 0) / wsum;
}

function modal(counts) {
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

function pickGender(analyses) {
  const score = { male: 0, female: 0 };
  for (const a of analyses) {
    if (a.gender === 'male' || a.gender === 'female') {
      score[a.gender] += a.genderConfidence ?? a.confidence ?? 0.5;
    }
  }
  const total = score.male + score.female;
  if (!total) return { guess: 'unsure', confidence: 0, scores: score };
  const best = score.male >= score.female ? 'male' : 'female';
  const confidence = score[best] / total;
  return {
    guess: confidence >= 0.6 ? best : 'unsure',
    confidence: Number(confidence.toFixed(2)),
    scores: { male: Number(score.male.toFixed(2)), female: Number(score.female.toFixed(2)) },
  };
}

function combineClothing(analyses) {
  const items = [...new Set(analyses.flatMap((a) => a.clothing?.items || []))].slice(0, 8);
  const fitCount = {};
  const densityCount = {};
  let thickSum = 0;
  let thickN = 0;
  for (const a of analyses) {
    const c = a.clothing || {};
    if (c.fit) fitCount[c.fit] = (fitCount[c.fit] || 0) + 1;
    if (c.density) densityCount[c.density] = (densityCount[c.density] || 0) + 1;
    if (typeof c.thicknessIn === 'number' && c.thicknessIn >= 0) { thickSum += c.thicknessIn; thickN += 1; }
  }
  return {
    items,
    fit: modal(fitCount),
    density: modal(densityCount),
    thicknessIn: thickN ? Number((thickSum / thickN).toFixed(2)) : null,
    note: analyses.map((a) => a.clothing?.note).find(Boolean) || null,
  };
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const minus = (v, d) => (v == null ? null : round1(v - d));

/** Best size for a chart given a girth value, or null. */
function bestSize(sex, girth) {
  if (girth == null) return null;
  const chart = CHARTS[sex];
  const key = sex === 'female' ? 'bust' : 'chest';
  let best = null;
  for (const [sizeKey, row] of Object.entries(chart)) {
    const diff = Math.abs(girth - row[key]);
    if (!best || diff < best.diff) best = { sizeKey, diff, row, key };
  }
  return best;
}

bodyScan.post('/', upload.array('frames', 8), ah(async (req, res) => {
  if (!config.cloudflare.accountId || !config.cloudflare.apiToken) {
    throw new HttpError(503, 'Body scan is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)');
  }

  const files = req.files;
  if (!files || files.length === 0) throw new HttpError(400, 'Upload at least one frame');

  // --- 1. Analyse every frame (skip the ones that fail, keep the rest) ---
  const analyses = [];
  const failures = [];
  for (const file of files) {
    try {
      const parsed = await analyseFrame(file.buffer.toString('base64'));
      if (parsed && parsed.personVisible !== false) {
        analyses.push({
          view: parsed.view || null,
          gender: parsed.gender || 'unsure',
          genderConfidence: Number(parsed.genderConfidence) || 0,
          clothing: parsed.clothing || {},
          measurements: parsed.measurements || {},
          proportions: parsed.proportions || {},
          confidence: Number(parsed.confidence) || 0.5,
          file: file.originalname,
        });
      }
    } catch (e) {
      failures.push({ file: file.originalname, error: e.message });
    }
  }

  if (analyses.length === 0) {
    throw new HttpError(422, 'Could not find a person to measure. Make sure the person fills the frame and the lighting is decent.');
  }

  // --- 2. Identify gender ---
  const gender = pickGender(analyses);

  // --- 3. Clothing density + how much width it adds ---
  const clothing = combineClothing(analyses);

  // --- 4. Measurements as seen, over the clothing ---
  const seen = {
    chest: avg(analyses, (a) => a.measurements.chestIn),
    bust: avg(analyses, (a) => a.measurements.chestIn),
    waist: avg(analyses, (a) => a.measurements.waistIn),
    hips: avg(analyses, (a) => a.measurements.hipsIn),
    height: avg(analyses, (a) => a.measurements.heightIn),
    shoulder: avg(analyses, (a) => a.measurements.shoulderIn),
  };
  Object.keys(seen).forEach((k) => { seen[k] = round1(seen[k]); });

  // --- 5. Remove the clothing's extra width (2 sides -> 2 x thicknessIn) ---
  const removed = (clothing.thicknessIn || 0) * 2;
  const adjusted = {
    chest: minus(seen.chest, removed),
    waist: minus(seen.waist, removed),
    hips: minus(seen.hips, removed),
    shoulder: minus(seen.shoulder, removed),
    height: seen.height, // height is not affected by clothing thickness
    bodyWidthRemovedIn: round1(removed),
  };

  // --- 6. Size ---
  const girth = adjusted.chest ?? adjusted.waist;
  let sizeBasis = null;
  let size = null;
  if (gender.guess === 'male' || gender.guess === 'female') {
    sizeBasis = gender.guess;
    size = bestSize(gender.guess, adjusted.chest);
  } else {
    // gender unclear -> choose whichever chart fits the measurements best
    const m = bestSize('male', girth);
    const f = bestSize('female', girth);
    if (m && f) {
      size = m.diff <= f.diff ? m : f;
      sizeBasis = m.diff <= f.diff ? 'male' : 'female';
    } else {
      size = m || f;
      sizeBasis = m ? 'male' : 'female';
    }
  }

  // --- 7. Proportions ---
  const build = modal(analyses.map((a) => a.proportions.build).filter(Boolean).reduce((acc, b) => ({ ...acc, [b]: (acc[b] || 0) + 1 }), {}));
  const proportions = {
    build,
    shoulderToHip: round1(avg(analyses, (a) => a.proportions.shoulderToHip)),
    legToTorso: round1(avg(analyses, (a) => a.proportions.legToTorso)),
  };

  // --- 8. Notes ---
  const notes = [];
  if (clothing.items.length || clothing.fit) {
    notes.push(
      `Clothing${clothing.items.length ? ` (${clothing.items.join(', ')})` : ''}` +
      `${clothing.density ? ` reads as ${clothing.density} density` : ''}` +
      `${clothing.fit ? `, ${clothing.fit} fit` : ''}` +
      `${removed > 0.05 ? ` — about ${round1(removed)} in of width removed from the body estimate` : ''}.`
    );
  }
  if (clothing.note) notes.push(clothing.note);
  if (gender.guess === 'unsure') {
    notes.push('Gender was ambiguous in the video, so the size was picked from the body proportions alone.');
  }
  if (size && adjusted.chest != null) {
    const chart = CHARTS[sizeBasis];
    const key = sizeBasis === 'female' ? 'bust' : 'chest';
    const d = adjusted.chest - chart[size.sizeKey][key];
    if (d > 1.5) notes.push(`Size ${size.sizeKey} breast/chest may be snug.`);
    else if (d < -2) notes.push(`Size ${size.sizeKey} chest may be loose.`);
  }
  if (analyses.length < 3) {
    notes.push(`Only ${analyses.length} usable frame${analyses.length === 1 ? '' : 's'} — a slower turn gives a steadier estimate.`);
  }

  const result = {
    id: crypto.randomUUID(),
    gender,
    clothing,
    measurements: seen,
    adjusted,
    proportions,
    size: size?.sizeKey || null,
    sizeChart: size?.row || null,
    sizeBasis: size ? sizeBasis : null,
    notes,
    views: analyses.map((a) => a.view).filter(Boolean),
    frameCount: analyses.length,
    createdAt: new Date().toISOString(),
  };

  // Store in Supabase if configured
  try {
    if (config.supabase.url && config.supabase.serviceRoleKey) {
      const { error } = await db().from('body_profiles').insert({
        id: result.id,
        user_id: req.user?.id || 'anonymous',
        settings: result,
      });
      if (error) console.warn('body_scan: supabase insert failed:', error.message);
    }
  } catch (e) { console.warn('body_scan: supabase unavailable:', e.message); }

  if (failures.length) result.frameFailures = failures;
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
