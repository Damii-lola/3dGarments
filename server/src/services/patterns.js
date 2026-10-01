/**
 * Sewing patterns: an NGL garment description (shared/ngl.js) → a GarmentCode pattern sized to a body,
 * built by py/pattern.py (Python, libraries in server/.pydeps — installed by scripts/pydeps.sh at npm install).
 *
 * pattern.py runs inside one long-lived Python process (py/worker.py: a JSON line in, a JSON line out), started
 * with the server, so Python + numpy + GarmentCode are imported once instead of for every pattern. Requests queue
 * (one at a time: the instance is small). A worker that dies or hangs is replaced; while it can't start, the
 * one-shot process (pattern.py itself) is used.
 */
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const PY = fileURLToPath(new URL('../../py/pattern.py', import.meta.url));
const WORKER = fileURLToPath(new URL('../../py/worker.py', import.meta.url));
const PYDEPS = fileURLToPath(new URL('../../.pydeps', import.meta.url));
const TIMEOUT = 60_000;

function oneShot(req) {
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-W', 'ignore', PY], {
      timeout: TIMEOUT, maxBuffer: 8 << 20, env: { ...process.env, PYDEPS },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`pattern builder: ${String(stderr || err.message).trim().split('\n').pop().slice(0, 300)}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('pattern builder: unreadable output')); }
    });
    child.stdin.end(JSON.stringify(req));
  });
}

let worker = null;          // { child, ready: Promise, pending: [{ resolve, reject, timer }] }
let failures = 0;

function startWorker() {
  const child = spawn('python3', ['-W', 'ignore', WORKER], { env: { ...process.env, PYDEPS }, stdio: ['pipe', 'pipe', 'pipe'] });
  const w = { child, pending: [] };
  // an idle worker doesn't keep Node running (tests, scripts); one starting or with a request waiting does
  w.hold = (on) => { for (const s of [child, child.stdin, child.stdout, child.stderr]) on ? s.ref?.() : s.unref?.(); };
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  w.ready = new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.ready) { failures = 0; patternStats.worker = 'ready'; if (!w.pending.length) w.hold(false); return resolve(); }
      const p = w.pending.shift();
      if (!w.pending.length) w.hold(false);
      if (!p) return;
      clearTimeout(p.timer);
      note(Date.now() - p.t0, 'worker');
      if (msg.error) p.reject(new Error(`pattern builder: ${msg.error}`)); else p.resolve(msg.ok);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (worker === w) worker = null;
      patternStats.worker = `exited ${code}`;
      failures++;
      const err = new Error(`pattern builder stopped (${code}): ${stderr.trim().split('\n').pop()?.slice(0, 300) || ''}`);
      reject(err);
      for (const p of w.pending.splice(0)) { clearTimeout(p.timer); p.reject(err); }
    });
  });
  w.ready.catch(() => {});
  return w;
}

/** for /health: is the worker up, and how long the last patterns took (ms) */
export const patternStats = { worker: 'off', last: [] };
const note = (ms, how) => { patternStats.last = [...patternStats.last.slice(-9), `${how}:${ms}`]; };

/** start the worker now (the first pattern then doesn't wait for Python to start) */
export function warmPatterns() {
  if (!worker && failures < 3) { worker = startWorker(); patternStats.worker = 'starting'; }
  return worker?.ready;
}

// the same request again (a retry, the same photo worn again): the same pattern, from memory
const memo = new Map();
const MEMO_MAX = 200;

/** @returns pattern { panels, stitches, body } — see py/pattern.py */
export async function buildPattern(args) {
  const key = JSON.stringify(args);
  if (memo.has(key)) { const v = memo.get(key); memo.delete(key); memo.set(key, v); return v; }
  const p = build(args);
  memo.set(key, p);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  p.catch(() => memo.delete(key));
  return p;
}

async function build({ garment, design, spec, zone, overrides, sex = 'female', body = {} }) {
  const req = { garment, design, spec, zone, overrides, sex, body };
  warmPatterns();
  const w = worker, t0 = Date.now();
  const shot = () => oneShot(req).finally(() => note(Date.now() - t0, 'oneshot'));
  if (!w) return shot();
  try { await w.ready; } catch { return shot(); }
  return new Promise((resolve, reject) => {
    const p = {
      resolve, reject, t0: Date.now(),
      // a hung build: the worker is replaced (the next request starts a fresh one)
      timer: setTimeout(() => { reject(new Error('pattern builder: timed out')); w.child.kill('SIGKILL'); }, TIMEOUT),
    };
    w.pending.push(p);
    w.hold(true);
    w.child.stdin.write(`${JSON.stringify(req)}\n`);
  });
}
