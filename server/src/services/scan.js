/** Runs scans in a persistent worker thread, one at a time (a scan is CPU-heavy; this protects the API and small hosts). */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError } from '../lib/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let worker = null, seq = 0, chain = Promise.resolve();
const waiting = new Map();

function start() {
  worker = new Worker(path.join(here, 'scan.worker.js'));
  worker.on('message', (m) => { const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); m.ok ? w.resolve(m) : w.reject(new HttpError(422, m.error)); });
  const fail = (err) => { for (const [, w] of waiting) w.reject(new HttpError(500, `scan worker stopped: ${err?.message || 'exited'}`)); waiting.clear(); worker = null; };
  worker.on('error', fail); worker.on('exit', (code) => { if (code !== 0) fail(new Error(`exit code ${code}`)); else worker = null; });
}

/**
 * @param job { front: Buffer, back?: Buffer, template: {pos,nrm,uv,index}, size?: number, format?: 'webp'|'png' }
 * @returns { image: Buffer, mime, report }
 */
export function runScan(job, timeoutMs = 120_000) {
  const run = () => new Promise((resolve, reject) => {
    if (!worker) start();
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); worker?.terminate(); worker = null; reject(new HttpError(504, 'The scan took too long')); }, timeoutMs);
    waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    worker.postMessage({ id, ...job, front: new Uint8Array(job.front), back: job.back ? new Uint8Array(job.back) : null });
  });
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
