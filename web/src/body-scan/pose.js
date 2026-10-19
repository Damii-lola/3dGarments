/**
 * On-device body measurement: a pose landmarker and a person segmentation mask
 * run in the browser, and the numbers are read off what the mask actually covers.
 *
 * This replaces asking a vision model to place landmarks from memory. The model
 * was never able to say "I cannot see your feet" in a way that could be trusted;
 * this one attaches a visibility score to every joint and a pixel mask of the
 * person, so an unseen limb is reported as unseen rather than guessed.
 *
 * It also removes the round trip: no API key, no queue, no timeout, and the clip
 * never leaves the device before it is a handful of numbers.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { measureSilhouette } from './silhouette.js';
import { drawMeasuredFrame } from './overlay.js';
import { withVideo, resolveDuration, seek } from './frames.js';

const TASKS_VERSION = '0.10.21';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS = {
  full: `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  lite: `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};
/**
 * Which model to try, in order. The full model on a GPU is the good case; the
 * full model on a CPU is the one that turns a scan into a two-minute wait — a
 * phone's CPU runs it at seconds per frame. So a device without a usable GPU
 * gets the lite weights (5.5 MB, several times faster, and its silhouette is
 * within a pixel of the full one), never full-on-CPU.
 */
const CANDIDATES = [
  ['full', 'GPU'],
  ['lite', 'GPU'],
  ['lite', 'CPU'],
];

const log = (...args) => console.log('[3dg:pose]', ...args);

/**
 * How sharp and how well lit this frame really is, read from its own pixels.
 *
 * Sharpness is the variance of the Laplacian — a blurred frame has almost no
 * high-frequency content, so its second derivative is nearly flat. Lighting is
 * the mean luma plus how much of the frame is blown out. Both used to be handed
 * to the engine as a neutral 0.75, which meant a motion-blurred frame weighed
 * exactly as much as a crisp one when the frames were averaged. The raw
 * numbers go up and the server scores them, because sharpness only means
 * anything next to the other frames of the same clip.
 */
function readCameraQuality(ctx, w, h) {
  if (!w || !h) return null;
  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, w, h));
  } catch {
    return null; // a tainted canvas is not worth failing a scan over
  }
  const n = w * h;
  const lum = new Float32Array(n);
  let lit = 0;
  let clipped = 0;
  for (let i = 0; i < n; i += 1) {
    const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = y;
    lit += y;
    if (y > 245) clipped += 1;
  }
  let sum = 0;
  let sumSq = 0;
  let k = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const lap = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w];
      sum += lap;
      sumSq += lap * lap;
      k += 1;
    }
  }
  const mean = k ? sum / k : 0;
  const variance = k ? Math.max(0, sumSq / k - mean * mean) : 0;
  return { lapVar: variance, luma: lit / n, clipped: clipped / n };
}

/** How many frames are kept as pictures — each one costs a JPEG in the page. */
const MAX_SKETCHES = 4;

/** Why a frame gave no torso, in words. */
const VERDICT_WORDS = {
  ok: 'both arms were clear of the torso',
  'one-side': 'one arm was clear, the other mirrored across the centre line',
  side: 'seen side-on, so the span read is the body depth',
  'no-gap': 'the arms were pressed against the torso — no gap on either side',
  'no-line': 'no arm joint line reached this row',
  'no-torso': 'no torso run in the mask',
};

/** The commonest verdict for a frame, in words — null when something worked. */
function frameReason(measured) {
  if (measured.debug.usableRows > 0) return null;
  const ranked = Object.entries(measured.debug.verdicts || {}).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'nothing usable in the silhouette';
  return VERDICT_WORDS[ranked[0][0]] || ranked[0][0];
}

/**
 * Turn mask pixels into inches the same way the measurements are: through the
 * head-length scale, which is the only thing that sets centimetres. Returns a
 * function that gives null when the frame had no usable scale.
 */
function inchMaker(measured) {
  const { mask, headCmPerWidth } = measured.debug;
  const cmPerPx = headCmPerWidth && mask[0] ? headCmPerWidth / mask[0] : 0;
  if (!cmPerPx) return () => null;
  return (px) => (px > 0 ? Math.round(((px * cmPerPx) / 2.54) * 10) / 10 : null);
}

let enginePromise = null;

/**
 * Load (once per page) the pose + segmentation stack.
 * @returns {Promise<{detect: (canvas: HTMLCanvasElement) => object|null, close: () => void, model: string}>}
 */
export function loadPoseEngine({ onProgress } = {}) {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    onProgress?.('Fetching the measurement model — 9 MB, first time only…');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    let landmarker = null;
    let model = '';
    let lastErr = null;

    for (const [name, delegate] of CANDIDATES) {
      try {
        onProgress?.(`Starting the measurement model (${name} / ${delegate})…`);
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODELS[name], delegate },
          runningMode: 'IMAGE',
          numPoses: 1,
          outputSegmentationMasks: true,
        });
        model = `${name} on ${delegate}`;
        break;
      } catch (e) {
        lastErr = e;
        log('model failed', name, delegate, e.message);
      }
    }
    if (!landmarker) throw new Error(`Could not load the pose model (${lastErr?.message || 'unknown error'})`);
    log('ready', model);

    return {
      model,
      close: () => { try { landmarker.close(); } catch { /* ignore */ } },
      detect: (canvas) => {
        const out = landmarker.detect(canvas);
        if (!out || !out.landmarks || !out.landmarks.length) return null;
        const mask = out.segmentationMasks && out.segmentationMasks[0];
        return {
          landmarks: out.landmarks[0],
          worldLandmarks: out.worldLandmarks && out.worldLandmarks[0],
          mask: mask ? { data: mask.getAsFloat32Array(), width: mask.width, height: mask.height } : null,
        };
      },
    };
  })();

  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

