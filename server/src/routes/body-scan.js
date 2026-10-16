/**
 * Body scan API: video frames -> visible body geometry -> measurements -> size.
 *
 *   POST /api/body-scan   multipart: frames (image files, 1-8)   <- key frames from the video
 *     -> {
 *          id,
 *          gender:       { guess, confidence, scores },
 *          clothing:     { items[], fit, density, thicknessIn, note, ... },
 *          measurements: { chest, bust, waist, hips, shoulder, neck, arm, height },   // as seen, over clothes
 *          adjusted:     { chest, waist, hips, shoulder, neck, arm, height, bodyWidthRemovedIn },
 *          proportions:  { build, shoulderToHip, legToTorso },
 *          geometry:     { scale, methods, height, proportions, dropped[] },   // the working
 *          size, sizeChart, sizeBasis,
 *          notes[], views[], frameCount, reconciled, createdAt
 *        }
 *
 * Results are returned inline and deliberately not stored server-side: the flow
 * is anonymous, and body measurements are not something to keep around.
 *
 * HOW THE NUMBERS ARE PRODUCED — measurement, not guessing:
 *
 *   The vision model is NEVER asked for a size or for inches. It reports only
 *   what it can point at in one frame: normalised landmark coordinates, which
 *   way the body is facing, which parts are visible, and any object of known
 *   size. Every number below is then COMPUTED here from that geometry:
 *
 *     1. SCALE. Each frame gets its own centimetres-per-image-width from an
 *        anchor of known size — the subject's own head (adult head height
 *        22.5-23.5 cm, read off the head landmarks) and/or a reference object
 *        the model could actually identify (a standard door, a chair...).
 *        Anchors are combined as a weighted geometric mean.
 *     2. WIDTH and DEPTH. Front/back frames give body WIDTH at shoulder,
 *        chest, waist, hip, neck and arm level. Side frames give body DEPTH at
 *        the same heights. Both are the horizontal separation of the matching
 *        landmark pair, converted to centimetres with that frame's scale.
 *        Outliers are dropped, the rest are averaged with view/quality weights.
 *     3. GIRTH. A torso cross-section is treated as an ellipse; its perimeter is
 *        computed from the half-width and half-depth (Ramanujan's second
 *        approximation). With no side view the depth falls back to a documented
 *        width:depth ratio.
 *     4. HEIGHT. Head-to-floor, from the floor-contact landmarks in full-body
 *        frames, scaled the same way. Feet out of frame means no height — we say
 *        so instead of inventing one.
 *     5. CLOTHING. The extra width the clothing adds is subtracted from the girths.
 *
 *   A measurement is only reported when the landmarks it needs were visible in
 *   at least one frame. A gap beats an invention.
 */

import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, ah } from '../lib/errors.js';
import {
  CM_PER_IN,
  GIRTH_REGIONS,
  HEAD_HEIGHT_CM,
  REGIONS,
  clamp,
  checkFrame,
  frameQuality,
  frameScale,
  meanY,
  measureHeight,
  measureRegion,
  normGender,
  normView,
  normalizeLandmarks,
  point,
  round1,
  round2,
} from '../lib/bodyGeometry.js';

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
  chest: [26, 64],
  waist: [20, 60],
  hips: [28, 66],
  shoulder: [12, 26],
  neck: [11, 22],
  arm: [8, 22],
  height: [54, 86],
};

/**
 * Everything below the prompt is pure arithmetic on visible geometry, so it
 * lives in ./lib/bodyGeometry.js where it can be tested on its own.
 */
