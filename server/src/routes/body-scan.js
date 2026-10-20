/**
 * Body scan API: video frames -> visible body geometry -> measurements -> size.
 *
 *   POST /api/body-scan   multipart: video (1 clip, decoded here)        <- default
 *                         or frames (JPEGs, 1-16)                        <- ?frames=1, fallback
 *                         or JSON: { source: 'pose', frames: [...] }     <- ?local=1
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
 * HOW THE NUMBERS ARE PRODUCED â€” measurement, not guessing:
 *
 *   The vision model is NEVER asked for a size or for inches. It reports only
 *   what it can point at in one frame: normalised landmark coordinates, which
 *   way the body is facing, which parts are visible, and any object of known
 *   size. Every number below is then COMPUTED here from that geometry:
 *
 *     1. SCALE. Each frame gets its own centimetres-per-image-width from an
 *        anchor of known size â€” the subject's own head (adult head height
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
 *        frames, scaled the same way. Feet out of frame means no height â€” we say
 *        so instead of inventing one.
 *     5. CLOTHING. The extra width the clothing adds is subtracted from the girths.
 *
 *   A measurement is only reported when the landmarks it needs were visible in
 *   at least one frame. A gap beats an invention.
 */

import { Router } from 'express';
import multer from 'multer';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { config, visionConfigured, visionModelName } from '../config.js';
import { HttpError, ah } from '../lib/errors.js';
import { framesFromVideo, MAX_FRAMES } from '../lib/videoFrames.js';
import {
  CM_PER_IN,
  HEAD_HEIGHT_CM,
  REGIONS,
  clamp,
  checkFrame,
  frameQuality,
  frameScale,
  frameTurn,
  meanY,
  measureHeight,
  measureRegion,
  normGender,
  normView,
  normalizeLandmarks,
  point,
  round1,
  round2,
  round3,
  sawRegion,
  spanX,
} from '../lib/bodyGeometry.js';
import { buildCatalogue, depthRatioFor } from '../lib/catalogue.js';
import { aiErrorMessage, authHeaders, classifyAiError, modelUrl, recordVision } from '../lib/cloudflare.js';
import { mistralChat } from '../lib/mistral.js';
import { bestSize, chartFromInput, CHARTS, chartKey, columnsFromRows } from '../lib/sizing.js';
import { measureField } from '../shared/measures.js';

/**
 * Uploads land on disk, not in memory: a phone clip can be tens of megabytes and
 * Render's free instance has 512 MB to live in. The files are deleted in the
 * route's `finally`, whatever happens.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpdir()),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname || '') || (file.mimetype === 'video/quicktime' ? '.mov' : '');
      cb(null, `3dg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 160 * 1024 * 1024, files: 17 },
  fileFilter: (_req, file, cb) => {
    const image = /^image\/(jpeg|png|webp)$/i.test(file.mimetype);
    const video = /^video\//i.test(file.mimetype)
      || (file.fieldname === 'video' && /^application\/octet-stream$/i.test(file.mimetype));
    cb(image || video ? null : new HttpError(415, `Unsupported file type: ${file.mimetype || 'unknown'}`), image || video);
  },
});

export const bodyScan = Router();

const log = (...args) => console.log('[body-scan]', ...args);

/** Plausible adult ranges in inches â€” used to reject/repair absurd values. */
const RANGES = {
  chest: [26, 64],
  waist: [20, 60],
  hips: [28, 66],
  shoulder: [14, 26],
  neck: [11, 22],
  arm: [9, 22],
  height: [54, 86],
};

/**
 * Everything below the prompt is pure arithmetic on visible geometry, so it
 * lives in ./lib/bodyGeometry.js where it can be tested on its own.
 */
const FRAME_PROMPT = `You are a measuring instrument, not a guesser. You are shown ONE frame from a video of a person slowly turning through 360 degrees. Report only what is VISIBLE in this frame, as geometry we will compute from. Never estimate a size, never give inches or centimetres, and never fill in something you cannot see. A missing value is far more useful than an invented one.

STEP 1 - FIND THE PERSON. Ignore the background, furniture, other people, pets, text and objects. Use only the single person in the foreground. If no person is clearly visible, reply {"personVisible": false} and nothing else.

STEP 2 - WHICH WAY ARE THEY FACING? "view": front | back | side | three-quarter (a side view is a left or right profile). Also give "turn": how far the body has rotated away from square-on to the camera, in whole degrees 0-90, kept consistent with the view (front or back 0-15, three-quarter 25-65, side 70-90).

STEP 3 - PLACE LANDMARKS. Give each point as x,y on a 0-100 scale of THIS image: x=0 is the left edge and x=100 the right edge; y=0 is the top edge and y=100 the bottom. WHOLE NUMBERS only, no decimals.
A labelled 10x10 grid has been drawn over the image to help you: the numbers along the TOP edge give x and the numbers down the LEFT edge give y. Read each landmark against that grid so it lands within a few percent of the right place. The grid is only an overlay â€” ignore it otherwise, it is not clothing and not part of the scene.
Points:
  headTop     top of the skull
  chin        the LOWEST point of the chin/jaw, below the mouth - not the mouth, not the lip
  neckL, neckR       left/right edges of the neck where it meets the shoulders
  shoulderL, shoulderR   the outer bony corners of the shoulders - the WIDEST points of the deltoids, level with the top of the armpit. Not the neck, not the collarbone, not the inner edge of the arm
  armpitL, armpitR   left/right edges of the TORSO at armpit/chest level - the torso only, NOT the arms
  waistL, waistR     left/right edges of the torso at the narrowest point of the waist
  hipL, hipR         left/right edges of the body at the widest hip/seat point
  armL, armR         the left and right edges of ONE upper arm (use the arm on the left of the image), midway between shoulder and elbow
  elbowJointL, elbowJointR   the bony point of each elbow - the back of the joint, not the crease in front of it
  wristJointL, wristJointR   the wrist bone on each arm, where the hand meets the forearm - NOT the knuckles and NOT the fingertips
  crotch      where the legs meet
  footL, footR       left/right feet where they touch the floor
CRITICAL: "left/right" ALWAYS means the horizontal extremes in THIS image. In a front or back view a left/right pair measures body WIDTH. In a side view the same pair measures body DEPTH, front to back.

TWO MISTAKES RUIN THE MEASUREMENT. Check your own answer against both before you reply:

  1. DESCRIBING A TYPICAL BODY INSTEAD OF THIS ONE. The person may be small in the frame, off-centre, closer or further from the camera, and may run off the edges of the image. Put every point exactly where the body is in THIS image, even if that bunches all of your points into one small part of it. A tidy, centred, symmetrical set of points is a warning sign that you have drawn an average person instead of looking at this one - look again.

  2. PLACING WHAT YOU CANNOT SEE. If the frame cuts the person off at the hips, there is no crotch, no feet and no floor contact: OMIT crotch, footL and footR, and set visible.legs and visible.feet to false. Never place a point you cannot see, and never place one where a part would be if it were in shot. The head is what every measurement is scaled from, so read the chin with particular care: a head measured half its real size doubles every measurement.

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

HOW THE POINTS RELATE ON A REAL STANDING ADULT - a check on your own answer, never a substitute for looking at the frame:
  - the whole body is about 7.5 head-lengths tall, so in a full-body frame the head is about 1/7.5 of the person's height
  - the bony shoulder corners are about 2.1 head-lengths apart. CHECK THIS: take your own headTop-to-chin distance and your own shoulderL-to-shoulderR distance. If the shoulders are less than two head-lengths apart you have placed them on the neck or the armpits - move them out onto the widest bony corners and check again
  - the elbow joint sits about 3.3 head-lengths below the crown and the wrist bone about 4.6, so the wrist bone hangs BELOW the widest hip point and well below the waist - never level with the waist, never at the hip
  - the chest is a little narrower than the shoulders, the waist narrower again, and the hips a little wider than the waist

Respond with ONLY this JSON, no markdown and no prose outside it. The numbers in it are only the FORMAT, and happen to describe one full-body portrait frame with the person filling it: they are not an answer to copy, and the person in your frame may sit in a completely different part of the image.
{
  "personVisible": true,
  "view": "front",
  "turn": 0,
  "gender": "male",
  "genderConfidence": 0.0,
  "build": "average",
  "landmarks": {
    "headTop": { "x": 50, "y": 5 },
    "chin": { "x": 50, "y": 17 },
    "neckL": { "x": 45, "y": 19 }, "neckR": { "x": 55, "y": 19 },
    "shoulderL": { "x": 28, "y": 21 }, "shoulderR": { "x": 72, "y": 21 },
    "armpitL": { "x": 31, "y": 27 }, "armpitR": { "x": 69, "y": 27 },
    "waistL": { "x": 35, "y": 40 }, "waistR": { "x": 65, "y": 40 },
    "hipL": { "x": 34, "y": 47 }, "hipR": { "x": 66, "y": 47 },
    "armL": { "x": 21, "y": 30 }, "armR": { "x": 31, "y": 30 },
    "elbowJointL": { "x": 26, "y": 38 }, "elbowJointR": { "x": 74, "y": 38 },
    "wristJointL": { "x": 25, "y": 51 }, "wristJointR": { "x": 75, "y": 51 },
    "crotch": { "x": 50, "y": 52 },
    "footL": { "x": 45, "y": 95 }, "footR": { "x": 55, "y": 95 }
  },
  "visible": { "head": true, "torso": true, "hips": true, "legs": true, "feet": true },
  "references": [],
  "clothing": { "top": "t-shirt", "topFit": "regular", "lower": "jeans", "waistband": "natural", "hang": "", "sleeves": "", "excessFabric": "some", "density": "light", "thicknessIn": 0.15 },
  "camera": { "angle": "eye-level", "distance": "medium", "sharpness": 0.7, "lighting": 0.8 },
  "confidence": 0.0
}`;

