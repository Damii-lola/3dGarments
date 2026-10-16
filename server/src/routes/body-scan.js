/**
 * Body scan API: video frames -> body analysis -> size recommendation.
 *
 *   POST /api/body-scan   multipart: frames (image files, 1-8)   <- key frames from the video
 *     -> {
 *          id,
 *          gender:       { guess, confidence, scores },
 *          clothing:     { items[], fit, density, thicknessIn, note },
 *          measurements: { chest, bust, waist, hips, height, shoulder },   // as seen, over clothes
 *          adjusted:     { chest, waist, hips, shoulder, height, bodyWidthRemovedIn },
 *          proportions:  { build, shoulderToHip, legToTorso },
 *          size, sizeChart, sizeBasis,
 *          notes[], views[], frameCount, reconciled, createdAt
 *        }
 *   GET /api/body-scan/:id -> stored result
 *
 * Accuracy strategy:
 *   1. Each frame is analysed by vision with explicit anthropometric reasoning
 *      (head-lengths, shoulder/waist/hip relationships) and per-measurement
 *      confidence, and told to ignore background noise and focus on the person.
 *   2. Frames are combined with a robust, view-weighted average (outliers and
 *      side-on views count for less).
 *   3. Clothing thickness is removed (2 x thicknessIn) before sizing.
 *   4. A short reconciliation pass reviews all frames together and returns a
 *      final, self-consistent set of numbers (falls back to the maths if it fails).
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

const log = (...args) => console.log('[body-scan]', ...args);

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

/** Plausible adult ranges in inches — used to reject/repair absurd values. */
const RANGES = {
  chestIn: [26, 64],
  waistIn: [20, 60],
  hipsIn: [28, 66],
  heightIn: [54, 86],
  shoulderIn: [12, 26],
};

const FRAME_PROMPT = `You are an expert anthropometrist estimating body measurements from ONE frame of a person slowly turning 360°. Work with the care of a tailor taking measurements.

STEP 1 — ISOLATE THE SUBJECT. Ignore the background, furniture, other people, pets, text and objects completely. Analyse ONLY the single person in the foreground. If there is no clearly visible person, return {"personVisible": false} and nothing else.

STEP 2 — READ THE PERSON, NOT THE CLOTHES. Look at where the body actually is: shoulder line, armpits, natural waist crease, widest hip/seat point, the floor. Clothing hangs away from the body, so estimate the BODY underneath.

STEP 3 — REASON WITH HUMAN PROPORTIONS before you answer:
 - An adult is about 7.2–7.8 head-lengths tall. Use the subject's own head as a ruler to sanity-check their height and limb lengths (headUnitsToHeight).
 - Shoulder width is roughly two head-widths (about 17–20 in for men, 15–17 in for women).
 - Chest/bust is typically 3–6 in larger than the natural waist; hips usually sit within ~2 in of the chest/bust.
 - Legs (floor to crotch) are usually 45–48% of total height.
State your reasoning briefly inside the "reasoning" field, then give the numbers.

STEP 4 — CLOTHING. List the garments, how they fit (tight / regular / loose / oversized), the fabric density (light / medium / heavy), and "thicknessIn": the extra width the clothing adds on ONE side of the body (thin tee ~0.15, hoodie ~0.6, puffer ~1.2).

STEP 5 — MEASUREMENTS. Give inches as seen over the clothing, each with a 0-1 confidence:
 chest/bust, waist (natural, narrowest), hips (fullest), height, shoulder width.

STEP 6 — VIEW. Which way is the person facing: front, side, back or three-quarter.

Respond with ONLY this JSON (no markdown, no prose outside it):
{
  "personVisible": true,
  "view": "front" | "side" | "back" | "three-quarter",
  "bbox": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 },
  "gender": "male" | "female" | "unsure",
  "genderConfidence": 0.0,
  "headUnitsToHeight": 7.5,
  "clothing": {
    "items": ["t-shirt", "jeans"],
    "fit": "tight|regular|loose|oversized",
    "density": "light|medium|heavy",
    "thicknessIn": 0.3,
    "note": "loose hoodie hides the torso outline"
  },
  "measurements": {
    "chestIn":    { "value": 0, "confidence": 0.0 },
    "waistIn":    { "value": 0, "confidence": 0.0 },
    "hipsIn":     { "value": 0, "confidence": 0.0 },
    "heightIn":   { "value": 0, "confidence": 0.0 },
    "shoulderIn": { "value": 0, "confidence": 0.0 }
  },
  "proportions": { "build": "slim|average|athletic|heavyset|petite|tall", "shoulderToHip": 1.0, "legToTorso": 0.95 },
  "reasoning": "one or two short sentences",
  "confidence": 0.0
}`;