const FRAME_PROMPT = `You are a measuring instrument, not a guesser. You are shown ONE frame from a video of a person slowly turning through 360 degrees. Report only what is VISIBLE in this frame, as geometry we will compute from. Never estimate a size, never give inches or centimetres, and never fill in something you cannot see. A missing value is far more useful than an invented one.

STEP 1 - FIND THE PERSON. Ignore the background, furniture, other people, pets, text and objects. Use only the single person in the foreground. If no person is clearly visible, reply {"personVisible": false} and nothing else.

STEP 2 - WHICH WAY ARE THEY FACING? "view": front | back | side | three-quarter (a side view is a left or right profile).

STEP 3 - PLACE LANDMARKS. Give each point as x,y on a 0-100 scale of THIS image: x=0 is the left edge and x=100 the right edge; y=0 is the top edge and y=100 the bottom. WHOLE NUMBERS only, no decimals. Points:
  headTop     top of the skull
  chin        bottom of the chin
  neckL, neckR       left/right edges of the neck where it meets the shoulders
  shoulderL, shoulderR   the outer bony corners of the shoulders
  armpitL, armpitR   left/right edges of the TORSO at armpit/chest level - the torso only, NOT the arms
  waistL, waistR     left/right edges of the torso at the narrowest point of the waist
  hipL, hipR         left/right edges of the body at the widest hip/seat point
  armL, armR         the left and right edges of ONE upper arm (use the arm on the left of the image), midway between shoulder and elbow
  crotch      where the legs meet
  footL, footR       left/right feet where they touch the floor
CRITICAL: "left/right" ALWAYS means the horizontal extremes in THIS image. In a front or back view a left/right pair measures body WIDTH. In a side view the same pair measures body DEPTH, front to back. If a landmark is hidden, cropped, or you cannot see it clearly, OMIT that key completely - do not guess it.

STEP 4 - WHAT IS VISIBLE. visible: { head, torso, hips, legs, feet } - true only if that part is actually in frame.

STEP 5 - SCALE REFERENCE. If the frame contains an object whose real size you are confident of (a standard interior door is about 203 cm tall, a dining chair seat is about 45 cm from the floor, a fridge is about 170 cm, an A4 sheet is 29.7 cm), give its two end points as "a" and "b", its real length in cm, and how reliable that is 0-1. Most frames have nothing usable: return [].

STEP 6 - CLOTHING AND CAMERA, described plainly (these explain the fabric, they do not become numbers):
  top: t-shirt / polo / shirt / hoodie / jacket / dress / none
  topFit: skin-tight | fitted | regular | loose | oversized
  lower: shorts / trousers / jeans / joggers / skirt / none
  waistband: natural | low | high
  hang: how the fabric hangs and wrinkles across chest, shoulders and midsection
  sleeves: how the sleeves sit on the upper arms
  excessFabric: none | some | a lot - at chest, waist and sleeves
  density: light | medium | heavy
  thicknessIn: the extra width this clothing adds on ONE side of the body, in inches (thin tee ~0.15, hoodie ~0.6, puffer ~1.2)
  camera: { angle: low | eye-level | high, distance: close | medium | far, sharpness: 0-1, lighting: 0-1 }

STEP 7 - WHO. gender: male | female | unsure with genderConfidence 0-1, judged from build, shoulder-to-hip ratio, waist taper and chest shape. Hair and clothing are only weak hints. Also give build: slim | lean | average | broad | muscular | heavyset | petite.

Respond with ONLY this JSON, no markdown and no prose outside it:
{
  "personVisible": true,
  "view": "front",
  "gender": "male",
  "genderConfidence": 0.0,
  "build": "average",
  "landmarks": {
    "headTop": { "x": 50, "y": 6 },
    "chin": { "x": 50, "y": 15 },
    "neckL": { "x": 48, "y": 17 }, "neckR": { "x": 52, "y": 17 },
    "shoulderL": { "x": 37, "y": 21 }, "shoulderR": { "x": 63, "y": 21 },
    "armpitL": { "x": 39, "y": 27 }, "armpitR": { "x": 61, "y": 27 },
    "waistL": { "x": 42, "y": 38 }, "waistR": { "x": 58, "y": 38 },
    "hipL": { "x": 39, "y": 46 }, "hipR": { "x": 61, "y": 46 },
    "armL": { "x": 33, "y": 30 }, "armR": { "x": 36, "y": 30 },
    "crotch": { "x": 50, "y": 52 },
    "footL": { "x": 45, "y": 96 }, "footR": { "x": 55, "y": 96 }
  },
  "visible": { "head": true, "torso": true, "hips": true, "legs": true, "feet": true },
  "references": [],
  "clothing": { "top": "t-shirt", "topFit": "regular", "lower": "jeans", "waistband": "natural", "hang": "", "sleeves": "", "excessFabric": "some", "density": "light", "thicknessIn": 0.15 },
  "camera": { "angle": "eye-level", "distance": "medium", "sharpness": 0.7, "lighting": 0.8 },
  "confidence": 0.0
}`;

