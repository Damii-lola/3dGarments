/**
 * Talk to the body-scan API and get back the analysis (body measurements, size
 * + proportions).
 *
 * Three ways in, one engine out:
 *   analyzeVideo()    — the clip itself; the server takes the frames out of it.
 *   analyzeBody()     — JPEG frames, for ?frames=1 and the automatic fallback.
 *   analyzeGeometry() — numbers measured on the device by the pose model.
 *
 * A free Render instance can take ~50s to wake, so allow a generous timeout.
 * Everything is logged to the console with a [3dg:api] prefix so a stuck request
 * is easy to spot.
 */
import { API_URL } from '../services/config.js';

const log = (...args) => console.log('[3dg:api]', ...args);

async function request(url, init, { timeoutMs, onTick } = {}) {
  const ctl = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const tick = onTick ? setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1000) : null;

  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const elapsed = Date.now() - started;
    log('response', res.status, `${elapsed}ms`);

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    log('body', data ?? text.slice(0, 400));

    if (!res.ok) {
      const msg = (data && data.error) || `Analysis failed (${res.status})`;
      throw new Error(res.status === 503 ? `${msg} — the service may not be fully set up yet.` : msg);
    }
    if (!data) throw new Error('The analysis service returned nothing');
    return data;
  } catch (e) {
    log('error', e.name, e.message);
    if (e.name === 'AbortError') {
      throw new Error(`The analysis service took too long (${Math.round((Date.now() - started) / 1000)}s). It may be waking up — please try again.`);
    }
    if (e instanceof TypeError) {
      throw new Error('Could not reach the analysis service. Check your connection and try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (tick) clearInterval(tick);
  }
}

/**
 * Send the clip itself, and let the server take the frames out of it.
 *
 * This is the default path. The phone uploads the video and does nothing else —
 * no decoding, no seeking, no canvas: work that a WebView is bad at and a server
 * is good at. `onProgress` reports the upload (0..1) so a big clip on a slow
 * connection still looks alive.
 *
 * THE CLOCK. A phone's own camera records at ten times the bitrate of a
 * WhatsApp clip: half a minute is 30-40 MB, and on a shopper's uplink that is
 * minutes, not seconds — one real scan spent 215 s with the bar still climbing.
 * So the upload is measured as it happens, and if the bytes cannot all be up
 * inside `uploadBudgetMs` the request is abandoned and the caller sends a dozen
 * key frames instead (about 600 KB) — the same turn, the same measurement, a
 * fraction of the wire. `slowUpload` on the error is what tells the caller that
 * this was a trade, not a failure.
 *
 * @param {Blob} clip the trimmed recording
 * @param {{from?: number, to?: number, gender?: string, chart?: object, uploadBudgetMs?: number, onProgress?: (f: number) => void, onUploaded?: () => void, onTick?: (s: number) => void, onSpeed?: (s: {bps: number, projectedMs: number}) => void}} [opts]
 */
export function analyzeVideo(clip, opts = {}) {
  const url = `${API_URL}/api/body-scan`;
  const form = new FormData();
  form.append('video', clip, clip.name || 'clip.mp4');
  form.append('from', String(opts.from ?? 0));
  form.append('to', String(opts.to ?? 0));
  if (opts.gender) form.append('gender', opts.gender);
  if (opts.chart) form.append('chart', JSON.stringify(opts.chart));

  log('POST', url, '(clip)', clip.size, 'bytes', `${Number(opts.from || 0).toFixed(1)}s -> ${Number(opts.to || 0).toFixed(1)}s`);

  const budgetMs = Number(opts.uploadBudgetMs) > 0 ? Number(opts.uploadBudgetMs) : 0;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    let uploadDoneAt = 0;
    let sampleAt = 0;
    let sampleBytes = 0;
    let samples = 0;
    let settled = false;
    xhr.open('POST', url);
    // A sleeping Render instance takes the better part of a minute to answer, and
    // the upload itself can be slow on mobile data. One generous ceiling beats a
    // timeout that fires while the clip is still going up.
    xhr.timeout = 300000;
    xhr.responseType = 'text';

    const tick = opts.onTick ? setInterval(() => opts.onTick(Math.round((Date.now() - started) / 1000)), 1000) : null;
    const settle = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      if (tick) clearInterval(tick);
      fn(...args);
    };
    xhr.upload.onprogress = (e) => {      if (!e.lengthComputable || settled) return;
      if (opts.onProgress) opts.onProgress(e.loaded / e.total);
      if (!budgetMs) return;

      // Let the connection ramp up: the first samples of a mobile upload are
      // slow for reasons that have nothing to do with the file's size.
      const now = Date.now();
      if (now - started < 900) return;
      if (!sampleAt) { sampleAt = started; sampleBytes = 0; }
      samples += 1;
      if (samples < 2) return;
      const dt = now - sampleAt;
      const db = e.loaded - sampleBytes;
      sampleAt = now;
      sampleBytes = e.loaded;
      if (dt < 350 || db <= 0) return;

      const bps = (db * 1000) / dt;
      const projectedMs = (now - started) + ((e.total - e.loaded) / bps) * 1000;
      if (opts.onSpeed) opts.onSpeed({ bps, projectedMs });
      if (projectedMs > budgetMs) {
        log(`upload is ${(bps / 1024).toFixed(0)} KB/s — ${(e.total / 1048576).toFixed(1)} MB projected at ${Math.round(projectedMs / 1000)}s, over the ${Math.round(budgetMs / 1000)}s budget: sending key frames instead`);
        settled = true;
        if (tick) clearInterval(tick);
        try { xhr.abort(); } catch { /* already gone */ }
        const err = new Error('This connection cannot take the whole clip quickly');
        err.slowUpload = true;
        err.bps = bps;
        reject(err);
      }
    };

    xhr.upload.onload = () => {
      uploadDoneAt = Date.now();
      const rate = uploadDoneAt - started;
      log(`upload ${(clip.size / 1048576).toFixed(2)} MB in ${rate}ms (${(clip.size / 1024 / (rate / 1000)).toFixed(0)} KB/s)`);
      if (opts.onUploaded) opts.onUploaded();
    };

    xhr.onload = settle(() => {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      log('response', xhr.status, `${Date.now() - started}ms`, uploadDoneAt ? `(upload ${uploadDoneAt - started}ms, server ${Date.now() - uploadDoneAt}ms)` : '');
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data);
      const msg = (data && data.error) || `Analysis failed (${xhr.status})`;
      return reject(new Error(xhr.status === 503 ? `${msg} — the service may not be fully set up yet.` : msg));
    });
    xhr.onerror = settle(() => reject(new TypeError('Could not reach the analysis service')));
    xhr.ontimeout = settle(() => reject(new Error(`The analysis service took too long (${Math.round((Date.now() - started) / 1000)}s)`)));
    xhr.onabort = settle(() => reject(new Error('The upload was cancelled')));
    xhr.send(form);
  });
}

