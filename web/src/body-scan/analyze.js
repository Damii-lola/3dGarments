/**
 * Talk to the body-scan API and get back the analysis (body measurements, size
 * + proportions).
 *
 * Two ways in, one engine out:
 *   analyzeBody()     — JPEG frames for the vision model (fallback path).
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

  return request(url, { method: 'POST', body: form }, { timeoutMs: 180000, ...opts });
}

/**
 * Send measurements taken on the device. Only numbers cross the wire — a few
 * hundred bytes per frame instead of a JPEG, and no model runs server side.
 *
 * @param {{frames: object[], width: number, height: number, model?: string}} measured
 * @param {{timeoutMs?: number, onTick?: (s: number) => void}} [opts]
 */
export function analyzeGeometry(measured, opts = {}) {
  const url = `${API_URL}/api/body-scan`;
  const body = {
    source: 'pose',
    model: measured.model,
    gender: opts.gender || 'unsure',
    aspect: measured.width && measured.height ? measured.width / measured.height : undefined,
    frames: measured.frames.map((f) => ({
      landmarks: f.landmarks,
      visible: f.visible,
      view: f.view,
      // The turn angle, so the server can undo a three-quarter frame's
      // projection instead of reading it as a width.
      turn: f.turn,
      gender: f.gender,
      confidence: f.confidence,
      notes: f.notes,
      unmeasured: f.unmeasured,
    })),
  };
  log('POST', url, '(on-device geometry)');
  log('frames', body.frames.length, 'aspect', body.aspect, 'measuring-for', body.gender, 'model', body.model,
    body.frames.map((f) => `${f.view} conf=${Number(f.confidence).toFixed(2)} n=${Object.keys(f.landmarks).length}`));

  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs: 30000, ...opts });
}