/* ---------------- Cloudflare helpers ---------------- */

async function callModelRaw(model, messages, opts = {}) {
  const payload = { messages, max_tokens: opts.maxTokens ?? 512 };
  if (opts.json) payload.response_format = { type: 'json_object' };
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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

async function callModel(model, messages, opts) {
  return extractText(await callModelRaw(model, messages, opts));
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

async function callVision(b64, prompt, opts = {}) {
  const order = visionFormat == null
    ? VISION_FORMATS.map((_, i) => i)
    : [visionFormat, ...VISION_FORMATS.map((_, i) => i).filter((i) => i !== visionFormat)];

  let lastErr = null;
  for (const i of order) {
    const fmt = VISION_FORMATS[i];
    try {
      const text = await callModel(config.cloudflare.visionModel, fmt.messages(b64, prompt), opts);
      if (visionFormat !== i) {
        visionFormat = i;
        log(`  vision message format locked -> "${fmt.name}"`);
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

/** Pixel size of a JPEG, straight out of its SOF marker. */
function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    i += 2 + len;
  }
  return null;
}

/* ---------------- analysis ---------------- */

function pickGender(analyses) {
  const score = { male: 0, female: 0 };
  for (const a of analyses) {
    if (a.gender === 'male' || a.gender === 'female') score[a.gender] += a.genderConfidence ?? 0.5;
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

const firstString = (analyses, get) => analyses.map(get).find((v) => typeof v === 'string' && v.trim()) || null;

function combineClothing(analyses) {
  const raw = [];
  let fit = null;
  let density = null;
  let thickSum = 0;
  let thickN = 0;
  const fitCount = {};
  const densityCount = {};

  for (const a of analyses) {
    const c = a.clothing || {};
    for (const k of ['top', 'lower']) {
      const v = c[k];
      if (typeof v === 'string' && v.trim() && !/^(none|nothing|n\/a)/i.test(v.trim())) raw.push(v.trim());
    }
    if (c.topFit) fitCount[c.topFit] = (fitCount[c.topFit] || 0) + 1;
    if (c.density) densityCount[c.density] = (densityCount[c.density] || 0) + 1;
    if (Number.isFinite(Number(c.thicknessIn)) && Number(c.thicknessIn) >= 0 && Number(c.thicknessIn) < 3) {
      thickSum += Number(c.thicknessIn);
      thickN += 1;
    }
  }

  const modal = (counts) => {
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  };
  fit = modal(fitCount);
  density = modal(densityCount);

  const sentence = (s) => {
    const t = String(s).trim().replace(/\s+/g, ' ');
    if (!t) return null;
    return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
  };
  const waistband = firstString(analyses, (a) => a.clothing?.waistband);
  const parts = [
    sentence(firstString(analyses, (a) => a.clothing?.hang)),
    sentence(firstString(analyses, (a) => a.clothing?.sleeves)),
    /lot|heavy|much/i.test(firstString(analyses, (a) => a.clothing?.excessFabric) || '') ? 'Plenty of excess fabric.' : null,
    waistband && /low|high/i.test(waistband) ? `Waistband sits ${waistband}.` : null,
  ].filter(Boolean);
  const note = parts.length ? parts.join(' ').slice(0, 240) : null;

  return {
    items: [...new Set(raw.map((s) => s.toLowerCase()))].slice(0, 6),
    fit,
    density,
    thicknessIn: thickN ? Number((thickSum / thickN).toFixed(2)) : null,
    waistband: waistband || null,
    note,
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

/* ---------------- route ---------------- */

bodyScan.post('/', upload.array('frames', 8), ah(async (req, res) => {
  if (!config.cloudflare.accountId || !config.cloudflare.apiToken) {
    throw new HttpError(503, 'Body scan is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)');
  }

  const files = req.files;
  if (!files || files.length === 0) throw new HttpError(400, 'Upload at least one frame');

  const startedAt = Date.now();
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  // The frame's true aspect ratio decides how a vertical normed distance (y is
  // normalised by height) converts into the same unit as a horizontal one. Read
  // it straight out of the JPEG so the client cannot get it wrong.
  const jpeg = jpegSize(files[0].buffer);
  const aspect = jpeg
    ? jpeg.width / jpeg.height
    : clamp(Number(req.body?.aspect) || 0.75, [0.3, 3]);

  log(`> POST received - ${files.length} frame(s), ${(totalBytes / 1024).toFixed(0)} KB, aspect=${round2(aspect)}, model=${config.cloudflare.visionModel}`);

  // 1. Analyse every frame IN PARALLEL — each vision call takes ~30-50s, so a
  //    sequential loop would blow the client's timeout. Skip failures rather
  //    than aborting the whole request.
  const frames = [];
  const failures = [];
  const rejected = [];

  await Promise.all(files.map(async (file, i) => {
    const frameStart = Date.now();
    try {
      const raw = await callVision(file.buffer.toString('base64'), FRAME_PROMPT, { maxTokens: 1600, json: true });
      const parsed = parseJson(raw);
      const ms = Date.now() - frameStart;
      if (parsed && parsed.personVisible !== false) {
        const frame = {
          view: normView(parsed.view),
          gender: normGender(parsed.gender),
          genderConfidence: Number(parsed.genderConfidence) || 0,
          build: typeof parsed.build === 'string' ? parsed.build : null,
          landmarks: normalizeLandmarks(parsed.landmarks),
          visible: parsed.visible && typeof parsed.visible === 'object' ? parsed.visible : {},
          references: Array.isArray(parsed.references) ? parsed.references : [],
          clothing: parsed.clothing && typeof parsed.clothing === 'object' ? parsed.clothing : {},
          camera: parsed.camera && typeof parsed.camera === 'object' ? parsed.camera : {},
          confidence: Number(parsed.confidence) || 0.5,
          aspect,
        };
        frame.scale = frameScale(frame);

        // A frame whose landmarks are not a human shape is thrown away whole.
        // Confident nonsense is worse than no measurement.
        const check = checkFrame(frame);
        if (check.fatal) {
          rejected.push({ file: file.originalname, reason: check.notes.join(', ') || 'implausible landmarks' });
          log(`  frame ${i + 1}/${files.length} REJECTED (${ms}ms) - ${check.notes.join(', ')}`);
          return;
        }
        frame.bad = check.bad;
        frame.heightBad = check.heightBad;

        frames.push(frame);
        const keys = Object.keys(frame.landmarks);
        log(`  frame ${i + 1}/${files.length} ok (${ms}ms) - view=${frame.view} gender=${frame.gender} conf=${frame.confidence} landmarks=${keys.length} scale=${frame.scale ? round2(frame.scale.cmPerWidth) + ' cm/width (reliability ' + round2(frame.scale.reliability) + ')' : 'NONE'}${check.bad.size ? ' dropped-regions=' + [...check.bad].join(',') : ''}`);
      } else {
        log(`  frame ${i + 1}/${files.length} skipped (${ms}ms) - ${parsed ? 'no person visible' : 'unreadable reply'}: ${String(raw).slice(0, 200)}`);
      }
    } catch (e) {
      failures.push({ file: file.originalname, error: e.message });
      log(`  frame ${i + 1}/${files.length} FAILED (${Date.now() - frameStart}ms) - ${e.message}`);
    }
  }));

  log(`  all frames done in ${Date.now() - startedAt}ms (${frames.length} usable, ${rejected.length} rejected as implausible, ${failures.length} failed)`);

  if (frames.length === 0) {
    log(`x no usable frames after ${Date.now() - startedAt}ms (${rejected.length} rejected, ${failures.length} failed)`);
    if (failures.length === files.length) {
      throw new HttpError(502, `The vision service rejected every frame. First error: ${failures[0].error}`);
    }
    if (rejected.length) {
      throw new HttpError(422, `The landmarks we read did not describe a human body (${rejected[0].reason}). Film again with the whole person in shot, standing straight and facing the camera.`);
    }
    throw new HttpError(422, 'Could not find a person to measure. Make sure the person fills the frame and the lighting is decent.');
  }

  // 2. Scale. Without an anchor there are no centimetres, so say so rather than
  //    inventing numbers.
  const scaled = frames.filter((f) => f.scale);
  if (!scaled.length) {
    log('x no frame had a usable scale anchor (no head, no reference object)');
    throw new HttpError(422, 'We could not work out the scale of your video — keep your head fully in frame for the whole turn, or include a door or similar in shot, and try again.');
  }

  const scaleWeight = (f) => frameQuality(f) * (f.scale?.reliability ?? 1);
  const scaleW = scaled.reduce((s, f) => s + scaleWeight(f), 0);
  const cmPerWidth = Math.exp(scaled.reduce((s, f) => s + scaleWeight(f) * Math.log(f.scale.cmPerWidth), 0) / scaleW);
  const anchors = [...new Set(scaled.flatMap((f) => f.scale.anchors.map((a) => a.detail)))];

  // 3. Measure every region from the landmark geometry.
  const measured = {};
  const methods = {};
  const dropped = [];
  const droppedByCheck = new Set();
  for (const key of Object.keys(REGIONS)) {
    const r = measureRegion(key, frames);
    if (!r) { dropped.push(key); continue; }
    if (r.skipped) droppedByCheck.add(REGIONS[key].label);
    const range = RANGES[key];
    const v = clamp(r.valueIn, range);
    r.clamped = Math.abs(v - r.valueIn) > 0.05;
    r.valueIn = v;
    measured[key] = r;
    methods[key] = {
      label: r.label,
      girthIn: r.girth ? round1(r.valueIn) : null,
      widthIn: round1(r.widthIn),
      depthIn: r.depthIn == null ? null : round1(r.depthIn),
      depthSource: r.depthSource,
      widthViews: r.widthViews,
      depthViews: r.depthViews,
      formula: r.girth
        ? 'ellipse perimeter of half-width x half-depth'
        : 'horizontal separation of the shoulder landmarks',
      confidence: r.confidence,
      clamped: r.clamped,
    };
  }

  // Nothing believable came out: refuse rather than print a made-up size.
  if (!GIRTH_REGIONS.some((k) => measured[k])) {
    log('x no chest/waist/hip measurement survived the sanity check');
    throw new HttpError(422, 'We could read your video but the measurements did not add up to a human body. Stand straight, face the camera with your arms clear of your sides, and keep your whole body in frame.');
  }

  // 4. Height: head to floor, only from frames where the feet were actually visible.
  const h = measureHeight(frames);
  const heightIn = h ? clamp(h.in, RANGES.height) : null;
  const headUnitsToHeight = h
    ? round1(h.in * CM_PER_IN / (HEAD_HEIGHT_CM[scaled[0].gender] || HEAD_HEIGHT_CM.unsure))
    : null;

  // 5. Proportions, computed from the same geometry.
  const shoulderToHip = measured.shoulder && measured.hips ? round2(measured.shoulder.widthIn / measured.hips.widthIn) : null;
  let legToTorso = null;
  for (const f of frames) {
    if (f.heightBad) continue;
    const top = point(f, 'headTop');
    const crotch = point(f, 'crotch');
    const floorY = meanY(f, 'footL', 'footR');
    if (!top || !crotch || floorY == null) continue;
    const torso = crotch.y - top.y;
    const legs = floorY - crotch.y;
    if (torso > 0.05 && legs > 0.05) {
      const ratio = legs / torso;
      if (ratio > 0.5 && ratio < 1.6) { legToTorso = round2(ratio); break; }
    }
  }
  const build = (() => {
    const counts = {};
    for (const f of frames) if (f.build) counts[f.build] = (counts[f.build] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  })();

  // 6. Gender and clothing.
  const gender = pickGender(frames);
  const clothing = combineClothing(frames);
  const removed = (clothing.thicknessIn || 0) * 2;

  // 7. As seen over the clothes, then minus the clothing width.
  const seen = {
    chest: round1(measured.chest?.valueIn),
    bust: round1(measured.chest?.valueIn),
    waist: round1(measured.waist?.valueIn),
    hips: round1(measured.hips?.valueIn),
    shoulder: round1(measured.shoulder?.valueIn),
    neck: round1(measured.neck?.valueIn),
    arm: round1(measured.arm?.valueIn),
    height: round1(heightIn),
  };
  const adjusted = {
    chest: seen.chest != null ? round1(clamp(seen.chest - removed, RANGES.chest)) : null,
    waist: seen.waist != null ? round1(clamp(seen.waist - removed, RANGES.waist)) : null,
    hips: seen.hips != null ? round1(clamp(seen.hips - removed, RANGES.hips)) : null,
    shoulder: seen.shoulder != null ? round1(clamp(seen.shoulder - removed, RANGES.shoulder)) : null,
    neck: seen.neck,
    arm: seen.arm,
    height: seen.height,
    bodyWidthRemovedIn: round1(removed),
  };

  // 8. Size.
  let size = null;
  let sizeBasis = null;
  if (gender.guess === 'male' || gender.guess === 'female') {
    size = bestSize(gender.guess, adjusted.chest);
    if (size) sizeBasis = gender.guess;
  } else if (adjusted.chest != null) {
    const m = bestSize('male', adjusted.chest);
    const f = bestSize('female', adjusted.chest);
    if (m && f) {
      size = m.diff <= f.diff ? m : f;
      sizeBasis = m.diff <= f.diff ? 'male' : 'female';
    } else if (m || f) {
      size = m || f;
      sizeBasis = (m ? 'male' : 'female');
    }
  }

  // 9. Notes — including exactly which gaps we refused to fill.
  const notes = [];
  const label = (k) => REGIONS[k]?.label || k;
  const visibleRegions = GIRTH_REGIONS.filter((k) => measured[k]);
  if (visibleRegions.length) {
    notes.push(`Measured from what is visible in the clip: ${visibleRegions.map((k) => label(k).toLowerCase()).join(', ')}${heightIn != null ? ' and full height' : ''}.`);
  }
  for (const k of dropped) {
    if (k === 'neck' || k === 'arm') continue;
    notes.push(`${label(k)} was not visible in the clip, so it was left blank rather than guessed.`);
  }
  if (droppedByCheck.size) {
    notes.push(`${[...droppedByCheck].join(' and ')} came out an impossible size in at least one frame, so ${droppedByCheck.size > 1 ? 'those frames were' : 'that frame was'} left out of ${droppedByCheck.size > 1 ? 'their' : 'its'} average.`);
  }
  const clampedRegions = GIRTH_REGIONS.filter((k) => measured[k]?.clamped);
  if (clampedRegions.length) {
    notes.push(`The ${clampedRegions.map((k) => label(k).toLowerCase()).join(' and ')} reading was outside the plausible range and has been clamped — treat ${clampedRegions.length > 1 ? 'them' : 'it'} as the least reliable number here.`);
  }
  if (heightIn == null && measured.chest) {
    notes.push('Height was not measured — your feet were not in frame. Film the full body to get it.');
  }
  if (clothing.items.length || clothing.fit) {
    notes.push(
      `Clothing${clothing.items.length ? ` (${clothing.items.join(', ')})` : ''}` +
      `${clothing.density ? ` · ${clothing.density} density` : ''}` +
      `${clothing.fit ? ` · ${clothing.fit} fit` : ''}` +
      `${removed > 0.05 ? ` — about ${round1(removed)} in of width subtracted from the body estimate` : ''}.`
    );
  }
  if (clothing.note) notes.push(clothing.note);
  if (gender.guess === 'unsure') notes.push('Gender was ambiguous in the video, so the size was picked from the body proportions alone.');
  if (size && adjusted.chest != null) {
    const key = sizeBasis === 'female' ? 'bust' : 'chest';
    const d = adjusted.chest - CHARTS[sizeBasis][size.sizeKey][key];
    if (d > 1.5) notes.push(`Size ${size.sizeKey} chest/bust may be snug.`);
    else if (d < -2) notes.push(`Size ${size.sizeKey} chest may be loose.`);
  }
  if (frames.length < 3) notes.push(`Only ${frames.length} usable frame${frames.length === 1 ? '' : 's'} — a slower turn gives a steadier estimate.`);
  if (Object.values(measured).some((m) => !m.depthMeasured && m.girth)) {
    notes.push('No clear side-on frame, so body depth was modelled from the front width rather than measured.');
  }

  const result = {
    id: crypto.randomUUID(),
    gender,
    clothing,
    measurements: seen,
    adjusted,
    proportions: { build, shoulderToHip, legToTorso },
    geometry: {
      aspect: round2(aspect),
      scale: { cmPerImageWidth: round2(cmPerWidth), anchors },
      methods,
      height: heightIn != null
        ? { in: round1(heightIn), headUnits: headUnitsToHeight, views: h.views || 0, spread: round2(h.spread ?? 0) }
        : null,
      dropped,
      frames: frames.map((f) => ({
        view: f.view,
        landmarks: Object.keys(f.landmarks).length,
        scaleCmPerWidth: f.scale ? round2(f.scale.cmPerWidth) : null,
      })),
    },
    size: size?.sizeKey || null,
    sizeChart: size?.row || null,
    sizeBasis: size ? sizeBasis : null,
    notes,
    views: frames.map((f) => f.view),
    frameCount: frames.length,
    reconciled: frames.length > 1 && visibleRegions.length > 0,
    createdAt: new Date().toISOString(),
  };
  if (failures.length) result.frameFailures = failures;
  if (rejected.length) result.frameRejected = rejected;

  result.debug = {
    elapsedMs: Date.now() - startedAt,
    framesReceived: files.length,
    framesUsed: frames.length,
    framesRejected: rejected.length,
    totalBytes,
    aspect: round2(aspect),
    cmPerImageWidth: round2(cmPerWidth),
    anchors,
    reconciled: result.reconciled,
  };

  log(`done in ${result.debug.elapsedMs}ms - gender=${gender.guess} basis=${sizeBasis} size=${result.size} scale=${round2(cmPerWidth)}cm/width anchors=[${anchors.join('; ')}]`);
  log(`  seen=${JSON.stringify(seen)} adjusted=${JSON.stringify(adjusted)}`);
  log(`  methods=${JSON.stringify(methods)}`);

  res.json(result);
}));