const RECONCILE_PROMPT = `You are a master tailor reconciling several estimates of the SAME person, each taken from a different angle of one 360° video. The numbers below are already adjusted for clothing. Your job is to produce the single most accurate, self-consistent set of body measurements in inches.

Rules:
- Weight front and back views most for chest/bust, waist and hips; treat side views mainly as a check on posture and depth.
- Reject outliers; if one view disagrees with the rest, side with the majority.
- Enforce human consistency: an adult is 7.2–7.8 head-lengths tall, hips sit near the chest/bust, and the waist is smaller than both.
- Keep every value within realistic adult ranges.
- Return ONLY JSON: {"chestIn":0,"waistIn":0,"hipsIn":0,"heightIn":0,"shoulderIn":0,"note":"one short sentence"}`;

const VIEW_WEIGHT = { front: 1.0, back: 0.95, 'three-quarter': 0.85, side: 0.5 };

/* ---------------- Cloudflare helpers ---------------- */

async function callModelRaw(model, messages) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(502, `Cloudflare AI error: ${res.status} ${body.slice(0, 400)}`);
  }
  return res.json();
}

/** Pull the assistant text out of Cloudflare's envelope, whatever shape it takes. */
function extractText(data) {
  const r = data?.result;
  if (r == null) return '';
  if (typeof r === 'string') return r;
  // Preferred: the raw assistant message string.
  const choice = Array.isArray(r.choices) ? r.choices[0]?.message?.content : null;
  if (typeof choice === 'string' && choice.trim()) return choice;
  // Legacy: result.response (Cloudflare pre-parses it into an object when the
  // model replies with JSON, so it is not always a string).
  if (typeof r.response === 'string' && r.response.trim()) return r.response;
  if (r.response != null) return JSON.stringify(r.response);
  return '';
}

async function callModel(model, messages) {
  return extractText(await callModelRaw(model, messages));
}

/**
 * Cloudflare keeps changing the shape of the image message it accepts, and a
 * wrong shape is rejected with a 400 before the model ever runs. Rather than
 * guess, we try the known shapes in order and remember the one that works.
 */
