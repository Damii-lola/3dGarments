/**
 * AI cut-out: U²-Net-P (4.6 MB, Apache-2.0) run with onnxruntime-web's WASM backend, which needs no native
 * binaries and no downloads at install time. The colour-based segmentation in shared/silhouette.js only works on
 * plain backdrops (a wood-grain table defeats it); this works on real product photos.
 *
 * The model file is looked up in $U2NETP_PATH, then server/models/u2netp.onnx; if it is missing it is downloaded once.
 */
import sharp from 'sharp';
import * as ort from 'onnxruntime-web';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = process.env.U2NETP_PATH || path.resolve(here, '../../models/u2netp.onnx');
const MODEL_URL = process.env.U2NETP_URL || 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const SIZE = 320, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = pathToFileURL(path.resolve(here, '../../node_modules/onnxruntime-web/dist') + path.sep).href;

let sessionPromise = null;
async function modelBytes() {
  if (!existsSync(MODEL_PATH)) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`could not download the cut-out model: ${res.status}`);
    await mkdir(path.dirname(MODEL_PATH), { recursive: true });
    await writeFile(MODEL_PATH, Buffer.from(await res.arrayBuffer()));
  }
  return readFile(MODEL_PATH);
}
function session() { return (sessionPromise ||= modelBytes().then((b) => ort.InferenceSession.create(new Uint8Array(b), { executionProviders: ['wasm'] }))); }

/**
 * @param rgba   RGBA pixels (width*height*4)
 * @returns {Promise<{mask: Uint8Array, alpha: Uint8Array}>}  mask: 1 where garment; alpha: the soft 0..255 matte
 */
export async function aiMask(rgba, width, height) {
  const sess = await session();
  // 1) model input: 320x320 RGB, scaled by the max value, ImageNet-normalised, channels first
  const { data } = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })
    .removeAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let max = 1;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (data[i * 3 + c] / max - MEAN[c]) / STD[c];
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const pred = out[sess.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i++) { if (pred[i] < lo) lo = pred[i]; if (pred[i] > hi) hi = pred[i]; }
  // 2) back to the photo's size: plain bilinear on the normalised matte (no colour-space conversion anywhere)
  const norm = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) norm[i] = (pred[i] - lo) / (hi - lo || 1);
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(SIZE - 1, Math.max(0, ((y + 0.5) * SIZE) / height - 0.5)), y0 = Math.floor(fy), y1 = Math.min(SIZE - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(SIZE - 1, Math.max(0, ((x + 0.5) * SIZE) / width - 0.5)), x0 = Math.floor(fx), x1 = Math.min(SIZE - 1, x0 + 1), tx = fx - x0;
      const v = (norm[y0 * SIZE + x0] * (1 - tx) + norm[y0 * SIZE + x1] * tx) * (1 - ty) + (norm[y1 * SIZE + x0] * (1 - tx) + norm[y1 * SIZE + x1] * tx) * ty;
      alpha[y * width + x] = Math.round(v * 255);
    }
  }
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= 128 ? 1 : 0;
  return { mask, alpha };
}
