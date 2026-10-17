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
import { withVideo, resolveDuration, seek } from './frames.js';

const TASKS_VERSION = '0.10.21';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
/** Full first for accuracy, lite as the fallback when the bigger file will not load. */
const MODELS = [
  `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
];

const log = (...args) => console.log('[3dg:pose]', ...args);

let enginePromise = null;

/**
 * Load (once per page) the pose + segmentation stack.
 * @returns {Promise<{detect: (canvas: HTMLCanvasElement) => object|null, close: () => void, model: string}>}
 */
export function loadPoseEngine({ onProgress } = {}) {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    onProgress?.('Loading the measurement model…');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    let landmarker = null;
    let model = '';
    let lastErr = null;

    for (const url of MODELS) {
      for (const delegate of ['GPU', 'CPU']) {
        try {
          onProgress?.(`Loading the measurement model… (${url.includes('full') ? 'full' : 'lite'} / ${delegate})`);
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: url, delegate },
            runningMode: 'IMAGE',
            numPoses: 1,
            outputSegmentationMasks: true,
          });
          model = `${url.split('/').slice(-3)[0]} on ${delegate}`;
          break;
        } catch (e) {
          lastErr = e;
          log('model failed', url, delegate, e.message);
        }
      }
      if (landmarker) break;
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
 *          onProgress?: (msg: string) => void}} [opts]
 * @returns {Promise<{frames: object[], width: number, height: number, model: string}>}
 */
export async function analyzePose(file, opts = {}) {
  const { count = 6, from = 0, to = 1, maxWidth = 720, onProgress } = opts;
  const engine = await loadPoseEngine({ onProgress });

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
    for (let i = 0; i < count; i += 1) {
      const t = duration ? Math.min(duration - 0.02, t0 + span * ((i + 0.5) / count)) : 0;
      onProgress?.(`Measuring frame ${i + 1} of ${count}…`);
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let det = null;
      try {
        det = engine.detect(canvas);
      } catch (e) {
        log('detect failed on frame', i, e.message);
      }
      if (!det || !det.mask) { log('frame', i, 'no pose'); continue; }

      const measured = measureSilhouette({
        mask: det.mask.data,
        maskW: det.mask.width,
        maskH: det.mask.height,
        lm: det.landmarks,
        world: det.worldLandmarks,
        imgW: canvas.width,
        imgH: canvas.height,
      });
      if (!measured) { log('frame', i, 'silhouette unusable'); continue; }

      frames.push({ index: i, t, ...measured });
      log('frame', i, `t=${t.toFixed(1)}s`, `view=${measured.view}`, `conf=${measured.confidence.toFixed(2)}`,
        `head cm/width=${measured.debug.headCmPerWidth ? measured.debug.headCmPerWidth.toFixed(1) : 'none'}`,
        `pose cm/width=${measured.debug.poseCmPerWidth ? measured.debug.poseCmPerWidth.toFixed(1) : 'none'}`,
        JSON.stringify(measured.debug.widths));
      for (const n of measured.notes) log('  ·', n);
    }

    return { frames, width: canvas.width, height: canvas.height, model: engine.model, duration };
  });
}
