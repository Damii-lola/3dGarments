/**
 * Pull evenly spaced frames out of a recorded video so the vision model can see
 * the person from several angles as they turn.
 *
 * The native camera app records an ordinary video file; we decode it in a hidden
 * <video>, seek to points across the clip, and draw each one to a canvas.
 *
 * `from` / `to` (0-1 of the clip) let the caller trim the video's LENGTH: only
 * frames inside that span are sampled.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Some browsers report duration = Infinity until the file is seeked. */
async function resolveDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      video.removeEventListener('timeupdate', onUpdate);
      resolve(value);
    };
    const onUpdate = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) done(video.duration);
    };
    video.addEventListener('timeupdate', onUpdate);
    try { video.currentTime = 1e101; } catch { /* ignore */ }
    sleep(3000).then(() => done(Number.isFinite(video.duration) ? video.duration : 0));
  });
}

function seek(video, time) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    try { video.currentTime = Math.max(0, time); } catch { done(); }
  });
}

const toBlob = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/** Opens the video file in a detached <video> and hands it to `run`. */
async function withVideo(file, run) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  try {
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not read the recorded video'));
    });
    return await run(video);
  } finally {
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignore */ }
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File|Blob} file recorded video
 * @param {{count?: number, maxWidth?: number, quality?: number, from?: number, to?: number}} [opts]
 *   from/to are fractions (0-1) of the clip length to sample between.
 * @returns {Promise<File[]>} JPEG frames
 */
export async function extractFrames(file, opts = {}) {
  const { count = 6, maxWidth = 900, quality = 0.85, from = 0, to = 1 } = opts;

  return withVideo(file, async (video) => {
    const duration = await resolveDuration(video);
    if (!duration || !Number.isFinite(duration)) throw new Error('Could not determine the video length');

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error('The recorded video has no picture');

    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    const ctx = canvas.getContext('2d');

    const t0 = Math.min(1, Math.max(0, from)) * duration;
    const t1 = Math.min(1, Math.max(0, to)) * duration;
    const span = Math.max(0.1, t1 - t0);

    const frames = [];
    for (let i = 0; i < count; i += 1) {
      const t = Math.min(duration - 0.02, t0 + span * ((i + 0.5) / count));
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, quality);
      if (blob) frames.push(new File([blob], `frame-${i}.jpg`, { type: 'image/jpeg' }));
    }

    if (!frames.length) throw new Error('Could not extract any frames from the video');
    return frames;
  });
}

/**
 * The clip's length in seconds (0 if it can't be determined).
 * @param {File|Blob} file
 */
export async function readDuration(file) {
  try {
    return await withVideo(file, (video) => resolveDuration(video));
  } catch {
    return 0;
  }
}

/**
 * One frame as a Blob + the video's pixel size — used as the player's poster.
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function extractPoster(file, { maxWidth = 720, quality = 0.82 } = {}) {
  return withVideo(file, async (video) => {
    const duration = await resolveDuration(video);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error('The recorded video has no picture');

    if (duration && Number.isFinite(duration)) await seek(video, duration * 0.1);

    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await toBlob(canvas, quality);
    if (!blob) throw new Error('Could not read a frame from the video');
    return { blob, width: vw, height: vh };
  });
}
