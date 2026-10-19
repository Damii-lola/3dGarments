/**
 * Still frames taken out of the clip the shopper actually recorded.
 *
 * This runs on the server, on Render, and that is the whole point: the phone
 * uploads the video and does no decoding, seeking or canvas work at all. A
 * WebView's video seek is slow and occasionally lies (a frame that never arrives
 * is a measurement that never happens), and a server can look at the WHOLE clip
 * rather than at a grid of six times decided before anyone saw it.
 *
 * HOW: one short ffmpeg run per frame. Each run seeks straight to its own
 * timestamp on the file and is asked for exactly one picture. A seek is a
 * keyframe seek followed by a handful of decoded frames, so eight of them cost a
 * fraction of decoding the clip once — and because nothing here asks ffmpeg for
 * a *rate* of frames, there is no frame-rate machinery in the middle that can
 * duplicate, reorder or substitute anything. An earlier version used
 * `-skip_frame nokey` with the default frame-rate mode, and that pairing quietly
 * handed back one undecoded black picture and then CLONED it across the whole
 * output set: every real phone clip came back as eight black frames and was
 * refused as "could not find a person". One frame per seek cannot do that.
 *
 * Frames are JPEGs written to a temp directory that is deleted in a `finally`,
 * so a failed scan cannot leave a picture of somebody's body on the disk.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const run = promisify(execFile);

/**
 * Eight, not sixteen. Read as a spread of angles: eight samples over one turn
 * are 45° apart, worst case 22.5° off square-on — and measurePath undoes that
 * turn by cos, so the error it used to cause is gone. Sixteen bought views the
 * arithmetic did not need and paid for them in waiting.
 */
export const MAX_FRAMES = 8;

/**
 * Seeks run side by side, all of them at once. Each seek spends most of its life
 * waiting on a decode step that another process could be doing, so on a
 * burstable instance the whole set tends to land in about the time of the
 * slowest one rather than the sum.
 */
const SEEK_CONCURRENCY = 8;

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
 * @param {{from?: number, to?: number, count?: number, maxWidth?: number, timeoutMs?: number, info?: object}} [opts]
 * @returns {Promise<Array<{buffer: Buffer, size: number, originalname: string, mimetype: string}>>}
 */