/**
 * One analysed frame, as numbers rather than prose: what the model placed, what
 * that works out to in centimetres, and which of those readings the sanity check
 * refused. Attached to the 422 replies so a refusal can be EXPLAINED instead of
 * guessed at â€” a failed scan that says nothing is impossible to act on.
 */
function frameDigest(f, reason) {
  const spans = {};
  for (const key of Object.keys(REGIONS)) {
    const span = spanX(f, REGIONS[key].left, REGIONS[key].right);
    spans[key] = span == null || !f.scale ? null : round2(span * f.scale.cmPerWidth);
  }
  return {
    file: f.file,
    ...(reason ? { reason } : {}),
    ms: f.ms,
    tokens: f.usage?.completion_tokens ?? null,
    neurons: f.usage?.neurons == null ? null : Math.round(f.usage.neurons),
    view: f.view,
    turn: round1(frameTurn(f)),
    camera: f.camera,
    references: (f.references || []).map((r) => `${r.what} (${r.knownCm} cm)`),
    gender: f.gender,
    confidence: f.confidence,
    visible: f.visible,
    cmPerWidth: f.scale ? round2(f.scale.cmPerWidth) : null,
    reliability: f.scale ? round2(f.scale.reliability) : null,
    headUnitsCorrection: f.scale ? f.scale.headUnitsCorrection : null,
    anchors: f.scale ? f.scale.anchors.map((a) => a.detail) : [],
    landmarksPlaced: Object.keys(f.landmarks || {}),
    spansCm: spans,
    droppedRegions: [...(f.bad || [])],
    heightBad: !!f.heightBad,
    floorInvented: !!f.floorInvented,
    landmarks: f.landmarks,
  };
}

/* ---------------- Cloudflare helpers ---------------- */

/**
 * Run `fn` over `items`, at most `limit` at a time, keeping the order.
 *
 * Four, not eight. Measured on the live API: eight calls at once come back as
 * six in about 15 s and two in about 86 s â€” the extra two spend seventy seconds
 * waiting for a GPU slot, and the whole scan waits with them. Two waves of four
 * cost about 30 s and keep all eight angles, which is the trade the shopper
 * actually wants. Sixteen at once is worse still: it draws a 429, which is a
 * measurement that never happened.
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Which provider actually read the last frame: 'mistral' or 'cloudflare'. */
let servedBy = null;

const canFallBack = () => config.vision.provider === 'mistral'
  && config.vision.fallback
  && Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);

async function callModelRaw(model, messages, opts = {}) {
  // Mistral speaks the same message shape we already build, and answers with the
  // same choices/usage envelope â€” its client wraps that as { result } so every
  // caller above this line keeps reading one shape. A 429 there is a rate limit,
  // not a queue: one short wait is worth it, more is not.
  if (config.vision.provider === 'mistral' && !opts.viaCloudflare) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const out = await mistralChat(messages, { maxTokens: opts.maxTokens ?? 512, json: opts.json, temperature: opts.temperature ?? 0.1 });
        servedBy = 'mistral';
        return out;
      } catch (e) {
        // A rate limit is the service describing its own pace, and the pacer in
        // mistral.js has already taken the note. Give it room and try again —
        // four frames on a one-a-second key need three waits between them.
        if (e?.upstream?.kind === 'capacity' && attempt < 4) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        // A key that cannot answer must not take the shop down with it. When a
        // Workers AI key is also present this frame is read there instead —
        // logged, counted, and visible in the scan's own diagnostics, never
        // silent. VISION_FALLBACK=0 turns the net off.
        if (canFallBack()) {
          log(`!! Mistral refused this frame (${e?.upstream?.status || e?.message}) — reading it with Workers AI instead`);
          recordVision(false, { status: e?.upstream?.status, kind: 'fallback', message: String(e?.upstream?.message || e?.message).slice(0, 200) });
          break;
        }
        throw e;
      }
    }
  }
  // The tag describes who read the frames. The calculation step comes through
  // here too and used to overwrite it, so every scan looked like a Workers AI
  // fallback even when Mistral had read all four frames.
  if (!opts.viaCloudflare) servedBy = 'cloudflare';

  // When we arrived here by falling back from Mistral, the model argument is
  // Mistral's name — Workers AI would not know it. The net always uses the
  // Workers AI model.
  const cfModel = config.vision.provider === 'mistral' && !opts.viaCloudflare ? config.cloudflare.visionModel : model;
  const payload = { messages, max_tokens: opts.maxTokens ?? 512 };
  if (Number.isFinite(Number(opts.temperature))) payload.temperature = Number(opts.temperature);
  if (/qwen/i.test(cfModel)) {
    // Qwen 3 reasons before it answers, and that reasoning is billed as output
    // AND counted against max_tokens. At 1600 the JSON was being cut off
    // mid-landmark on six frames out of eight, which surfaced as "unreadable
    // reply" and left the scan measuring a body from the one frame that got
    // through. Placing a point on a photograph needs no deliberation, so the
    // thinking is switched off at the template instead of paid for.
    payload.reasoning_effort = 'low';
    payload.chat_template_kwargs = { ...(payload.chat_template_kwargs || {}), enable_thinking: false };
  }
  if (opts.json) payload.response_format = { type: 'json_object' };
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(modelUrl(cfModel), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
    if (res.ok) {
      recordVision(true);
      return res.json();
    }
    const body = await res.text().catch(() => '');
    const kind = classifyAiError(res.status, body);
    recordVision(false, { status: res.status, kind, message: body.slice(0, 300) });
    // Cloudflare's GPUs are shared: a burst of frames can be told "capacity
    // temporarily exceeded". One short wait and the same frame is read for
    // real, which is much better than throwing a measurement away. A spent
    // daily allowance is NOT that â€” it will not clear in a second.
    if ((kind === 'capacity' || kind === 'upstream') && attempt < 2) {
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      continue;
    }
    if (kind === 'quota') {
      log('!! Workers AI daily allowance is spent â€” every scan will refuse until it resets (around 00:00 UTC)');
    }
    if (kind === 'auth') log('!! Workers AI rejected the API token (401/403) â€” a new token is needed');
    // The shopper gets a sentence; the scan's own diagnostics get the truth.
    // Without this, five different upstream failures all read as "could not read
    // this clip" and the only place to look is a log we cannot see.
    const err = new HttpError(502, aiErrorMessage(kind));
    err.debug = { upstreamStatus: res.status, kind, body: body.slice(0, 500) };
    throw err;
  }
}

