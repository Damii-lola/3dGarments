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

const run = promisify(execFile);

export const MAX_FRAMES = 16;

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
    const buffer = await readFile(join(dir, name));
    frames.push({
      buffer,
      size: buffer.length,
      originalname: `frame-${String(i + 1).padStart(2, '0')}.jpg`,
      mimetype: 'image/jpeg',
    });
  }
  return frames;
}
