/**
 * Send recorded frames to the body-scan API and get back the analysis
 * (gender, clothing density, body measurements, size + proportions).
 *
 * A free Render instance can take ~50s to wake, so allow a generous timeout.
 */
import { API_URL } from '../services/config.js';

export async function analyzeBody(frames, { timeoutMs = 120000 } = {}) {
  const form = new FormData();
  for (const frame of frames) form.append('frames', frame, frame.name);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_URL}/api/body-scan`, {
      method: 'POST',
      body: form,
      signal: ctl.signal,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
      const msg = (data && data.error) || `Analysis failed (${res.status})`;
      throw new Error(res.status === 503 ? `${msg} — the service may not be fully set up yet.` : msg);
    }
    if (!data) throw new Error('The analysis service returned nothing');
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('The analysis service took too long. It may be waking up — please try again.');
    }
    if (e instanceof TypeError) {
      throw new Error('Could not reach the analysis service. Check your connection and try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
