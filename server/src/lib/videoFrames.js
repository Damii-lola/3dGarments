/**
 * Still frames taken out of the clip the shopper actually recorded.
 *
 * This runs on the server, on Render, and that is the whole point: the phone
 * uploads the video and does no decoding, seeking or canvas work at all. A
 * WebView's video seek is slow and occasionally lies (a frame that never arrives
 * is a measurement that never happens), and a server can look at the WHOLE clip
 * rather than at a grid of six times decided before anyone saw it.
 *
 * Two passes, cheapest first:
 *
 *   1. KEYFRAMES. An I-frame is already a sharp, complete picture, and skipping
 *      the frames between them is the difference between decoding twelve seconds
 *      of video and decoding a dozen pictures. Phones write a keyframe every
 *      second or two, so a normal clip yields a clean spread of angles.
 *   2. EVERYTHING, evenly. Only if pass 1 found fewer than six (an unusual
 *      encoder, a very short trim) do we pay to decode the clip properly, at an
 *      even number of frames across the span.
 *
 * Frames are JPEGs written to a temp directory that is deleted in a `finally`,
 * so a failed scan cannot leave a picture of somebody's body on the disk.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const run = promisify(execFile);

/**
 * Eight, not sixteen. The vision model costs about 30 seconds a frame, so the
 * count is not "how many pictures can we afford to send" but "how few angles
 * can still measure a body". Eight samples over one turn are 45° apart, worst
 * case 22.5° off square-on — and measurePath undoes that turn by cos, so the
 * error it used to cause is gone. Sixteen was 90 s of model time for views the
 * arithmetic did not need.
 */
export const MAX_FRAMES = 8;

/**
 * The ffmpeg binary, resolved once and never allowed to take the API down with
 * it. `ffmpeg-static` is a normal dependency, but it is 80 MB of native binary
 * fetched at install time: if that fetch ever fails, importing it at module load
 * would kill every route, including the ones that have nothing to do with video.
 * So it is loaded on first use, a system ffmpeg on PATH is the second chance,
 * and a clip that cannot be decoded surfaces as a 422 the app already knows how
 * to fall back from.
 */
let binary;
export async function ffmpegBinary() {
  if (binary !== undefined) return binary;
  try {
    const mod = await import('ffmpeg-static');
    binary = mod.default || 'ffmpeg';
  } catch {
    binary = 'ffmpeg';
  }
  return binary;
}

/**
 * @param {string} filePath the uploaded clip on disk
 * @param {{from?: number, to?: number, count?: number, maxWidth?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<Array<{buffer: Buffer, size: number, originalname: string, mimetype: string}>>}
 */
export async function framesFromVideo(filePath, opts = {}) {
  const {
    from = 0,
    to = null,
    count = MAX_FRAMES,
    maxWidth = 900,
    timeoutMs = 90_000,
  } = opts;

  // The trim is a LENGTH, and it is the shopper's own: never decode more than
  // half a minute of a clip, even if the client asks for it.
  const span = Math.max(0.4, Math.min(30, (Number.isFinite(to) ? to : from + 30) - from));

  const root = await mkdtemp(join(tmpdir(), '3dg-clip-'));
  try {
    const keyframes = await grab(filePath, join(root, 'key'), {
      from, span, count, maxWidth, timeoutMs, keyframesOnly: true,
    });
    if (keyframes.length >= Math.min(6, Math.ceil(span))) return keyframes;

    const even = await grab(filePath, join(root, 'even'), {
      from, span, count, maxWidth, timeoutMs, fps: count / span,
    });
    return even.length ? even : keyframes;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function grab(filePath, dir, { from, span, count, maxWidth, timeoutMs, keyframesOnly = false, fps = null }) {
  await mkdir(dir, { recursive: true });
  const pattern = join(dir, 'f-%03d.jpg');
  const vf = [fps ? `fps=${fps.toFixed(3)}` : null, `scale=${maxWidth}:-2`].filter(Boolean).join(',');

  await run(await ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error',
    // -ss before -i seeks by keyframe, which is the fast kind of seek.
    '-ss', String(from),
    ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
    '-t', String(span),
    '-i', filePath,
    '-vf', vf,
    '-frames:v', String(count),
    '-q:v', '3',
    '-y', pattern,
  ], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });

  const names = (await readdir(dir)).filter((n) => n.endsWith('.jpg')).sort().slice(0, count);
  const frames = [];
  for (const [i, name] of names.entries()) {
    const buffer = await withGrid(await readFile(join(dir, name)));
    frames.push({
      buffer,
      size: buffer.length,
      originalname: `frame-${String(i + 1).padStart(2, '0')}.jpg`,
      mimetype: 'image/jpeg',
    });
  }
  return frames;
}

/**
 * The same labelled 10x10 ruler the browser draws over a still frame, drawn here
 * instead because these pictures never touch a canvas.
 *
 * This is not decoration. The prompt tells the model that the numbers along the
 * top are x and down the left edge are y, on the 0-100 scale every landmark is
 * answered in; without the grid on the picture it was being told something
 * untrue, and precision is exactly what the measurements are built on. A frame
 * with no ruler is worth less than a frame with one, whatever else it shows.
 */
function gridSvg(w, h) {
  const line = Math.max(1, Math.round(Math.min(w, h) / 420));
  const fontSize = Math.max(11, Math.round(w / 60));
  const lines = [];
  for (let i = 1; i < 10; i += 1) {
    const x = Math.round((w * i) / 10) + 0.5;
    const y = Math.round((h * i) / 10) + 0.5;
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`);
    lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`);
  }
  const plates = [];
  const texts = [];
  for (let i = 1; i < 10; i += 1) {
    const label = String(i * 10);
    const tw = label.length * fontSize * 0.62;
    const x = (w * i) / 10;
    const y = (h * i) / 10;
    const boxW = tw + 6;
    const boxH = fontSize + 4;
    plates.push(`<rect x="${x + 2}" y="2" width="${boxW}" height="${boxH}"/>`);
    plates.push(`<rect x="2" y="${y + 2}" width="${boxW}" height="${boxH}"/>`);
    texts.push(`<text x="${x + 5}" y="4" dominant-baseline="hanging">${label}</text>`);
    texts.push(`<text x="5" y="${y + 4}" dominant-baseline="hanging">${label}</text>`);
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<g stroke="rgba(0,240,130,0.45)" stroke-width="${line}">${lines.join('')}</g>`
    + `<g fill="rgba(0,0,0,0.62)">${plates.join('')}</g>`
    + `<g font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#8dffbe">${texts.join('')}</g>`
    + '</svg>',
  );
}

async function withGrid(buffer) {
  try {
    const image = sharp(buffer);
    const { width, height } = await image.metadata();
    if (!width || !height) return buffer;
    return await image
      .composite([{ input: gridSvg(width, height), top: 0, left: 0 }])
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    // A frame without its ruler is still a frame; the measurement engine checks
    // what it gets, and losing the whole scan over a failed composite would be
    // the worse trade.
    return buffer;
  }
}