/** What the model said, and whether it stopped early or was cut off. */
function extractMeta(data) {
  const choice = data?.result?.choices?.[0];
  return {
    finish: choice?.finish_reason ?? null,
    usage: data?.result?.usage ?? null,
    hasResult: data?.result != null,
  };
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

/**
 * Mistral's own image message, exactly as its docs spell it: `image_url` is the
 * data URL STRING, not the OpenAI `{ url }` object Cloudflare accepts. Getting
 * this wrong is invisible until the first call that is allowed through — which
 * is why it is a separate shape rather than a hope that both providers agree.
 */
const MISTRAL_MESSAGES = (b64, prompt) => [
  { role: 'system', content: prompt },
  { role: 'user', content: [
    { type: 'text', text: 'Analyse this frame and reply with the JSON.' },
    { type: 'image_url', image_url: `data:image/jpeg;base64,${b64}` },
  ] },
];

/** The index of the vision format that last worked (null = not yet known). */
let visionFormat = null;

function isFormatError(e) {
  // Cloudflare returns 400 for a malformed message body; anything else (429, 500)
  // is worth surfacing rather than silently retrying every shape.
  return /Cloudflare AI error: 400/.test(e?.message || '');
}

async function callVision(b64, prompt, opts = {}) {
  // Mistral takes one message shape and means its 400s: there is no shape to
  // discover, and nothing to hide a real error behind.
  if (config.vision.provider === 'mistral') {
    const data = await callModelRaw(visionModelName(), MISTRAL_MESSAGES(b64, prompt), opts);
    return { text: extractText(data), meta: extractMeta(data) };
  }

  const order = visionFormat == null
    ? VISION_FORMATS.map((_, i) => i)
    : [visionFormat, ...VISION_FORMATS.map((_, i) => i).filter((i) => i !== visionFormat)];

  let lastErr = null;
  for (const i of order) {
    const fmt = VISION_FORMATS[i];
    try {
      const data = await callModelRaw(config.cloudflare.visionModel, fmt.messages(b64, prompt), opts);
      if (visionFormat !== i) {
        visionFormat = i;
        log(`  vision message format locked -> "${fmt.name}"`);
      }
      // Both halves: the words, and whether the model was cut off before it
      // could finish them (a 27B reasoning model can spend the whole token
      // budget thinking and answer with nothing at all).
      return { text: extractText(data), meta: extractMeta(data) };
    } catch (e) {
      lastErr = e;
      log(`  vision format "${fmt.name}" rejected: ${(e?.message || e).slice(0, 200)}`);
      if (!isFormatError(e)) break; // a real outage; don't hammer every shape
    }
  }
  if (visionFormat != null) visionFormat = null; // rediscover on the next request
  throw lastErr;
}

/* ---------------- Mistral collects, Cloudflare calculates ---------------- */

/**
 * The second half of the scan: the numbers, not the pixels.
 *
 * The vision pass is deliberately dumb. It says where things are on each
 * photograph — points, a view, a turn — and nothing else. Those raw readings are
 * not yet a body: the same person cannot be narrower at the shoulders than at
 * the hips in a square-on frame, a profile frame cannot be as wide as a front
 * one, and one head cannot change length between frames. This step hands the
 * readings to Workers AI and asks it to do the calculation: line the frames up
 * as one body, correct the points that contradict the body they describe, and
 * state the measurements. The corrected points then go through the same exact
 * geometry as always, and where geometry still cannot produce a reading,
 * Cloudflare's own number is used if it is humanly possible.
 */
const RECONCILE_PROMPT = `You are the calculation step of a body-measuring tool. A cheaper vision model looked at frames of ONE person slowly turning through 360 degrees and reported, per frame, landmark positions on a 0-100 grid (x: 0 left edge to 100 right edge; y: 0 top edge to 100 bottom edge), what parts were visible, which way they were facing and how far they were turned. It is good at seeing and bad at consistency.

Turn those raw readings into ONE consistent human body and state its measurements.

WHAT MUST HOLD, in every frame you correct and across the set:
- A person is widest square-on and narrowest in profile. The frame with the widest shoulder span is the front or back frame; the narrowest is the profile.
- Shoulders are at least as wide as the hips in a front or back view; the waist is narrower than both.
- The wrist bone hangs below the hip point, never level with the waist.
- The chin is below the mouth, the headTop above it; the head is about one seventh of a standing body.
- The same head, in metres, in every frame: if one frame's headTop-to-chin span is wildly different from the others, it is the outlier and its points are scaled wrongly.
- Never invent a part that is out of shot. If the feet were not visible in any frame there is no floor contact and no height.
- Move a point only when the evidence requires it, and keep it inside 0-100.

MEASUREMENTS, in INCHES, for a standing adult, and humanly possible:
chest 26-64, waist 20-60, hips 28-66, shoulder 14-26, neck 11-22, arm 9-22 (shoulder to wrist bone), height 54-86. Use null for anything the frames cannot support.

Reply with ONLY this JSON, no prose:
{"frames":[{"i":0,"view":"front|back|side|three-quarter","turn":0}],
 "measurements":{"chest":0,"waist":0,"hips":0,"shoulder":0,"neck":0,"arm":0,"height":0},
 "notes":["what you corrected, in a few words"]}`;

/**
 * The deadline is deliberately short. Workers AI shares GPUs and a busy minute
 * can queue a call for two minutes; the shopper must never wait for that. If the
 * calculation has not come back in time, the scan measures from the points it
 * already has and says nothing about it.
 *
 * A miss is not free, though: the points on their own read about seven inches
 * small on a clip that does not show the feet, because the scale comes from the
 * head. So a miss is worth one more attempt, and the attempt count is kept for
 * the diagnostics rather than hidden.
 */
const RECONCILE_TIMEOUT_MS = Number(process.env.VISION_RECONCILE_TIMEOUT_MS || 10_000);
const RECONCILE_ATTEMPTS = 2;

async function reconcileWithCloudflare(frames, modelOverride = '') {
  const raw = frames.map((f, i) => ({
    i,
    view: f.view,
    turn: Number.isFinite(f.turn) ? f.turn : null,
    visible: f.visible,
    landmarks: Object.fromEntries(Object.entries(f.landmarks).map(([k, p]) => [k, [Math.round(p.x * 100), Math.round(p.y * 100)]])),
  }));

  const model = modelOverride || config.cloudflare.textModel || config.cloudflare.visionModel;
  const messages = [
    { role: 'system', content: RECONCILE_PROMPT },
    { role: 'user', content: `The frames are in time order as the person turns. Raw readings:\n${JSON.stringify(raw)}\n\nReply with the corrected JSON.` },
  ];

  let out = null;
  let attempts = 0;
  let waited = 0;
  let lastError = null;
  while (!out && attempts < RECONCILE_ATTEMPTS) {
    attempts += 1;
    const t0 = Date.now();
    try {
      const data = await callModelRaw(model, messages, { viaCloudflare: true, maxTokens: 600, json: true, temperature: 0, timeoutMs: RECONCILE_TIMEOUT_MS });
      out = parseJson(extractText(data));
      if (!out) lastError = 'unreadable reply';
    } catch (e) {
      lastError = String(e?.message || e).slice(0, 160);
    }
    waited += Date.now() - t0;
    if (!out && attempts < RECONCILE_ATTEMPTS) log(`  calculation attempt ${attempts} missed (${lastError}) after ${Date.now() - t0}ms - one more go`);
  }

  if (!out) return { calc: null, relabelled: 0, notes: [], attempts, waited, error: lastError };

  // Which frame is square-on decides every width's correction, and the raw pass
  // labels all four "three-quarter". That is the one label worth fixing.
  let relabelled = 0;
  for (const fix of Array.isArray(out.frames) ? out.frames : []) {
    const frame = frames[Number(fix?.i)];
    if (!frame) continue;
    const view = fix.view ? normView(fix.view) : frame.view;
    const turn = Number.isFinite(Number(fix.turn)) ? clamp(Number(fix.turn), [0, 90]) : frame.turn;
    if (view !== frame.view || turn !== frame.turn) relabelled += 1;
    frame.view = view;
    if (turn != null) frame.turn = turn;
  }

  const calc = {};
  for (const [k, v] of Object.entries(out.measurements || {})) {
    const n = Number(v);
    const range = RANGES[k];
    if (range && Number.isFinite(n) && n >= range[0] && n <= range[1]) calc[k] = round1(n);
  }
  return { calc, relabelled, notes: Array.isArray(out.notes) ? out.notes.slice(0, 6) : [], attempts, waited, error: null };
}


/**
 * A foot placed on the very bottom edge of the frame is the crop, not the floor.
 * Trusting it turns "the video ends at your ankles" into a height, which is a
 * number nobody measured. Within 1.5% of the edge is close enough to be the edge.
 */
function dropEdgeFeet(frame) {
  let dropped = false;
  for (const k of ['footL', 'footR']) {
    const p = frame.landmarks[k];
    if (p && p.y > 0.985) {
      delete frame.landmarks[k];
      dropped = true;
    }
  }
  if (dropped) frame.floorInvented = true;
}

/** The middle value. With three readings it is the one that agreed. */
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The value that turned up most often, and how often. */
function mostCommon(values) {
  const tally = new Map();
  for (const v of values) tally.set(v, (tally.get(v) || 0) + 1);
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0] ? { value: sorted[0][0], count: sorted[0][1] } : { value: null, count: 0 };
}

/**
 * One frame, read more than once, agreed down to one reading.
 *
 * A single pass places a shoulder point once and is stuck with it; the second
 * pass usually lands within a centimetre, and when it does not, the median of
 * three ignores the one that wandered. That is the whole point: the reads are
 * deliberately not identical (the repeats run at a temperature that lets the
 * model look again rather than repeat itself), so agreement is evidence and a
 * lone wild reading is outvoted instead of averaged into the body.
 *
 * Landmarks are merged per point, because a frame that nails the hips and
 * misses a wrist should keep the hips. Labels (view, gender) go by majority;
 * measurements (turn) by median. Anything only one read mentioned is kept only
 * if a majority of the reads that saw the frame produced it.
 */
function mergeReads(list) {
  if (list.length === 1) return list[0];
  const base = list[0];
  const need = Math.ceil(list.length / 2);

  const landmarks = {};
  const keys = new Set(list.flatMap((r) => Object.keys(r.landmarks || {})));
  for (const k of keys) {
    const pts = list
      .map((r) => r.landmarks?.[k])
      .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (pts.length < need) continue;
    landmarks[k] = { x: round2(median(pts.map((p) => p.x))), y: round2(median(pts.map((p) => p.y))) };
  }

  const visible = {};
  for (const k of new Set(list.flatMap((r) => Object.keys(r.visible || {})))) {
    const vals = list.map((r) => r.visible?.[k]).filter((v) => typeof v === 'boolean');
    if (vals.length) visible[k] = vals.filter(Boolean).length * 2 > vals.length;
  }

  const views = list.map((r) => normView(r.view)).filter(Boolean);
  const turns = list.map((r) => Number(r.turn)).filter((n) => Number.isFinite(n));
  const genders = list.map((r) => normGender(r.gender)).filter((g) => g !== 'unsure');
  const gender = mostCommon(genders);

  return {
    ...base,
    view: mostCommon(views).value || base.view,
    turn: turns.length ? median(turns) : base.turn,
    gender: gender.value || base.gender,
    // How sure the frame is, now meaning how many of the reads agreed — not one
    // read's own claim about itself.
    genderConfidence: genders.length ? round2(gender.count / genders.length) : 0,
    landmarks,
    visible,
    confidence: round2(list.reduce((s, r) => s + (Number(r.confidence) || 0.5), 0) / list.length),
    reads: list.length,
  };
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

const NULLISH = /^(null|nil|none|n\/?a|unknown|unsure|not (visible|applicable|clear)|nothing|no|both|-+|â€”+|\.+|)$/i;
const firstString = (analyses, get) => analyses
  .map(get)
  .map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''))
  .find((v) => v && !NULLISH.test(v)) || null;