export async function framesFromVideo(filePath, opts = {}) {
  const {
    from = 0,
    to = null,
    count = MAX_FRAMES,
    maxWidth = 900,
    timeoutMs = 45_000,
    info = null,
  } = opts;

  const duration = await probeDuration(filePath);

  // The trim is a LENGTH, and it is the shopper's own: never read more than half
  // a minute of a clip, and never read past its end — a 21 s clip asked for
  // "0 to 30" has 21 s to spread eight frames across, and aiming three of them
  // into nothing would just lose those angles.
  const asked = Number.isFinite(to) ? to - from : 30;
  const within = Number.isFinite(duration) && duration > 0 ? duration - from : Infinity;
  const span = clamp(Math.min(30, asked, within), 0.4, 30);

  const root = await mkdtemp(join(tmpdir(), '3dg-clip-'));
  try {
    // Half a slot in from each end: the first and last moments of a turn are
    // where somebody is still finding their place, and they are the two frames
    // most likely to catch a body on its way in or out of the shot.
    const slots = [];
    for (let i = 0; i < count; i += 1) {
      slots.push({
        name: `frame-${String(i + 1).padStart(2, '0')}`,
        time: clamp(from + (span * (i + 0.5)) / count, 0, Math.max(0, (duration || Infinity) - 0.05)),
      });
    }

    const results = await sweep(filePath, root, slots, { maxWidth, timeoutMs });

    // One second look at any angle that came back empty. A single seek can land
    // on a blank instant (the tail of somebody else's cut, a frame the encoder
    // threw away); the next tenth of a second is usually a perfectly good
    // picture, and it costs one cheap seek rather than a missing view.
    const missed = slots.map((_, i) => i).filter((i) => !results[i]);
    if (missed.length) {
      const retry = missed.map((i) => ({
        name: `${slots[i].name}r`,
        time: clamp(slots[i].time + span / (count * 3), 0, Math.max(0, (duration || Infinity) - 0.05)),
      }));
      const second = await sweep(filePath, root, retry, { maxWidth, timeoutMs });
      missed.forEach((i, k) => {
        if (second[k]) results[i] = second[k];
      });
    }

    const frames = results.filter(Boolean);
    if (info) {
      Object.assign(info, {
        duration: Number.isFinite(duration) ? Number(duration.toFixed(2)) : null,
        span: Number(span.toFixed(2)),
        asked: count,
        taken: frames.length,
        blank: slots.filter((s) => s.blank).length,
        errors: slots.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`).slice(0, 4),
      });
    }
    // Nothing at all came out and we know why: say so, rather than let the route
    // report a generic "could not read that video" over a missing binary.
    const firstError = slots.find((s) => s.error);
    if (!frames.length && firstError) throw new Error(firstError.error);
    return frames;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

/** Ask for every slot at once, four at a time, and keep the ones that arrived. */
async function sweep(filePath, dir, slots, { maxWidth, timeoutMs }) {
  const results = new Array(slots.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(SEEK_CONCURRENCY, slots.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= slots.length) return;
      const slot = slots[i];
      try {
        results[i] = await takeAt(filePath, dir, slot.time, slot.name, { maxWidth, timeoutMs });
        slot.blank = results[i] === null;
      } catch (e) {
        slot.error = String(e?.message || e).slice(0, 160);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** One frame, at one timestamp, from one seek. */
async function takeAt(filePath, dir, time, name, { maxWidth, timeoutMs }) {
  const out = join(dir, `${name}.jpg`);
  await run(await ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error',
    // Leave stdin alone: a prompt for input is a hang, not a question.
    '-nostdin',
    // -ss BEFORE -i: seek to the nearest keyframe and decode forward to the
    // timestamp asked for. That is the cheap seek, and it still lands on the
    // exact picture — unlike seeking after -i, which decodes everything before it.
    '-ss', time.toFixed(3),
    '-i', filePath,
    '-frames:v', '1',
    '-an', '-sn', '-dn',
    // Never upscale: a phone clip is often narrower than the target (WhatsApp
    // sends 478x850), and stretching that to 900 invents no detail at all while
    // multiplying the image tokens the model has to read.
    '-vf', `scale=min(${maxWidth}\\,iw):-2`,
    '-q:v', '3',
    '-y', out,
  ], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });

  const raw = await readFile(out);
  // A picture with no picture in it is not a view of anybody, whatever produced it.
  if (await isBlank(raw)) return null;
  const buffer = await withGrid(raw);
  return { buffer, size: buffer.length, originalname: `${name}.jpg`, mimetype: 'image/jpeg' };
}

/**
 * How long the clip actually is, straight out of ffmpeg's own report on it.
 * There is no ffprobe in this dependency tree, and ffmpeg prints the duration
 * whether or not it can write anything, so its (failed) "just describe it" run
 * is the probe. Returns null when the length cannot be read: the caller then
 * simply trusts the trim it was given.
 */
async function probeDuration(filePath) {
  try {
    await run(await ffmpegBinary(), ['-hide_banner', '-nostdin', '-i', filePath], {
      timeout: 20_000, maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(e?.stderr || ''));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return null;
}

/**
 * A frame with no content: essentially black, and essentially uniform. A dark
 * room still has shape in it (so the deviation saves it); an undecoded frame is
 * flat and empty.
 */
async function isBlank(buffer) {
  try {
    const { channels } = await sharp(buffer).stats();
    const mean = channels[0]?.mean ?? 0;
    const deviation = channels[0]?.stdev ?? 0;
    return mean < 6 && deviation < 4;
  } catch {
    return false;
  }
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

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}
