/**
 * Pull evenly spaced frames out of a recorded video so the vision model can see
 * the person from several angles as they turn a full 360.
 *
 * The native camera app records an ordinary video file; we decode it in a hidden
 * <video>, seek to points across the clip, and draw each one to a canvas.
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

/**
 * @param {File|Blob} file recorded video
 * @param {{count?: number, maxWidth?: number, quality?: number}} [opts]
 * @returns {Promise<File[]>} JPEG frames
 */
export async function extractFrames(file, opts = {}) {
  const { count = 6, maxWidth = 768, quality = 0.82 } = opts;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  const cleanup = () => {
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignore */ }
    URL.revokeObjectURL(url);
  };

  try {
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not read the recorded video'));
      video.onstalled = () => reject(new Error('The recorded video could not be decoded'));
    });

    const duration = await resolveDuration(video);
    if (!duration || !Number.isFinite(duration)) {
      throw new Error('Could not determine the video length');
    }

    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) throw new Error('The recorded video has no picture');

    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');

    const frames = [];
    for (let i = 0; i < count; i += 1) {
      const t = duration * ((i + 0.5) / count);
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, quality);
      if (blob) frames.push(new File([blob], `frame-${i}.jpg`, { type: 'image/jpeg' }));
    }

    if (!frames.length) throw new Error('Could not extract any frames from the video');
    return frames;
  } finally {
    cleanup();
  }
}
