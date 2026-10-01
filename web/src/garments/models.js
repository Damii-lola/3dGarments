/**
 * The photo models' runtime, files and sessions, shared by parse.js / pose.js / clean.js.
 *
 * Runtime: onnxruntime-web on the CPU (wasm); on the GPU (WebGPU, opt-in: ?gpu=1) the clothes parser runs in a
 * fraction of a second instead of seconds. One build is loaded per page; `ort` (a live binding)
 * is that build once any session exists, so callers make their tensors after awaiting their session.
 *
 * Files: a model is downloaded once and kept in Cache Storage ('3dg-models'): the next visit (and the next try-on)
 * reads it from disk. The app prefetches what every try-on needs (prefetchModels) right after boot, so it's
 * already here when the user picks a photo.
 */
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import gpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

export let ort = null;
const CACHE = '3dg-models';
const bytes = new Map();      // url → Promise<Uint8Array>
const sessions = new Map();   // url → Promise<InferenceSession>

let backend = null;           // Promise<'webgpu' | 'wasm'>

/** a dynamic import, tried again on a dropped connection (a failed chunk load must not break every later try-on) */
async function load(importer, tries = 3) {
  for (let k = 1; ; k++) {
    try { return await importer(); } catch (e) {
      if (k >= tries) throw e;
      await new Promise((r) => setTimeout(r, 800 * k));
    }
  }
}

/** wasm (the CPU) by default; WebGPU with ?gpu=1 (or globalThis.__webgpu) where there's an adapter with f16 shaders
 *  — not yet the default: not yet verified on real phones (a crashed GPU process would take the 3D view with it) */
export function runtime() {
  backend ||= (async () => {
    const threads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const off = !(globalThis.__webgpu || /[?&]gpu=1\b/.test(globalThis.location?.search || ''));
    let adapter = null;
    if (!off && navigator.gpu) adapter = await navigator.gpu.requestAdapter().catch(() => null);
    // (the GPU models are fp16: an adapter without f16 shaders — many phones — stays on the CPU)
    if (adapter && (adapter.features?.has('shader-f16') || globalThis.__anyWebGPU)) {   // (__anyWebGPU: tests, with fp32 models)
      try {
        const m = await load(() => import('onnxruntime-web/webgpu'));
        m.env.wasm.wasmPaths = { wasm: gpuWasmUrl };
        m.env.wasm.numThreads = threads;
        ort = m;
        return 'webgpu';
      } catch (e) { console.warn('WebGPU runtime unavailable:', e.message); }
    }
    const m = await load(() => import('onnxruntime-web/wasm'));
    m.env.wasm.wasmPaths = { wasm: wasmUrl };
    m.env.wasm.numThreads = threads;
    ort = m;
    return 'wasm';
  })();
  // a runtime that couldn't load is asked for again next time (not remembered as failed)
  backend.catch(() => { backend = null; });
  return backend;
}

/** the model file's bytes: Cache Storage, else the network (and then cached) */
export function modelBytes(url) {
  if (!bytes.has(url)) {
    const p = (async () => {
      let cache = null;
      try { cache = await caches.open(CACHE); } catch { /* no Cache Storage (insecure origin, private mode) */ }
      let res = cache && (await cache.match(url).catch(() => null));
      if (!res) {
        for (let k = 1; ; k++) {                       // (a dropped connection is tried again)
          try { res = await fetch(url); if (res.ok || res.status < 500) break; } catch (e) { if (k >= 3) throw e; }
          if (k >= 3) break;
          await new Promise((r) => setTimeout(r, 1000 * k));
        }
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

/**
 * an onnxruntime-web session (created once)
 * @param url    the model, or { webgpu: url, wasm: url } — a model per runtime (fp16 for the GPU, int8 for the CPU)
 * @param opts   { gpu: false } keeps this model on the CPU even with WebGPU (int8 models: their quantised ops
 *               would bounce between GPU and CPU)
 */
export function modelSession(url, { gpu = true, ...opts } = {}) {
  const key = JSON.stringify(url) + gpu;
  if (!sessions.has(key)) {
    const p = runtime().then(async (rt) => {
      const onGpu = rt === 'webgpu' && gpu;
      const u = typeof url === 'string' ? url : onGpu ? url.webgpu : url.wasm;
      const make = async (uu, eps) => ort.InferenceSession.create(await modelBytes(uu), { executionProviders: eps, graphOptimizationLevel: 'all', ...opts });
      if (!onGpu) return make(u, ['wasm']);
      // a GPU that can't build it (a missing feature, a driver bug): the CPU model instead
      return make(u, ['webgpu', 'wasm']).catch((e) => {
        console.warn('WebGPU session failed, using the CPU:', e.message);
        return make(typeof url === 'string' ? url : url.wasm, ['wasm']);
      });
    });
    p.catch(() => sessions.delete(key));
    sessions.set(key, p);
  }
  return sessions.get(key);
}

/** the given models ([url | { webgpu, wasm }, sessionOpts]) downloaded and their sessions made, one at a time, while
 *  the page is idle — a try-on then starts with everything ready */
export async function prefetchModels(list) {
  const idle = () => new Promise((r) => (globalThis.requestIdleCallback || ((f) => setTimeout(f, 200)))(r, { timeout: 3000 }));
  for (const [url, opts] of list) {
    await idle();
    await modelSession(url, opts).catch((e) => console.warn('prefetch failed:', e.message));
  }
}
