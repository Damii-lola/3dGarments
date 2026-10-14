/**
 * Scan worker: runs the heavy part (AI cut-out, template registration, atlas) off the API's event loop.
 * One persistent worker keeps the ONNX model loaded; jobs arrive one at a time from services/scan.js.
 */
import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
import { aiMask } from './segment.js';
import { scanAtlas } from '../shared/scan-core.js';

const MAX_SIDE = 1024;

/** decode an uploaded photo (any format sharp reads, EXIF orientation applied) to RGBA + the AI garment matte */
async function decode(buf) {
  const { data, info } = await sharp(buf, { failOn: 'none' }).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: false })
    .flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const { mask, alpha } = await aiMask(rgba, info.width, info.height);
  return { rgba, width: info.width, height: info.height, mask, alpha };
}

parentPort.on('message', async (job) => {
  const t0 = Date.now();
  try {
    const front = await decode(Buffer.from(job.front));
    const back = job.back ? await decode(Buffer.from(job.back)) : null;
    const tCut = Date.now() - t0;
    const res = scanAtlas(job.template, { front, back }, { size: job.size });
    const raw = sharp(Buffer.from(res.rgba.buffer, res.rgba.byteOffset, res.rgba.byteLength), { raw: { width: res.size, height: res.size, channels: 4 } }).removeAlpha();
    const image = job.format === 'png' ? await raw.png({ compressionLevel: 9 }).toBuffer() : await raw.webp({ quality: 90 }).toBuffer();
    parentPort.postMessage({ id: job.id, ok: true, image, mime: job.format === 'png' ? 'image/png' : 'image/webp', report: { ...res.report, cutoutMs: tCut, totalMs: Date.now() - t0 } });
  } catch (e) {
    parentPort.postMessage({ id: job.id, ok: false, error: e.message || String(e) });
  }
});
