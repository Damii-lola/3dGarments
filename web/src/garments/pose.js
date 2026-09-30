/**
 * The wearer's body in the photo: 17 keypoints (COCO: nose, eyes, ears, shoulders, elbows, wrists, hips, knees,
 * ankles) from ViTPose-B (Apache-2.0, ONNX by onnx-community), run with onnxruntime-web on the person's box
 * (every pixel the clothes-parsing model didn't call background). Points it can't see (out of the frame,
 * hidden) come back null.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

export const VITPOSE_URL = 'https://huggingface.co/onnx-community/vitpose-base-simple/resolve/main/onnx/model_quantized.onnx';
export const KP = ['nose', 'eye_l', 'eye_r', 'ear_l', 'ear_r', 'shoulder_l', 'shoulder_r', 'elbow_l', 'elbow_r', 'wrist_l', 'wrist_r',
  'hip_l', 'hip_r', 'knee_l', 'knee_r', 'ankle_l', 'ankle_r'];
const IW = 192, IH = 256, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

let session = null;
function load() {
  if (!session) {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    session = ort.InferenceSession.create(globalThis.__vitposeUrl || VITPOSE_URL, { executionProviders: ['wasm'] }).catch((e) => { session = null; throw e; });
  }
  return session;
}

/** parsed (parse.js parsePhoto) → { [name]: { x, y, score } | null } in photo pixels */
export async function detectPose(parsed, minScore = 0.3) {
  const { w, h, label, canvas } = parsed;
  // the person's box, 3:4 like the model's input, a little padded
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let i = 0; i < w * h; i++) if (label[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) { x0 = 0; x1 = w - 1; y0 = 0; y1 = h - 1; }
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = (x1 - x0) * 1.2, bh = (y1 - y0) * 1.2;
  if (bw / bh > IW / IH) bh = bw * IH / IW; else bw = bh * IW / IH;
  const c = document.createElement('canvas'); c.width = IW; c.height = IH;
  const cx2 = c.getContext('2d', { willReadFrequently: true });
  cx2.fillStyle = 'rgb(124,116,104)'; cx2.fillRect(0, 0, IW, IH);
  cx2.drawImage(canvas, cx - bw / 2, cy - bh / 2, bw, bh, 0, 0, IW, IH);
  const px = cx2.getImageData(0, 0, IW, IH).data, input = new Float32Array(3 * IW * IH);
  for (let i = 0; i < IW * IH; i++) for (let k = 0; k < 3; k++) input[k * IW * IH + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k];
  const sess = await load();
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, IH, IW]) });
  const hm = out[sess.outputNames[0]], [, K, HH, HW] = hm.dims, d = hm.data;
  const res = {};
  for (let k = 0; k < K && k < KP.length; k++) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < HH * HW; i++) { const v = d[k * HH * HW + i]; if (v > best) { best = v; bi = i; } }
    let hx = bi % HW, hy = (bi / HW) | 0;
    // quarter-pixel refinement toward the higher neighbour (as the reference post-processing does)
    const at = (x, y) => (x >= 0 && y >= 0 && x < HW && y < HH ? d[k * HH * HW + y * HW + x] : best);
    const fx = hx + 0.25 * Math.sign(at(hx + 1, hy) - at(hx - 1, hy)), fy = hy + 0.25 * Math.sign(at(hx, hy + 1) - at(hx, hy - 1));
    const x = cx - bw / 2 + ((fx + 0.5) / HW) * bw, y = cy - bh / 2 + ((fy + 0.5) / HH) * bh;
    // a point at the photo's edge is a guess about what's outside it: unseen
    const edge = x < 0.03 * w || x > 0.97 * w || y < 0.03 * h || y > 0.97 * h;
    res[KP[k]] = best < minScore || edge ? null : { x, y, score: best };
  }
  return res;
}