const VISION_FORMATS = [
  {
    // Verified against the live API.
    name: 'openai-sys-string-data-url',
    messages: (b64, prompt) => [
      { role: 'system', content: prompt },
      { role: 'user', content: [
        { type: 'text', text: 'Analyse this frame and reply with the JSON.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ] },
    ],
  },
  {
    name: 'openai-sys-array-data-url',
    messages: (b64, prompt) => [
      { role: 'system', content: [{ type: 'text', text: prompt }] },
      { role: 'user', content: [
        { type: 'text', text: 'Analyse this frame and reply with the JSON.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ] },
    ],
  },
  {
    name: 'cf-message-image',
    messages: (b64, prompt) => [
      { role: 'system', content: prompt },
      { role: 'user', content: 'Analyse this frame and reply with the JSON.', image: b64 },
    ],
  },
];

/** The index of the vision format that last worked (null = not yet known). */
let visionFormat = null;

function isFormatError(e) {
  // Cloudflare returns 400 for a malformed message body; anything else (429, 500)
  // is worth surfacing rather than silently retrying every shape.
  return /Cloudflare AI error: 400/.test(e?.message || '');
}

async function callVision(b64, prompt) {
  const order = visionFormat == null
    ? VISION_FORMATS.map((_, i) => i)
    : [visionFormat, ...VISION_FORMATS.map((_, i) => i).filter((i) => i !== visionFormat)];

  let lastErr = null;
  for (const i of order) {
    const fmt = VISION_FORMATS[i];
    try {
      const text = await callModel(config.cloudflare.visionModel, fmt.messages(b64, prompt));
      if (visionFormat !== i) {
        visionFormat = i;
        log(`  vision message format locked → "${fmt.name}"`);
      }
      return text;
    } catch (e) {
      lastErr = e;
      log(`  vision format "${fmt.name}" rejected: ${(e?.message || e).slice(0, 200)}`);
      if (!isFormatError(e)) break; // a real outage; don't hammer every shape
    }
  }
  if (visionFormat != null) visionFormat = null; // rediscover on the next request
  throw lastErr;
}

/* TEMPORARY diagnostic: GET /api/body-scan/_probe-frame?key=probe-3dg
   Runs the real per-frame path end to end (message format + response
   extraction + JSON parsing) against a 1x1 pixel image. Remove once verified. */
const PROBE_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

bodyScan.get('/_probe-frame', ah(async (req, res) => {
  if (req.query.key !== 'probe-3dg') throw new HttpError(404, 'Not found');
  const t = Date.now();
  const raw = await callVision(PROBE_JPEG, FRAME_PROMPT);
  const parsed = parseJson(raw);
  res.json({
    ms: Date.now() - t,
    format: visionFormat,
    rawType: typeof raw,
    raw: String(raw).slice(0, 400),
    parsedOk: !!parsed,
    parsed,
  });
}));

function parseJson(text) {
  if (!text) return null;
  if (typeof text === 'object') return text; // Cloudflare sometimes pre-parses
  const str = String(text);
  const candidates = [str];
  const m = str.match(/\{[\s\S]*\}/);
  if (m) candidates.push(m[0]);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  return null;
}

/* ---------------- maths ---------------- */

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** Pull {value, confidence} out of the model's measurement, tolerating a plain number. */
function readMeasure(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { value: raw, confidence: 0.5 };
  if (typeof raw === 'object' && typeof raw.value === 'number') {
    return { value: raw.value, confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0.5 };
  }
  return null;
}

/** Robust, view- and confidence-weighted average that drops outliers. */
function robustCombine(samples) {
  const usable = samples.filter((s) => s && Number.isFinite(s.value) && s.weight > 0);
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const median = sorted[Math.floor(sorted.length / 2)].value;
  const tol = Math.max(2, Math.abs(median) * 0.12);
  const kept = usable.filter((s) => Math.abs(s.value - median) <= tol);
  const use = kept.length ? kept : usable;
  const wsum = use.reduce((s, x) => s + x.weight, 0);
  return use.reduce((s, x) => s + x.value * x.weight, 0) / wsum;
}

function modal(counts) {
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

function pickGender(analyses) {
  const score = { male: 0, female: 0 };
  for (const a of analyses) {
    if (a.gender === 'male' || a.gender === 'female') {
      score[a.gender] += a.genderConfidence ?? 0.5;
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
    if (typeof c.thicknessIn === 'number' && c.thicknessIn >= 0 && c.thicknessIn < 3) {
      thickSum += c.thicknessIn;
      thickN += 1;
    }
  }
  return {
    items,
    fit: modal(fitCount),
    density: modal(densityCount),
    thicknessIn: thickN ? Number((thickSum / thickN).toFixed(2)) : null,
    note: analyses.map((a) => a.clothing?.note).find(Boolean) || null,
  };
}

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

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/* ---------------- route ---------------- */

bodyScan.post('/', upload.array('frames', 8), ah(async (req, res) => {
  if (!config.cloudflare.accountId || !config.cloudflare.apiToken) {
    throw new HttpError(503, 'Body scan is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)');
  }

  const files = req.files;
  if (!files || files.length === 0) throw new HttpError(400, 'Upload at least one frame');

  const startedAt = Date.now();
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  log(`▶ POST received — ${files.length} frame(s), ${(totalBytes / 1024).toFixed(0)} KB, model=${config.cloudflare.visionModel}`);

  // 1. Analyse every frame; skip the ones that fail rather than aborting.
  const analyses = [];
  const failures = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const frameStart = Date.now();
    try {
      const raw = await callVision(file.buffer.toString('base64'), FRAME_PROMPT);
      const parsed = parseJson(raw);
      const ms = Date.now() - frameStart;
      if (parsed && parsed.personVisible !== false) {
        const frame = {
          view: parsed.view || 'front',
          gender: parsed.gender || 'unsure',
          genderConfidence: Number(parsed.genderConfidence) || 0,
          clothing: parsed.clothing || {},
          measurements: parsed.measurements || {},
          proportions: parsed.proportions || {},
          headUnitsToHeight: Number(parsed.headUnitsToHeight) || null,
          confidence: Number(parsed.confidence) || 0.5,
        };
        analyses.push(frame);
        log(`  frame ${i + 1}/${files.length} ok (${ms}ms) — view=${frame.view} gender=${frame.gender} conf=${frame.confidence} clothing=${frame.clothing?.density || '?'} thick=${frame.clothing?.thicknessIn ?? '?'}`);
      } else {
        log(`  frame ${i + 1}/${files.length} skipped (${ms}ms) — ${parsed ? 'no person visible' : 'unreadable reply'}: ${String(raw).slice(0, 200)}`);
      }
    } catch (e) {
      failures.push({ file: file.originalname, error: e.message });
      log(`  frame ${i + 1}/${files.length} FAILED (${Date.now() - frameStart}ms) — ${e.message}`);
    }
  }

  if (analyses.length === 0) {
    log(`✖ no usable frames after ${Date.now() - startedAt}ms (${failures.length} failed)`);
    // Every call erroring is a service problem, not "no person in the video".
    if (failures.length === files.length) {
      throw new HttpError(502, `The vision service rejected every frame. First error: ${failures[0].error}`);
    }
    throw new HttpError(422, 'Could not find a person to measure. Make sure the person fills the frame and the lighting is decent.');
  }

  // 2. Gender, clothing.
  const gender = pickGender(analyses);
  const clothing = combineClothing(analyses);
  const removed = (clothing.thicknessIn || 0) * 2;

  // 3. Measurements "as seen", then minus the clothing width.
  const KEYS = ['chestIn', 'waistIn', 'hipsIn', 'heightIn', 'shoulderIn'];
  const perFrame = [];
  const seenRaw = {};
  for (const key of KEYS) {
    const samples = [];
    for (const a of analyses) {
      const m = readMeasure(a.measurements[key]);
      if (!m) continue;
      const range = RANGES[key];
      if (range && (m.value < range[0] * 0.6 || m.value > range[1] * 1.6)) continue; // parse junk
      samples.push({ value: m.value, confidence: m.confidence, weight: (VIEW_WEIGHT[a.view] ?? 0.7) * (0.3 + 0.7 * m.confidence) });
    }
    seenRaw[key] = robustCombine(samples);
  }
  const seen = {
    chest: round1(seenRaw.chestIn),
    bust: round1(seenRaw.chestIn),
    waist: round1(seenRaw.waistIn),
    hips: round1(seenRaw.hipsIn),
    height: round1(seenRaw.heightIn),
    shoulder: round1(seenRaw.shoulderIn),
  };

  const adjusted = {
    chest: seenRaw.chestIn != null ? clamp(round1(seenRaw.chestIn - removed), RANGES.chestIn) : null,
    waist: seenRaw.waistIn != null ? clamp(round1(seenRaw.waistIn - removed), RANGES.waistIn) : null,
    hips: seenRaw.hipsIn != null ? clamp(round1(seenRaw.hipsIn - removed), RANGES.hipsIn) : null,
    shoulder: seenRaw.shoulderIn != null ? clamp(round1(seenRaw.shoulderIn - removed), RANGES.shoulderIn) : null,
    height: seen.height, // height is unaffected by clothing thickness
    bodyWidthRemovedIn: round1(removed),
  };

  // 4. Per-frame adjusted estimates -> feed the reconciliation pass.
  for (const a of analyses) {
    const row = { view: a.view, confidence: a.confidence };
    for (const key of KEYS) {
      const m = readMeasure(a.measurements[key]);
      if (!m) continue;
      const isGirth = key !== 'heightIn';
      row[key] = round1(isGirth ? m.value - removed : m.value);
    }
    perFrame.push(row);
  }

  // 5. Reconcile across views (best effort; maths result stands if it fails).
  let final = { ...adjusted };
  let reconciled = false;
  let reconcileNote = null;
  if (perFrame.length > 1) {
    try {
      const text = await callModel(config.cloudflare.textModel || config.cloudflare.visionModel, [
        { role: 'system', content: RECONCILE_PROMPT },
        { role: 'user', content: JSON.stringify({ gender: gender.guess, views: perFrame }) },
      ]);
      const r = parseJson(text);
      if (r) {
        const pick = (k, fallback) => {
          const v = typeof r[k] === 'number' ? r[k] : null;
          if (v == null) return fallback;
          const range = RANGES[k];
          if (range && (v < range[0] * 0.85 || v > range[1] * 1.15)) return fallback;
          return round1(v);
        };
        final = {
          chest: pick('chestIn', adjusted.chest),
          waist: pick('waistIn', adjusted.waist),
          hips: pick('hipsIn', adjusted.hips),
          shoulder: pick('shoulderIn', adjusted.shoulder),
          height: pick('heightIn', adjusted.height),
          bodyWidthRemovedIn: adjusted.bodyWidthRemovedIn,
        };
        reconciled = true;
        reconcileNote = typeof r.note === 'string' ? r.note : null;
        log('  reconcile ok —', JSON.stringify({ chestIn: r.chestIn, waistIn: r.waistIn, hipsIn: r.hipsIn, heightIn: r.heightIn }));
      } else {
        log('  reconcile returned nothing usable — keeping the maths result');
      }
    } catch (e) {
      failures.push({ file: 'reconcile', error: e.message });
      log('  reconcile FAILED —', e.message);
    }
  }

  // 6. Size.
  const girth = final.chest ?? final.waist;
  let sizeBasis = null;
  let size = null;
  if (gender.guess === 'male' || gender.guess === 'female') {
    sizeBasis = gender.guess;
    size = bestSize(gender.guess, final.chest);
  } else {
    const m = bestSize('male', girth);
    const f = bestSize('female', girth);
    if (m && f) {
      size = m.diff <= f.diff ? m : f;
      sizeBasis = m.diff <= f.diff ? 'male' : 'female';
    } else if (m || f) {
      size = m || f;
      sizeBasis = m ? 'male' : 'female';
    }
  }

  // 7. Proportions.
  const build = modal(analyses.map((a) => a.proportions.build).filter(Boolean).reduce((acc, b) => ({ ...acc, [b]: (acc[b] || 0) + 1 }), {}));
  const avgProp = (k) => {
    const vals = analyses.map((a) => a.proportions[k]).filter((v) => Number.isFinite(v));
    return vals.length ? round1(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  const proportions = { build, shoulderToHip: avgProp('shoulderToHip'), legToTorso: avgProp('legToTorso') };

  // 8. Notes.
  const notes = [];
  if (clothing.items.length || clothing.fit) {
    notes.push(
      `Clothing${clothing.items.length ? ` (${clothing.items.join(', ')})` : ''}` +
      `${clothing.density ? ` · ${clothing.density} density` : ''}` +
      `${clothing.fit ? ` · ${clothing.fit} fit` : ''}` +
      `${removed > 0.05 ? ` — about ${round1(removed)} in of width removed from the body estimate` : ''}.`
    );
  }
  if (clothing.note) notes.push(clothing.note);
  if (reconcileNote) notes.push(reconcileNote);
  if (gender.guess === 'unsure') notes.push('Gender was ambiguous in the video, so the size was picked from the body proportions alone.');
  if (size && final.chest != null) {
    const key = sizeBasis === 'female' ? 'bust' : 'chest';
    const d = final.chest - CHARTS[sizeBasis][size.sizeKey][key];
    if (d > 1.5) notes.push(`Size ${size.sizeKey} chest/bust may be snug.`);
    else if (d < -2) notes.push(`Size ${size.sizeKey} chest may be loose.`);
  }
  if (analyses.length < 3) notes.push(`Only ${analyses.length} usable frame${analyses.length === 1 ? '' : 's'} — a slower turn gives a steadier estimate.`);

  const result = {
    id: crypto.randomUUID(),
    gender,
    clothing,
    measurements: seen,
    adjusted: final,
    proportions,
    size: size?.sizeKey || null,
    sizeChart: size?.row || null,
    sizeBasis: size ? sizeBasis : null,
    notes,
    views: analyses.map((a) => a.view),
    frameCount: analyses.length,
    reconciled,
    createdAt: new Date().toISOString(),
  };
  if (failures.length) result.frameFailures = failures;

  result.debug = {
    elapsedMs: Date.now() - startedAt,
    framesReceived: files.length,
    framesUsed: analyses.length,
    totalBytes,
    reconciled,
    frames: analyses.map((a) => ({
      view: a.view,
      gender: a.gender,
      confidence: a.confidence,
      density: a.clothing?.density || null,
      thicknessIn: a.clothing?.thicknessIn ?? null,
    })),
  };

  log(`✔ done in ${result.debug.elapsedMs}ms — gender=${gender.guess} basis=${sizeBasis} size=${result.size} seen=${JSON.stringify(seen)} adjusted=${JSON.stringify(final)} reconciled=${reconciled}`);

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