/** Send extracted JPEG frames for the vision model to read. */
export function analyzeBody(frames, opts = {}) {
  const url = `${API_URL}/api/body-scan`;
  const bytes = frames.reduce((s, f) => s + f.size, 0);
  log('POST', url, '(frames)');
  log('frames', frames.length, 'totalBytes', bytes, frames.map((f) => f.size), 'gender', opts.gender);

  const form = new FormData();
  for (const frame of frames) form.append('frames', frame, frame.name);
  // The user's own answer about who the video is of. It decides the size chart
  // and which of the two measurement sheets is read, so it is never guessed.
  if (opts.gender) form.append('gender', opts.gender);
  // The store's own chart, when the scan arrived through their link. It only
  // ever CHOOSES a size: what is measured is measured from the video either way.
  if (opts.chart) form.append('chart', JSON.stringify(opts.chart));

  return request(url, { method: 'POST', body: form }, { timeoutMs: 180000, ...opts });
}

/**
 * Send measurements taken on the device. Only numbers cross the wire — a few
 * hundred bytes per frame instead of a JPEG, and no model runs server side.
 *
 * @param {{frames: object[], width: number, height: number, model?: string}} measured
 * @param {{timeoutMs?: number, onTick?: (s: number) => void, chart?: object}} [opts]
 */
export function analyzeGeometry(measured, opts = {}) {
  const url = `${API_URL}/api/body-scan`;
  const body = {
    source: 'pose',
    model: measured.model,
    gender: opts.gender || 'unsure',
    aspect: measured.width && measured.height ? measured.width / measured.height : undefined,
    // The store's own size chart, when the scan came in through their link. It
    // is the table this body is laid against; it is never used to measure
    // anybody, so it cannot flatter a clip into a size.
    chart: opts.chart || undefined,
    // A known-size object the user marked on one frame. It outweighs the head
    // ruler, and it belongs to that frame alone: the camera moves, so a scale
    // that was right one moment is not right the next.
    references: Array.isArray(opts.references) ? opts.references.slice(0, 4) : [],
    // What the person was wearing. A tape read over a hoodie is not a body
    // measurement until the fabric comes off it.
    clothing: opts.clothing && typeof opts.clothing === 'object' ? opts.clothing : {},
    frames: measured.frames.map((f) => ({
      // The time this frame was taken from, so a marked object finds its frame.
      t: f.t,
      landmarks: f.landmarks,
      visible: f.visible,
      view: f.view,
      // The turn angle, so the server can undo a three-quarter frame's
      // projection instead of reading it as a width.
      turn: f.turn,
      gender: f.gender,
      confidence: f.confidence,
      // Sharpness and how well lit the frame really was, read from its pixels
      // rather than handed over as a neutral constant.
      camera: f.camera,
      notes: f.notes,
      unmeasured: f.unmeasured,
    })),
  };
  log('POST', url, '(on-device geometry)');
  log('frames', body.frames.length, 'aspect', body.aspect, 'measuring-for', body.gender, 'model', body.model,
    'references', body.references.length,
    'store-chart', body.chart ? `${body.chart.name || 'unnamed'} (${body.chart.rows?.length || 0} sizes)` : 'none',
    body.frames.map((f) => `${f.view} conf=${Number(f.confidence).toFixed(2)} n=${Object.keys(f.landmarks).length}`));

  // A Render instance that has gone to sleep takes the better part of a minute
  // before it answers the first request; thirty seconds cut that off mid-wake and
  // reported a working service as broken. The numbers themselves are cheap.
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs: 120000, ...opts });
}
