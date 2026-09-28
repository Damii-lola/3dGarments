import { API_URL } from './config.js';
import { accessToken } from './auth.js';

let slowHandler = () => {};
/** Called with true/false while a request takes long (Render free tier cold start). */
export const onSlow = (fn) => { slowHandler = fn; };

export async function api(path, { method = 'GET', body, form, timeout = 90_000 } = {}) {
  const token = await accessToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const slow = setTimeout(() => slowHandler(true), 2500);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method, headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('The server took too long to respond. Try again.');
    if (err instanceof TypeError) throw new Error('Cannot reach the 3dGarments server.');
    throw err;
  } finally {
    clearTimeout(slow);
    slowHandler(false);
  }
}