/**
 * Sample frames across the trimmed span and measure each one.
 *
 * @param {File|Blob} file recorded video
 * @param {{count?: number, from?: number, to?: number, maxWidth?: number,
 *          gender?: 'male'|'female'|'unsure',
 *          onProgress?: (msg: string) => void}} [opts]
 * @returns {Promise<{frames: object[], seen: object[], width: number, height: number, model: string}>}
 */
export async function analyzePose(file, opts = {}) {
  const { count: wanted = 6, from = 0, to = 1, maxWidth = 720, gender = 'unsure', onProgress } = opts;
  const engine = await loadPoseEngine({ onProgress });
  // On a CPU a frame costs seconds, so ten views around the turn instead of
  // twelve is most of a second each saved without losing a side of the body.
  const count = engine.model.includes('CPU') ? Math.min(wanted, 10) : wanted;

  return withVideo(file, async (video) => {
    const duration = await resolveDuration(video);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error('The recorded video has no picture');

    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    // MediaPipe reads the canvas directly; keep a plain 2d context so the same
    // surface can be reused for every frame without allocating.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const t0 = Math.min(1, Math.max(0, from)) * (duration || 0);
    const t1 = Math.min(1, Math.max(0, to)) * (duration || 0);
    const span = Math.max(0.1, t1 - t0);

    const frames = [];
    const passStart = performance.now();
    /** Frame times, so a slow device is visible in the log rather than felt. */
    const frameMs = [];
    /**
     * Every sampled frame, with the picture behind it. This is what the results
     * screen shows under "What the app saw": a blank or an odd number is nearly
     * always something visible in the frame, and never something a table of
     * numbers can show.
     */
    const seen = [];
    for (let i = 0; i < count; i += 1) {
      const t = duration ? Math.min(duration - 0.02, t0 + span * ((i + 0.5) / count)) : 0;
      onProgress?.(`Measuring frame ${i + 1} of ${count}…`);
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let det = null;
      const tDetect = performance.now();
      try {
        det = engine.detect(canvas);
      } catch (e) {
        log('detect failed on frame', i, e.message);
      }
      const detectMs = Math.round(performance.now() - tDetect);
      frameMs.push(detectMs);
      if (!det || !det.mask) {
        log('frame', i, 'no pose');
        seen.push({
          i, t, person: false, usable: 0, reason: 'no person in this frame',
          jpeg: drawMeasuredFrame({ src: canvas }),
        });
        continue;
      }

      const measured = measureSilhouette({
        mask: det.mask.data,
        maskW: det.mask.width,
        maskH: det.mask.height,
        lm: det.landmarks,
        world: det.worldLandmarks,
        imgW: canvas.width,
        imgH: canvas.height,
        // The head-length constant — and so every centimetre — follows the group
        // the user said they are in.
        gender,
      });
      if (!measured) {
        log('frame', i, 'silhouette unusable');
        seen.push({
          i, t, person: true, usable: 0, reason: 'a person was found, but no torso to read',
          jpeg: drawMeasuredFrame({
            src: canvas, mask: det.mask.data, maskW: det.mask.width, maskH: det.mask.height,
          }),
        });
        continue;
      }

      frames.push({ index: i, t, ...measured, camera: readCameraQuality(ctx, canvas.width, canvas.height) });
      log('frame', i, `t=${t.toFixed(1)}s`, `detect=${detectMs}ms`, `view=${measured.view}`, `conf=${measured.confidence.toFixed(2)}`,
        `head cm/width=${measured.debug.headCmPerWidth ? measured.debug.headCmPerWidth.toFixed(1) : 'none'}`,
        `pose cm/width=${measured.debug.poseCmPerWidth ? measured.debug.poseCmPerWidth.toFixed(1) : 'none'}`,
        JSON.stringify(measured.debug.widths));
      for (const n of measured.notes) log('  ·', n);

      const inchOf = inchMaker(measured);
      seen.push({
        i,
        t,
        person: true,
        view: measured.view,
        usable: measured.debug.usableRows,
        reason: frameReason(measured),
        headFrom: measured.debug.headPx.from,
        widths: {
          shoulder: inchOf(measured.debug.widths.shoulder),
          chest: inchOf(measured.debug.widths.chest),
          waist: inchOf(measured.debug.widths.waist),
          hips: inchOf(measured.debug.widths.hips),
          arm: inchOf(measured.debug.widths.arm),
        },
        jpeg: drawMeasuredFrame({
          src: canvas,
          mask: det.mask.data,
          maskW: det.mask.width,
          maskH: det.mask.height,
          landmarks: measured.landmarks,
          cmPerWidth: measured.debug.headCmPerWidth || 0,
          sideOn: measured.view === 'side',
          headCm: measured.debug.headCm,
        }),
      });
    }

    // Keep the handful of pictures that best explain the result and drop the
    // rest: each one is a JPEG living in the page, and four frames say as much
    // as six. A frame that measured something beats one that found nothing.
    const score = (f) => (f.person ? (f.usable > 0 ? 3 + Math.min(0.9, f.usable / 100) : 2) : 1);
    const keep = new Set([...seen].sort((a, b) => score(b) - score(a))
      .slice(0, MAX_SKETCHES).map((f) => f.i));
    for (const f of seen) if (!keep.has(f.i)) f.jpeg = null;

    log('frames measured', frames.length, 'of', count,
      '·', seen.filter((f) => f.person && f.usable > 0).length, 'readable');
    log('pose pass', `${Math.round(performance.now() - passStart)}ms for ${count} frames`,
      '· detect', frameMs.join('/'), 'ms · model', engine.model);

    return { frames, seen, width: canvas.width, height: canvas.height, model: engine.model, duration };
  });
}
