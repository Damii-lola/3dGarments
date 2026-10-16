/**
 * Send recorded frames to the body-scan API and get back the analysis
 * (gender, clothing density, body measurements, size + proportions).
 *
 * A free Render instance can take ~50s to wake, so allow a generous timeout.
 * Everything is logged to the console with a [3dg:api] prefix so a stuck request
 * is easy to spot.
 */
import { API_URL } from '../services/config.js';

const log = (...args) => console.log('[3dg:api]', ...args);

export async function analyzeBody(frames, { timeoutMs = 180000, onTick } = {}) {
  const url = `${API_URL}/api/body-scan`;
  const bytes = frames.reduce((s, f) => s + f.size, 0);
  log('POST', url);
  log('frames', frames.length, 'totalBytes', bytes, frames.map((f) => f.size));

  const form = new FormData();
  for (const frame of frames) form.append('frames', frame, frame.name);

  const ctl = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const tick = onTick ? setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1000) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: ctl.signal,
    });
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
