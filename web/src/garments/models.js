/**
 * The photo models' files and sessions, shared by parse.js / pose.js / clean.js.
 *
 * A model file is downloaded once and kept in Cache Storage ('3dg-models'): the next visit (and the next try-on)
 * reads it from disk. The app prefetches the models every try-on needs (prefetchModels: the clothes parser and the
 * pose model) in idle time right after boot, so they're already here when the user picks a photo.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

export { ort };
const CACHE = '3dg-models';
const bytes = new Map();      // url → Promise<Uint8Array>
const sessions = new Map();   // url → Promise<InferenceSession>

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
}

/** the model file's bytes: Cache Storage, else the network (and then cached) */
export function modelBytes(url) {
  if (!bytes.has(url)) {
    const p = (async () => {
      let cache = null;
      try { cache = await caches.open(CACHE); } catch { /* no Cache Storage (insecure origin, private mode) */ }
      let res = cache && (await cache.match(url).catch(() => null));
      if (!res) {
        res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        if (cache) await cache.put(url, res.clone()).catch(() => {});
      }
      return new Uint8Array(await res.arrayBuffer());
    })();
    p.catch(() => bytes.delete(url));
    bytes.set(url, p);
  }
  return bytes.get(url);
}

/** an onnxruntime-web session for the model at url (created once) */
export function modelSession(url, opts = {}) {
  if (!sessions.has(url)) {
    setup();
    const p = modelBytes(url).then((b) => ort.InferenceSession.create(b, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', ...opts }));
    p.catch(() => sessions.delete(url));
    sessions.set(url, p);
  }
  return sessions.get(url);
}

/** download (not run) the given models while nothing else is going on */
export function prefetchModels(urls) {
  for (const u of urls) modelBytes(u).catch((e) => console.warn('prefetch failed:', e.message));
}