function combineClothing(analyses) {
  const raw = [];
  let fit = null;
  let density = null;
  let thickSum = 0;
  let thickN = 0;
  let lowerSum = 0;
  let lowerN = 0;
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
    // Trousers are not a hoodie: the lower garment is a second thickness, over
    // different rows, and folding the two together would put a jumper's fabric
    // round the hips.
    if (Number.isFinite(Number(c.lowerThicknessIn)) && Number(c.lowerThicknessIn) >= 0 && Number(c.lowerThicknessIn) < 3) {
      lowerSum += Number(c.lowerThicknessIn);
      lowerN += 1;
    }
  }

  const modal = (counts) => {
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  };
  fit = modal(fitCount);
  density = modal(densityCount);

  const sentence = (s) => {
    if (typeof s !== 'string') return null;
    const t = s.trim().replace(/\s+/g, ' ');
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

  const uniqItems = [...new Set(raw.map((s) => s.toLowerCase()))];
  // "suit jacket" and "jacket" are the same garment seen twice.
  const items = uniqItems.filter((a) => !uniqItems.some((b) => b !== a && b.includes(a))).slice(0, 6);

  return {
    items,
    fit,
    density,
    thicknessIn: thickN ? Number((thickSum / thickN).toFixed(2)) : null,
    lowerThicknessIn: lowerN ? Number((lowerSum / lowerN).toFixed(2)) : null,
    waistband: waistband || null,
    note,
  };
}

/* ---------------- route ---------------- */

/**
 * Frames measured ON THE DEVICE and sent as numbers: pose joints plus the
 * silhouette widths the browser read off the segmentation mask. There is no
 * picture and no model call here â€” the server only does arithmetic and the same
 * sanity checks it applies to model-supplied landmarks.
 */
function geometryFrames(body) {
  if (!body || body.source !== 'pose' || !Array.isArray(body.frames)) return null;
  // Take everything the device measured, not a handful: every extra view of the
  // chest is another frame the tape is read from, and one frame deciding a size
  // is exactly how a good clip gets a bad number.
  const frames = body.frames.filter((f) => f && f.landmarks && typeof f.landmarks === 'object').slice(0, 16);
  if (!frames.length) return null;
  return {
    frames,
    aspect: body.aspect,
    // Marked size references, each carrying the time of the frame it was marked
    // on so it can be attached to that frame and no other.
    references: Array.isArray(body.references) ? body.references : [],
    // What the person was wearing, as they told us. A tape read over a hoodie is
    // not a body measurement until the fabric is taken off it.
    clothing: body.clothing && typeof body.clothing === 'object' ? body.clothing : {},
    // The user picks who is being measured. It decides the head-length constant
    // (and so every centimetre), which size chart applies, AND which of the two
    // category groups is computed - so it is never guessed from the silhouette.
    gender: normGender(body.gender),
    model: typeof body.model === 'string' ? body.model.slice(0, 80) : 'on-device pose',
  };
}

/**
 * The store's own size chart, when the scan came from a link that carries one.
 *
 * It arrives as JSON â€” an object on the on-device path, a string on the multipart
 * one â€” and it is only ever used to CHOOSE a size, never to measure anything: a
 * body is measured from the clip, and the chart is the table that body is then
 * laid against. So a chart that cannot be read is not an error and never fails
 * the scan; it just means the built-in chart is used instead, and the result
 * says which one answered.
 */
function readChart(body) {
  const raw = body?.chart;
  if (!raw) return null;
  const input = typeof raw === 'string' ? parseJson(raw) : raw;
  // { rows, columns } â€” the store's numbers, and the columns they typed them
  // under. Which of those columns decides the size is stated by their order.
  const chart = chartFromInput(input);
  if (!chart) return null;
  const sex = input?.sex;
  return {
    chart,
    name: typeof input?.name === 'string' ? input.name.trim().slice(0, 60) : '',
    sex: sex === 'female' || sex === 'male' ? sex : 'unisex',
  };
}

/** Turn the browser's per-frame numbers into the frame objects the engine reads. */
/**
 * A marked object belongs to the frame it was marked on, and nowhere else.
 *
 * A frame's scale is its own â€” the camera moves, the subject steps nearer or
 * further, and a size that was right a moment ago is not right now. So each
 * reference goes to its nearest sampled frame (measured in the frame's own time)
 * and no other.
 */
function assignReferences(geoFrames, refs) {
  const out = geoFrames.map(() => []);
  if (!Array.isArray(refs) || !refs.length) return out;
  for (const r of refs.slice(0, 4)) {
    const rt = Number(r?.t);
    if (!Number.isFinite(rt)) continue;
    let best = -1;
    let bestGap = Infinity;
    geoFrames.forEach((f, i) => {
      const gap = Math.abs(Number(f?.t) - rt);
      if (Number.isFinite(gap) && gap < bestGap) { bestGap = gap; best = i; }
    });
    if (best >= 0) out[best].push(r);
  }
  return out;
}

/**
 * Score each frame's sharpness and lighting from what the device measured.
 *
 * Sharpness is scored RELATIVE to the sharpest frames of the same clip: an
 * absolute threshold would punish a whole clip for being soft, when the only
 * thing that matters for averaging frames together is which of them are the
 * blurriest. Lighting is absolute, because a frame that is blown out or pitch
 * dark is worth less wherever it came from.
 */
function scoreCamera(frames) {
  const vars = frames
    .map((f) => Number(f.cameraRaw?.lapVar))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const p90 = vars.length ? vars[Math.min(vars.length - 1, Math.floor(vars.length * 0.9))] : null;
  for (const f of frames) {
    const lap = Number(f.cameraRaw?.lapVar);
    const luma = Number(f.cameraRaw?.luma);
    const clipped = Number(f.cameraRaw?.clipped);
    const sharpness = Number.isFinite(lap) && p90
      ? clamp(0.2 + 0.8 * Math.min(1, lap / p90), [0.05, 1])
      : 0.75;
    const exposure = Number.isFinite(luma) ? clamp(1 - Math.abs(luma - 128) / 110, [0, 1]) : 0.75;
    const clip = Number.isFinite(clipped) ? clamp(1 - clipped * 6, [0, 1]) : 1;
    f.camera = {
      sharpness: round2(sharpness),
      lighting: round2(0.5 * exposure + 0.5 * clip),
      lapVar: Number.isFinite(lap) ? Math.round(lap) : null,
      luma: Number.isFinite(luma) ? Math.round(luma) : null,
    };
    delete f.cameraRaw;
  }
}

/**
 * Let one marked object set the scale for the whole clip.
 *
 * An object marked on one frame, used only on that frame, does almost nothing:
 * the other fifteen frames still hang off an assumed head length. But the head
 * and the object are measured in the SAME frame, at the same distance, so the
 * ratio between the two scale estimates is not a property of how far away the
 * camera was â€” it is a property of the assumed head constant and of how well
 * the head was found in that frame. That ratio applies to every frame of the
 * clip, so one marked bank card corrects fifteen unmarked frames.
 *
 * Bounded, because beyond a modest head error the likelier story is that the
 * object was marked wrong, and then correcting the whole clip with it would be
 * worse than leaving the head ruler alone.
 */
function calibrateScale(frames) {
  let ratio = null;
  let what = null;
  let knownCm = null;
  for (const f of frames) {
    if (!f.scale || !(f.references || []).length) continue;
    const head = f.scale.anchors.find((a) => a.what === 'head length');
    const ref = f.scale.anchors.find((a) => a.what !== 'head length');
    if (!head || !ref || !(head.cmPerWidth > 0) || !(ref.cmPerWidth > 0)) continue;
    ratio = ref.cmPerWidth / head.cmPerWidth;
    what = ref.what;
    knownCm = Number((f.references[0] || {}).knownCm) || null;
    break;
  }
  if (!ratio || ratio < 0.7 || ratio > 1.4) return null;
  let applied = 0;
  for (const f of frames) {
    const head = f.scale?.anchors.find((a) => a.what === 'head length');
    if (!head) continue;
    f.scale = { ...f.scale, cmPerWidth: head.cmPerWidth * ratio, referenceRatio: round3(ratio) };
    // Breadths are judged in centimetres, so they are judged again against the
    // new scale rather than the one they were first checked with.
    const check = checkFrame(f);
    f.bad = check.bad;
    f.heightBad = check.heightBad;
    applied += 1;
  }
  return applied ? { ratio: round3(ratio), what, knownCm, applied } : null;
}

