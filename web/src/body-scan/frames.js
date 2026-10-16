/**
 * Pull evenly spaced frames out of a recorded video so the vision model can see
 * the person from several angles as they turn.
 *
 * The native camera app records an ordinary video file; we decode it in a
 * <video>, seek to points across the clip, and draw each one to a canvas.
 *
 * `from` / `to` (0-1 of the clip) trim the video's LENGTH: only frames inside
 * that span are sampled.
 *
 * Everything here is time-boxed and the decoder is attached (off-screen) to the
 * document, because some mobile browsers refuse to decode a detached video and
 * will otherwise hang forever.
 */

const METADATA_TIMEOUT = 15000;
const SEEK_TIMEOUT = 6000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log('[3dg:framed]', ...args);

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

function waitForMetadata(video) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onOk);
      video.removeEventListener('error', onErr);
    };
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('Could not read the recorded video')); };

    video.addEventListener('loadedmetadata', onOk);
    video.addEventListener('error', onErr);
    if (video.readyState >= 1) { onOk(); return; }
    timer = setTimeout(() => { cleanup(); reject(new Error('Timed out reading the video')); }, METADATA_TIMEOUT);
  });
}

function seek(video, time) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, SEEK_TIMEOUT);
    // already there? no 'seeked' will fire
    if (Math.abs(video.currentTime - time) < 0.02 && video.readyState >= 2) { finish(); return; }
    video.addEventListener('seeked', finish);
    try { video.currentTime = Math.max(0, time); } catch { finish(); }
  });
}

const toBlob = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/** Opens the video off-screen, runs `run(video)`, and always cleans up. */
async function withVideo(file, run) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  // Attached but invisible: some mobile browsers only decode video in the DOM.
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);

  try {
    video.src = url;
    video.load();
    await waitForMetadata(video);
    return await run(video);
  } finally {
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignore */ }
    video.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File|Blob} file recorded video
 * @param {{count?: number, maxWidth?: number, quality?: number, from?: number, to?: number}} [opts]
 * @returns {Promise<File[]>} JPEG frames
 */
export async function extractFrames(file, opts = {}) {
  const { count = 6, maxWidth = 900, quality = 0.85, from = 0, to = 1 } = opts;
  log('extractFrames start', { bytes: file.size, count, from, to });

  return withVideo(file, async (video) => {
    const duration = await resolveDuration(video);
    if (!duration || !Number.isFinite(duration)) throw new Error('Could not determine the video length');
    log('video ready', { duration, w: video.videoWidth, h: video.videoHeight });

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
    const total = frames.reduce((s, f) => s + f.size, 0);
    log('extractFrames done', { frames: frames.length, bytes: total });
    return frames;
  });
}

/** The clip's length in seconds (0 if it can't be determined). */
export async function readDuration(file) {
  try {
    return await withVideo(file, (video) => resolveDuration(video));
  } catch (e) {
    log('readDuration failed', e.message);
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
