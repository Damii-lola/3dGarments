/**
 * Pull evenly spaced frames out of a recorded video so the vision model can see
 * the person from several angles as they turn a full 360.
 *
 * The native camera app records an ordinary video file; we decode it in a hidden
 * <video>, seek to points across the clip, and draw each one to a canvas.
 *
 * A normalised crop rectangle can be supplied so only the person is sent (the
 * background is cut away, which measurably improves the estimate).
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
 * @param {{count?: number, maxWidth?: number, quality?: number, crop?: {x:number,y:number,w:number,h:number}}} [opts]
 * @returns {Promise<File[]>} JPEG frames
 */
export async function extractFrames(file, opts = {}) {
  const { count = 6, maxWidth = 900, quality = 0.85, crop } = opts;

  return withVideo(file, async (video) => {
    const duration = await resolveDuration(video);
    if (!duration || !Number.isFinite(duration)) throw new Error('Could not determine the video length');

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error('The recorded video has no picture');

    const sx = crop ? crop.x * vw : 0;
    const sy = crop ? crop.y * vh : 0;
    const sw = crop ? crop.w * vw : vw;
    const sh = crop ? crop.h * vh : vh;

    const scale = Math.min(1, maxWidth / sw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');

    const frames = [];
    for (let i = 0; i < count; i += 1) {
      const t = duration * ((i + 0.5) / count);
      await seek(video, t);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, quality);
      if (blob) frames.push(new File([blob], `frame-${i}.jpg`, { type: 'image/jpeg' }));
    }

    if (!frames.length) throw new Error('Could not extract any frames from the video');
    return frames;
  });
}

/**
 * One uncropped frame + the video's pixel size — used to show the crop picker.
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function extractPreview(file, { maxWidth = 720, quality = 0.82 } = {}) {
  return withVideo(file, async (video) => {
    const duration = await resolveDuration(video);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error('The recorded video has no picture');

    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    // seek to a point slightly in (people often start moving immediately)
    if (duration && Number.isFinite(duration)) {
      await seek(video, duration * 0.15);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    const blob = await toBlob(canvas, quality);
    if (!blob) throw new Error('Could not read a frame from the video');
    return { blob, width: vw, height: vh };
  });
}