function addGeometryFrames(geo, aspect, frames, rejected, gender, refByFrame = []) {
  geo.frames.forEach((raw, i) => {
    const frame = {
      file: `pose-${i + 1}`,
      view: normView(raw.view),
      gender: gender !== 'unsure' ? gender : normGender(raw.gender),
      genderConfidence: 0,
      build: null,
      landmarks: normalizeLandmarks(raw.landmarks),
      visible: raw.visible && typeof raw.visible === 'object' ? raw.visible : {},
      references: Array.isArray(refByFrame[i]) ? refByFrame[i] : [],
      // What the person was wearing, on every frame: the fabric is over the whole
      // body all the way round, so it is not a per-frame property.
      clothing: geo.clothing && typeof geo.clothing === 'object' ? geo.clothing : {},
      // Sharpness and lighting as the device actually measured them: the raw
      // Laplacian variance and mean luma. scoreCamera() turns them into weights,
      // scoring sharpness against the other frames of the same clip.
      cameraRaw: raw.camera && typeof raw.camera === 'object' ? raw.camera : null,
      camera: { sharpness: 0.75, lighting: 0.75 },
      confidence: clamp(Number(raw.confidence) || 0.6, [0.05, 1]),
      aspect,
      // How far the body was turned in this frame, in degrees. It decides how
      // much of the span is width and how much is depth: 0 is square on, 90 a
      // profile. Without it a three-quarter frame's span would be read as a
      // width, which reads up to a quarter too wide.
      turn: Number.isFinite(Number(raw.turn)) ? clamp(Number(raw.turn), [0, 90]) : undefined,
      // Regions the device could see but not measure (arms merged with the
      // torso). Carried through so the notes can explain a blank honestly.
      unmeasured: Array.isArray(raw.unmeasured) ? raw.unmeasured.slice(0, 4) : [],
    };
    // An unseen floor is an invented one, exactly as for the vision path.
    if (frame.visible.legs === false || frame.visible.feet === false) {
      for (const k of ['footL', 'footR', 'crotch']) delete frame.landmarks[k];
      frame.floorInvented = true;
    }
    dropEdgeFeet(frame);
    frame.scale = frameScale(frame);
    const check = checkFrame(frame);
    if (check.fatal) {
      rejected.push(frameDigest(frame, check.notes.join(', ') || 'implausible landmarks'));
      log(`  frame ${i + 1}/${geo.frames.length} REJECTED - ${check.notes.join(', ')}`);
      return;
    }
    frame.bad = check.bad;
    frame.heightBad = check.heightBad;
    frames.push(frame);
    const scale = frame.scale ? `${round2(frame.scale.cmPerWidth)} cm/width (reliability ${round2(frame.scale.reliability)})` : 'NONE';
    log(`  frame ${i + 1}/${geo.frames.length} ok - view=${frame.view} landmarks=${Object.keys(frame.landmarks).length} scale=${scale}${check.bad.size ? ` dropped-regions=${[...check.bad].join(',')}` : ''}`);
  });
}

bodyScan.post('/', upload.fields([{ name: 'frames', maxCount: 16 }, { name: 'video', maxCount: 1 }]), ah(async (req, res) => {
  const startedAt = Date.now();

  // Whatever the upload was â€” a clip, a dozen stills, or both â€” the files on
  // this disk are deleted the moment the answer is on its way. Nobody's body
  // stays on a server because a response was slow or a frame was discarded.
  const uploaded = Object.values(req.files || {}).flat().filter(Boolean).map((f) => f.path).filter(Boolean);
  if (uploaded.length) {
    const clean = () => { for (const p of uploaded) unlink(p).catch(() => {}); };
    res.on('finish', clean);
    res.on('close', clean);
  }

  const geo = geometryFrames(req.body);
  // A store's own chart, if the scan came in through a link that carries one.
  const brand = readChart(req.body);
  const frames = [];
  const failures = [];
  const rejected = [];
  const unreadable = [];
  // What the clip itself turned out to be: its real length, the span actually
  // read, how many seeks landed. Returned in `diagnostics`, so a short or slow
  // scan can be explained without a log we cannot read from here.
  const clipInfo = {};
  // Where the seconds went. Upload happens before this handler runs, extraction
  // is ffmpeg, and everything else is the vision model - and on a free instance
  // those are three very different numbers.
  let decodeMs = 0;

  // Frames arrive three ways: taken out of the uploaded clip by ffmpeg, measured
  // on the device, or as JPEGs for the vision model. All three end in the same
  // deterministic measurement engine.
  if (geo) {
    const aspect = clamp(Number(geo.aspect) || 0.75, [0.3, 3]);
    log(`> POST received - ${geo.frames.length} on-device frame(s) from ${geo.model}, aspect=${round2(aspect)}, measuring for=${geo.gender}`);
    if (brand) log(`  sizing against the store's own chart${brand.name ? ` "${brand.name}"` : ''} (${Object.keys(brand.chart.rows).length} size(s), for ${brand.sex})`);
    const refByFrame = assignReferences(geo.frames, geo.references);
    const withRefs = refByFrame.filter((r) => r.length).length;
    if (withRefs) log(`  ${withRefs} frame(s) carry a user-marked size reference`);
    addGeometryFrames(geo, aspect, frames, rejected, geo.gender, refByFrame);
    scoreCamera(frames);
    const calibrated = calibrateScale(frames);
    if (calibrated) {
      log(`  scale set from ${calibrated.what} across ${calibrated.applied} frame(s): head ruler x${calibrated.ratio}`);
    }
    return finishScan(res, {
      frames,
      rejected,
      unreadable,
      failures,
      aspect,
      attempted: geo.frames.length,
      totalBytes: 0,
      sourceModel: `on-device pose (${geo.model})`,
      poseNotes: [...new Set(geo.frames.flatMap((f) => (Array.isArray(f.notes) ? f.notes : [])))],
      gender: geo.gender,
      chart: brand?.chart || null,
      chartName: brand?.name || '',
      chartSex: brand?.chart?.sex || null,
      startedAt,
    });
  }

  if (!visionConfigured()) {
    throw new HttpError(503, config.vision.provider === 'mistral'
      ? 'Body scan is not configured (set MISTRAL_API_KEY)'
      : 'Body scan is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)');
  }

  const received = req.files || {};
  const clip = (received.video || [])[0] || null;
  let files = received.frames || [];

  // The clip itself: the server takes the stills out of it, so the phone did no
  // decoding or seeking at all. This is the default path.
  if (clip) {
    const from = Math.max(0, Number(req.body?.from) || 0);
    const wanted = Number(req.body?.to);
    const to = Number.isFinite(wanted) && wanted > from ? wanted : from + 30;
    log(`> POST received - clip ${(clip.size / 1048576).toFixed(1)} MB, ${round2(Math.min(30, to - from))}s from ${round2(from)}s`);
    try {
      // How many angles to read. The app asks for the full set; a smaller number
      // is a legitimate way to trade precision for time (and for the metered
      // reading budget), and the sanity checks below refuse a body measured from
      // too little rather than pretend.
      const count = Math.min(MAX_FRAMES, Math.max(1, Math.round(Number(req.body?.count) || MAX_FRAMES)));
      files = await framesFromVideo(clip.path, { from, to, count, info: clipInfo });
      decodeMs = Date.now() - startedAt;
      log(`  ${files.length} still(s) taken out of the clip (${Date.now() - startedAt}ms)`);
    } catch (e) {
      throw new HttpError(422, `Could not read that video (${e.message})`);
    }
    if (!files.length) throw new HttpError(422, 'Could not read any picture out of that video');
  }

  if (!files || files.length === 0) throw new HttpError(400, 'Upload a clip or at least one frame');

  // Uploads are on disk (a clip is tens of megabytes); the vision call wants the
  // bytes. Read the stills in â€” they are small â€” and leave the clip to ffmpeg.
  files = await Promise.all(files.map(async (f) => (f.buffer
    ? f
    : { buffer: await readFile(f.path), size: f.size, originalname: f.originalname, mimetype: f.mimetype })));

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  // The form's gender field is the user's own choice and wins over the model's
  // guess; the guess is only used when nobody said.
  const chosenGender = normGender(req.body?.gender);

  // The frame's true aspect ratio decides how a vertical normed distance (y is
  // normalised by height) converts into the same unit as a horizontal one. Read
  // it straight out of the JPEG so the client cannot get it wrong.
  const jpeg = jpegSize(files[0].buffer);
  const aspect = jpeg
    ? jpeg.width / jpeg.height
    : clamp(Number(req.body?.aspect) || 0.75, [0.3, 3]);

  log(`> POST received - ${files.length} frame(s), ${(totalBytes / 1024).toFixed(0)} KB, aspect=${round2(aspect)}, provider=${config.vision.provider}, model=${visionModelName()}`);
  if (brand) log(`  sizing against the store's own chart${brand.name ? ` "${brand.name}"` : ''} (${Object.keys(brand.chart.rows).length} size(s), for ${brand.sex})`);

  await mapLimit(files, config.vision.concurrency, async (file, i) => {
    const frameStart = Date.now();
    try {
      // The same frame, read again. One pass places a shoulder once and is stuck
      // with it; three reads agree on most points and let the median throw out
      // the one that wandered. The first read is the careful one; the repeats run
      // warmer so the model looks afresh instead of echoing itself.
      const wanted = Math.max(1, config.vision.reads);
      const answers = await Promise.all(Array.from({ length: wanted }, (_, r) => callVision(
        file.buffer.toString('base64'),
        FRAME_PROMPT,
        { maxTokens: 2600, json: true, temperature: r === 0 ? 0.1 : 0.5 },
      ).then((v) => ({ ...v, parsed: parseJson(v.text) })).catch((e) => ({ error: e }))));

      const usable = answers.filter((a) => a.parsed && a.parsed.personVisible !== false);
      const failed = answers.filter((a) => a.error);
      const first = (usable[0] || answers[0] || {});
      const raw = first.text || '';
      const meta = first.meta || {};
      const ms = Date.now() - frameStart;
      const parsed = usable.length ? mergeReads(usable.map((a) => a.parsed)) : null;
      if (!parsed && failed.length) throw failed[0].error;
      if (parsed) {
        const frame = {
          file: file.originalname,
          view: normView(parsed.view),
          // How far the body is turned, when the model gave one. A clip is a
          // person TURNING, so a frame called "front" can be 30 degrees off, and
          // every width read off it is short by cos(30) = 13%. Without a number
          // here the turn could only be inferred from the view label, which is
          // exactly the thing that was wrong.
          turn: (parsed.turn != null && Number.isFinite(Number(parsed.turn)))
            ? clamp(Number(parsed.turn), [0, 90])
            : undefined,
          gender: chosenGender !== 'unsure' ? chosenGender : normGender(parsed.gender),
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
        // A frame that says the legs are not in shot cannot honestly show the
        // feet either. Believe the flag and drop the floor landmarks: an
        // invented floor point would both fake a height and bend the scale.
        if (frame.visible.legs === false || frame.visible.feet === false) {
          for (const k of ['footL', 'footR', 'crotch']) delete frame.landmarks[k];
          frame.floorInvented = true;
        }
        dropEdgeFeet(frame);

        frame.scale = frameScale(frame);
        frame.ms = ms;
        frame.usage = meta.usage;

        // A frame whose landmarks are not a human shape is thrown away whole.
        // Confident nonsense is worse than no measurement.
        const check = checkFrame(frame);
        if (check.fatal) {
          rejected.push(frameDigest(frame, check.notes.join(', ') || 'implausible landmarks'));
          log(`  frame ${i + 1}/${files.length} REJECTED (${ms}ms) - ${check.notes.join(', ')}`);
          return;
        }
        frame.bad = check.bad;
        frame.heightBad = check.heightBad;

        frames.push(frame);
        const keys = Object.keys(frame.landmarks);
        log(`  frame ${i + 1}/${files.length} ok (${ms}ms, reads ${usable.length}/${wanted}) - view=${frame.view} gender=${frame.gender} conf=${frame.confidence} landmarks=${keys.length} scale=${frame.scale ? round2(frame.scale.cmPerWidth) + ' cm/width (reliability ' + round2(frame.scale.reliability) + ')' : 'NONE'}${check.bad.size ? ' dropped-regions=' + [...check.bad].join(',') : ''}`);
      } else {
        unreadable.push({ file: file.originalname, reply: String(raw).slice(0, 400), ms, ...meta });
        log(`  frame ${i + 1}/${files.length} skipped (${ms}ms) - ${parsed ? 'no person visible' : 'unreadable reply'} finish=${meta.finish} tokens=${meta.usage?.completion_tokens ?? '?'}`);
      }
    } catch (e) {
      failures.push({ file: file.originalname, error: e.message, debug: e.debug || null });
      log(`  frame ${i + 1}/${files.length} FAILED (${Date.now() - frameStart}ms) - ${e.message}${e.debug ? ` :: ${JSON.stringify(e.debug)}` : ''}`);
    }
  });

  log(`  all frames done in ${Date.now() - startedAt}ms (${frames.length} usable, ${rejected.length} rejected as implausible, ${failures.length} failed)`);

  // The calculation step. Mistral saw the frames; Cloudflare now turns those
  // readings into one consistent body. If Workers AI is unreachable the scan
  // still measures — from the points as they came in.
  let calc = null;
  let calcMeta = null;
  if (config.vision.provider === 'mistral' && config.vision.reconcile
      && frames.length && config.cloudflare.accountId && config.cloudflare.apiToken) {
    const t0 = Date.now();
    try {
      const reck = await reconcileWithCloudflare(frames, String(req.query.calcModel || ''));
      calcMeta = reck ? { attempts: reck.attempts, waitedMs: reck.waited, error: reck.error } : null;
      if (reck && reck.calc) {
        calc = reck.calc;
        log(`  Cloudflare reconciled ${frames.length} frame(s) in ${Date.now() - t0}ms (${reck.attempts} attempt(s)) - ${reck.relabelled} view(s) corrected; said ${JSON.stringify(reck.calc)}`);
        if (reck.notes.length) log(`  notes: ${reck.notes.join(' | ')}`);
      } else {
        log(`  Cloudflare returned no usable reconciliation after ${Date.now() - t0}ms${reck ? ` / ${reck.attempts} attempt(s): ${reck.error}` : ''} - measuring from the raw points`);
      }
    } catch (e) {
      log(`!! Cloudflare could not reconcile (${Date.now() - t0}ms): ${e.message} - measuring from the raw points`);
    }
  }

  return finishScan(res, {
    frames,
    rejected,
    unreadable,
    failures,
    aspect,
    attempted: files.length,
    totalBytes,
    sourceModel: servedBy === 'cloudflare' && config.vision.provider === 'mistral'
      ? `${config.cloudflare.visionModel} (fallback)`
      : visionModelName(),
    poseNotes: [],
    clip: clipInfo,
    timing: { decodeMs, visionMs: Date.now() - startedAt - decodeMs, totalMs: Date.now() - startedAt },
    gender: chosenGender,
    chart: brand?.chart || null,
    chartName: brand?.name || '',
    chartSex: brand?.chart?.sex || null,
    calc,
    calcMeta,
    startedAt,
  });
}));

/**
 * Everything both entry points share: refuse frames that cannot be a body, agree
 * on one scale across the turn, measure each region from landmark geometry, and
 * pick a size. Nothing here knows or cares which path produced the frames.
 */
function finishScan(res, { frames, rejected, unreadable, failures, clip = null, timing = null, aspect, attempted, totalBytes, sourceModel, poseNotes, gender: chosenGender, chart = null, chartName = '', chartSex = null, calc = null, calcMeta = null, startedAt }) {
  if (frames.length === 0) {
    log(`x no usable frames after ${Date.now() - startedAt}ms (${rejected.length} rejected, ${failures.length} failed)`);
    const details = { diagnostics: { model: sourceModel, clip, timing, rejected, unreadable, failures } };
    if (failures.length === attempted) {
      // When every frame failed for the same shopper-facing reason â€” the daily
      // allowance is spent, the key was rejected â€” that reason is the answer.
      // "The vision service rejected every frame" is our plumbing, not theirs.
      const reasons = [...new Set(failures.map((f) => f.error))];
      const own = reasons.every((r) => /^The measuring service/.test(r));
      if (own && reasons.length === 1) throw new HttpError(502, reasons[0], details, { expose: true });
      throw new HttpError(502, `The vision service rejected every frame. First error: ${failures[0].error}`, details, { expose: own });
    }
    if (rejected.length) {
      throw new HttpError(422, `The landmarks we read did not describe a human body (${rejected[0].reason}). Film again with the whole person in shot, standing straight and facing the camera.`, details);
    }
    throw new HttpError(422, 'Could not find a person to measure. Make sure the person fills the frame and the lighting is decent.', details);
  }

  /** Everything each frame reported, for a refusal we have to justify. */
  const diagnostics = { model: sourceModel, clip, timing, frames: frames.map((f) => frameDigest(f)), rejected, unreadable, failures };

  // 2. Scale. Without an anchor there are no centimetres, so say so rather than
  //    inventing numbers.
  const scaled = frames.filter((f) => f.scale);
  if (!scaled.length) {
    log('x no frame had a usable scale anchor (no head, no reference object)');
    throw new HttpError(422, 'We could not work out the scale of your video â€” keep your head fully in frame for the whole turn, or include a door or similar in shot, and try again.', { diagnostics });
  }

  const scaleWeight = (f) => frameQuality(f) * (f.scale?.reliability ?? 1);
  const scaleW = scaled.reduce((s, f) => s + scaleWeight(f), 0);
  const cmPerWidth = Math.exp(scaled.reduce((s, f) => s + scaleWeight(f) * Math.log(f.scale.cmPerWidth), 0) / scaleW);
  const anchors = [...new Set(scaled.flatMap((f) => f.scale.anchors.map((a) => a.detail)))];
  // How far the head landmarks had to be nudged onto adult proportions. 1 = no
  // correction; anything else means the head was mis-measured in the frame.
  const headUnitsCorrection = round2(
    scaled.reduce((s, f) => s + scaleWeight(f) * (f.scale.headUnitsCorrection ?? 1), 0) / scaleW,
  );

  // 3. Who is being measured, and what they are wearing. Both are settled first:
  //    the gender group decides which categories exist at all, and the clothing
  //    decides whether a leg opening can be called a trouser bottom.
  //
  //    The user's own answer is the answer. It sets the head constant (and so
  //    every centimetre), the size chart, and which of the two category groups
  //    is computed â€” none of which may be inferred from a silhouette.
  const gender = chosenGender && chosenGender !== 'unsure'
    ? { guess: chosenGender, confidence: 1, chosen: true, scores: {} }
    : { ...pickGender(frames), chosen: false };
  const clothing = combineClothing(frames);
  const clothT = clothing.thicknessIn || 0;
  // A layer of fabric wraps the WHOLE way round, and offsetting any closed curve
  // outward by a thickness t lengthens it by exactly 2*pi*t, whatever its shape â€”
  // so that is what comes off a girth. This used to be 2*t, which left two thirds
  // of a hoodie in the number. A flat width is different: across the shoulders
  // the fabric only adds its own thickness per side, so 2*t.
  const removed = 2 * Math.PI * clothT;
  const removedWidth = 2 * clothT;
  // The lower garment is a separate thickness over separate rows. If nothing was
  // said about it, nothing comes off the hips â€” better a slightly padded hip than
  // a jumper's fabric subtracted from a trouser measurement.
  const clothB = clothing.lowerThicknessIn || 0;
  const removedLower = 2 * Math.PI * clothB;

  // 4. Measure every region from the landmark geometry.
  const measured = {};
  const methods = {};
  const dropped = [];
  const outOfRange = [];
  const rejectedEverywhere = [];
  const droppedByCheck = new Set();
  for (const key of Object.keys(REGIONS)) {
    const r = measureRegion(key, frames, { depthRatio: depthRatioFor(key, gender.guess), gender: gender.guess });
    if (!r) {
      dropped.push(key);
      // Distinguish "never seen" from "seen but not humanly possible".
      if (sawRegion(frames, key)) rejectedEverywhere.push(REGIONS[key].label);
      continue;
    }
    if (r.skipped) droppedByCheck.add(REGIONS[key].label);
    // The core girths have hand-written plausibility ranges; everything else is
    // already bounded by the span ranges the frame check applied.
    //
    // A reading outside its range is NOT this measurement, so it is dropped
    // rather than pulled to the nearest edge. The edge is a number nobody
    // measured, and it reads back on the panel exactly like one that was: a 12"
    // shoulder used to be reported as "14", the floor of the range, which is a
    // confident wrong answer where "could not be read" is the true one.
    const range = RANGES[key];
    if (range && (r.valueIn < range[0] || r.valueIn > range[1])) {
      dropped.push(key);
      outOfRange.push(REGIONS[key].label.toLowerCase());
      continue;
    }
    r.clamped = false;
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
        ? "ANSUR II's own fitted tape on the width and depth, after undoing this frame's turn"
        : "the shoulder span, undone by this frame's turn",
      confidence: r.confidence,
      clamped: r.clamped,
    };
  }

  // Cloudflare's calculation stands where geometry could not produce a reading.
  // It is not allowed to overrule a number that was actually measured from the
  // corrected points — only to fill the gap where a region was dropped.
  const fromCalc = [];
  if (calc) {
    for (const [k, v] of Object.entries(calc)) {
      if (!REGIONS[k]) continue;
      const had = Boolean(measured[k]);
      measured[k] = {
        ...(measured[k] || {}),
        label: REGIONS[k].label,
        valueIn: v,
        widthIn: measured[k]?.widthIn ?? null,
        depthIn: measured[k]?.depthIn ?? null,
        girth: Boolean(REGIONS[k].girth),
        confidence: Math.max(0.6, measured[k]?.confidence ?? 0),
        source: 'cloudflare',
      };
      if (!had) fromCalc.push(k);
    }
  }
  if (calc) diagnostics.calc = { filledByCloudflare: fromCalc, cloudflareSaid: calc };
  if (calcMeta) diagnostics.calcAttempts = calcMeta;

  // 5. The catalogue: every category a tailor's sheet asks for that this video
  //    actually shows, in the group for the gender chosen. Anything the clip
  //    never showed simply is not in here â€” nothing is estimated, and nothing
  //    absent is mentioned.
  const catalogue = buildCatalogue({ frames, gender: gender.guess, clothing, calc });

  // Nothing believable came out: refuse rather than print a made-up size.
  if (!catalogue.items.length) {
    log('x no measurement survived the sanity check');
    // Counts and reasons only. This line used to carry the whole diagnostics
    // object, landmarks included, which put a person's body geometry into a
    // retained server log â€” the one place it is not supposed to be. The same
    // detail is in the response, where it belongs and where it is discarded.
    log(`  ${frames.length} frames, ${rejected.length} rejected, ${failures.length} failed, ${unreadable.length} unreadable; reasons=${JSON.stringify([...new Set(rejected.map((r) => r.reason).filter(Boolean))])}`);
    throw new HttpError(422, 'We could read your video but the measurements did not add up to a human body. Stand straight, face the camera with your arms clear of your sides, and keep your whole body in frame.', { diagnostics });
  }

  // 6. Height: head to floor, only from frames where the feet were actually visible.
  const h = measureHeight(frames);
  // No floor contact, no height — even if the calculation step offered one. The
  // clip ending at the shins is not a person 65 inches tall.
  const heightIn = h ? clamp(h.in, RANGES.height) : null;
  const headUnitsToHeight = h
    ? round1(h.in * CM_PER_IN / (HEAD_HEIGHT_CM[scaled[0].gender] || HEAD_HEIGHT_CM.unsure))
    : null;

  // 7. Proportions, computed from the same geometry.
  const shoulderToHip = measured.shoulder?.widthIn && measured.hips?.widthIn ? round2(measured.shoulder.widthIn / measured.hips.widthIn) : null;
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

  // 8. As seen over the clothes, then minus the clothing width.
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
  // Taking the fabric off can, at the extreme, push a reading under the floor of
  // what a body can be. A number that only exists because it was pulled back up
  // to the floor is a number nobody measured, so it goes null instead.
  const afterCloth = (v, range) => {
    if (v == null) return null;
    const out = round1(v);
    return out < range[0] || out > range[1] ? null : out;
  };
  const adjusted = {
    chest: afterCloth(seen.chest == null ? null : seen.chest - removed, RANGES.chest),
    waist: afterCloth(seen.waist == null ? null : seen.waist - removed, RANGES.waist),
    hips: afterCloth(seen.hips == null ? null : seen.hips - removedLower, RANGES.hips),
    shoulder: afterCloth(seen.shoulder == null ? null : seen.shoulder - removedWidth, RANGES.shoulder),
    neck: seen.neck,
    arm: seen.arm,
    height: seen.height,
    bodyWidthRemovedIn: round1(removed),
    bodyWidthRemovedLowerIn: round1(removedLower),
  };

  // 8. Size.
  //
  // Two tables can answer this, in order of who the size is actually for:
  //
  //   1. the store's own chart, when the scan came from a link that carries one.
  //      The shopper is buying that garment, so the store's row for it is the
  //      only answer that matters â€” and it is scored by exactly the same rule as
  //      everything else, so a chart typed badly is a chart that fits badly.
  //   2. the built-in sheets. Nobody is asked which one, so both are scored
  //      against the body and the one that disagrees least with it wins â€” and
  //      the result says in so many words that that is how it was chosen.
  //
  // A store's chart carries its own sex when the store set one; when it does not
  // (a unisex chart) the sheet still has to be decided, because a chart that
  // names a bust and a chart that names a chest are not the same table.
  let sheet = gender.guess === 'male' || gender.guess === 'female' ? gender.guess : null;
  let bySheet = null;
  if (!sheet && adjusted.chest != null) {
    const m = bestSize('male', adjusted);
    const f = bestSize('female', adjusted);
    if (m || f) {
      if (!m || !f) {
        bySheet = m || f;
        sheet = m ? 'male' : 'female';
      } else {
        bySheet = m.diff <= f.diff ? m : f;
        sheet = bySheet === m ? 'male' : 'female';
      }
    }
  }

  let size = null;
  let sizeBasis = null;
  let sizeSource = null;
  if (chart) {
    size = bestSize(sheet || 'male', adjusted, chart.rows, chart.columns);
    if (size) {
      sizeSource = 'store';
      // The sheet basis is reported as the shopper's own answer, or not at all:
      // the chart decided the column, not the sheet.
      sizeBasis = sheet === gender.guess ? sheet : null;
    }
  } else if (bySheet) {
    size = bySheet;
    sizeBasis = sheet;
    sizeSource = 'reference';
  } else if (sheet) {
    size = bestSize(sheet, adjusted);
    if (size) {
      sizeBasis = sheet;
      sizeSource = 'reference';
    }
  }

  // Why a size is missing, named properly.
  //
  // The refusal a shopper meets most is a clip that WAS square on, whose deciding
  // number was refused. Saying "this clip did not show a straight-on front view
  // with the arms clear of the sides" when the front view was fine and the chest
  // was what failed is not a hedge, it is a wrong explanation - and it sends the
  // shopper off to re-shoot a video that was never the problem. So the reason is
  // derived from what is actually absent.
  const decidingColumn = (() => {
    if (chart) {
      const cols = chart.columns?.length ? chart.columns : columnsFromRows(chart.rows);
      const col = cols.find((c) => measureField(c.measure));
      return col ? { field: measureField(col.measure), label: col.label } : null;
    }
    const key = chartKey(CHARTS[sheet || 'male']) || 'chest';
    return { field: measureField(key) || 'chest', label: key === 'bust' ? 'bust' : key };
  })();
  const sizeMissingReason = size ? null : (() => {
    const square = frames.filter((f) => f.view === 'front' || f.view === 'back').length;
    if (!square) return 'the clip never showed you square on to the camera, front or back.';
    if (decidingColumn && adjusted[decidingColumn.field] == null) {
      const word = decidingColumn.field === 'arm' ? 'upper arm' : decidingColumn.field;
      const framesWord = frames.length === 1 ? 'this frame' : `these ${frames.length} frames`;
      return `your ${word} is the number this ${chartName ? 'garment' : 'size'} is decided on, and it could not be read from ${framesWord}.`;
    }
    return 'the numbers this size is laid against could not be read from the clip.';
  })();

  // 9. Notes. Only ever about what WAS measured, or about the video itself.
  //    A category the clip did not contain is simply absent from the list
  //    above â€” announcing the blank would suggest we had an opinion about it.
  const notes = [];
  // Caveats the on-device measurement raised itself (arms not clear, feet out of
  // shot). They come first because they explain everything below them.
  for (const n of poseNotes) notes.push(n);
  const poseGaps = new Set(frames.flatMap((f) => (Array.isArray(f.unmeasured) ? f.unmeasured : [])));
  if (poseGaps.has('torso') && !measured.chest && !measured.waist && !measured.hips) {
    notes.push('Your arms were not clear of your sides in any frame, so the tape could not pass around your body.');
  }
  if (poseGaps.has('arm') && !measured.arm) {
    notes.push('Your arm was not held clear of your body in any frame, so no tape could be taken around a limb.');
  }
  if (rejectedEverywhere.length || droppedByCheck.size) {
    notes.push('One reading came out impossible for a human body in every frame that showed it, so it was left out rather than guessed.');
  }
  if (outOfRange.length) {
    notes.push(`A reading came back outside what a human body can be (${outOfRange.join(', ')}), so it was left out rather than pulled to the edge of the range.`);
  }
  if (heightIn == null && (measured.chest || measured.waist || measured.hips)) {
    notes.push('Your feet were not in shot, so nothing that needs the floor could be read.');
  }
  if (headUnitsCorrection && Math.abs(headUnitsCorrection - 1) > 0.02) {
    const pct = Math.round(Math.abs(headUnitsCorrection - 1) * 100);
    notes.push(`Your proportions read as an unusual head-to-body ratio, so the scale was corrected by ${pct}%.`);
  }
  if (clothing.items.length || clothing.fit) {
    // Say exactly what was taken off and from where: a number the user can check
    // against their own tape is worth more than a silent "adjusted".
    const clothBits = [];
    if (removed > 0.05) clothBits.push(`${round1(removed)} in off each top girth and ${round1(removedWidth)} in off the shoulder line`);
    if (removedLower > 0.05) clothBits.push(`${round1(removedLower)} in off the hip and leg girths`);
    notes.push(
      `Clothing${clothing.items.length ? ` (${clothing.items.join(', ')})` : ''}` +
      `${clothing.density ? ` Â· ${clothing.density} density` : ''}` +
      `${clothing.fit ? ` Â· ${clothing.fit} fit` : ''}` +
      `${clothBits.length ? ` â€” ${clothBits.join(', and ')} for the fabric` : ''}.`
    );
  }
  if (clothing.note) notes.push(clothing.note);
  // If the user marked something of a known size, say so: it is the difference
  // between a scale that was assumed and a scale that was measured.
  const marked = frames.map((f) => (f.references || [])[0]).find(Boolean);
  if (marked) {
    const applied = frames.filter((f) => f.scale?.referenceRatio).length;
    notes.push(applied
      ? `Your scale came from ${marked.what} (${marked.knownCm} cm) that you marked, applied across ${applied} frame${applied === 1 ? '' : 's'} â€” so the numbers are set against a known size rather than an assumed head length.`
      : `You marked ${marked.what}, but the frame it was on had no usable head, so the scale stayed on the head ruler.`);
  }
  if (gender.chosen) {
    const sheet = gender.guess === 'female' ? "women's" : "men's";
    notes.push(chartSex
      ? `This store's chart is cut for ${sheet} sizes, so the measurements were read against the ${sheet} sheet.`
      : `Read against the ${sheet} measurement sheet.`);
  } else if (gender.guess === 'unsure') {
    notes.push('You did not say who this video was for, so the size was picked from the body proportions alone.');
  }
  // How much of the clip actually turned side-on. Two notes below talk about it â€”
  // the size hedge and the modelled-depth disclosure â€” and telling the viewer
  // "no frame turned far enough" in one while the other counts seven that did is
  // the kind of contradiction that makes both of them worthless.
  const profiled = frames.filter((f) => frameTurn(f) >= 70).length;
  const turned = frames.filter((f) => frameTurn(f) >= 20 && frameTurn(f) < 70).length;

  if (size && Number.isFinite(adjusted[size.field])) {
    const d = adjusted[size.field] - size.row[size.key];
    const at = String(size.label || 'chest').toLowerCase();
    if (d > 1.5) notes.push(`Size ${size.sizeKey} may be snug at the ${at}.`);
    else if (d < -2) notes.push(`Size ${size.sizeKey} may be loose at the ${at}.`);
    // Whose table the size came off. A shopper on a store's link is being handed
    // that store's numbers and should be told so, rather than left to assume a
    // standard chart answered.
    if (sizeSource === 'store') {
      notes.push(chartName
        ? `This size is off ${chartName}\u2019s own chart, not a standard one.`
        : 'This size is off the store\u2019s own chart, not a standard one.');
    }
    // The size is picked off one girth. If that girth's front-to-back depth had
    // to be modelled rather than seen from the side, the size can honestly sit a
    // size either way â€” and saying so is better than sounding certain. Only the
    // torso girth has a depth model; a chart decided on a waist or a shoulder is
    // not hedged by something that never applied to it.
    if (size.field === 'chest' && measured.chest && !measured.chest.depthMeasured) {
      const v = measured.chest.widthViews;
      const why = profiled || turned
        ? 'the frames that did turn were not clear enough to read it from'
        : 'no frame turned far enough to show body depth';
      notes.push(`Size ${size.sizeKey} is read from your front width alone${v === 1 ? ', off a single frame' : `, across ${v} frames`} â€” ${why} â€” so it could sit one size either way.`);
    }
  } else {
    notes.push(chartName
      ? `No size is given for ${chartName}: ${sizeMissingReason}`
      : `No size was given: ${sizeMissingReason}`);
  }
  if (frames.length < 3) notes.push(`Only ${frames.length} usable frame${frames.length === 1 ? '' : 's'} came out of the video.`);
  if (h && h.views > 1 && h.spread > 3) {
    notes.push(`Your height read ${Math.round(h.spread)} in apart between frames, so it is the least certain number here.`);
  }
  if (Object.values(measured).some((m) => !m.depthMeasured && m.girth)) {
    notes.push(profiled || turned
      ? `The frames turned far enough to show body depth (${profiled} in profile, ${turned} at three-quarter) were not clear enough to read it from, so it was modelled from your front width instead.`
      : 'No frame was turned far enough to show body depth, so it was modelled from your front width rather than measured.');
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
      scale: { cmPerImageWidth: round2(cmPerWidth), anchors, headUnitsCorrection },
      methods,
      height: heightIn != null
        ? { in: round1(heightIn), headUnits: headUnitsToHeight, views: h.views || 0, spread: round2(h.spread ?? 0) }
        : null,
      // What WAS measured, by name. What was not is not listed anywhere: an
      // absent category is absent, never announced.
      measured: Object.keys(measured),
      frames: frames.map((f) => ({
        view: f.view,
        landmarks: Object.keys(f.landmarks).length,
        scaleCmPerWidth: f.scale ? round2(f.scale.cmPerWidth) : null,
      })),
    },
    size: size?.sizeKey || null,
    sizeChart: size?.row || null,
    sizeBasis: size ? sizeBasis : null,
    // Whose chart answered: 'store' (the one carried in the link, which is the
    // garment actually being bought) or 'reference' (ours). null = no size.
    sizeSource,
    // The garment the store named, so the shopper is told what the size is for.
    sizeName: sizeSource === 'store' ? (chartName || null) : null,
    // The catalogue: every category the video actually showed, in the group for
    // the gender chosen. This is the list the user is shown, and it is the whole
    // list â€” nothing absent is listed, and nothing listed is an estimate.
    catalogue,
    notes,
    views: frames.map((f) => f.view),
    frameCount: frames.length,
    reconciled: frames.length > 1 && catalogue.items.length > 0,
    createdAt: new Date().toISOString(),
  };
  if (failures.length) result.frameFailures = failures;
  if (rejected.length) result.frameRejected = rejected;

  result.debug = {
    elapsedMs: Date.now() - startedAt,
    framesReceived: attempted,
    framesUsed: frames.length,
    framesRejected: rejected.length,
    totalBytes,
    aspect: round2(aspect),
    cmPerImageWidth: round2(cmPerWidth),
    anchors,
    reconciled: result.reconciled,
    // How many sizes the store's chart offered, when one was in the request.
    storeChartRows: chart ? Object.keys(chart.rows).length : 0,
    storeChartColumns: chart ? chart.columns.map((c) => c.measure || c.label) : [],
    diagnostics,
  };

  // No measurements in the log â€” not the girths, not the scale, not the anchors.
  // A retained log is still a saved reading, and the promise is that there is
  // nothing to keep. Timing and provenance are enough to debug the pipeline.
  log(`done in ${result.debug.elapsedMs}ms - basis=${sizeBasis} source=${sizeSource} rows=${catalogue.items.length}`);

  res.json(result);
}

