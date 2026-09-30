/**
 * Sewing patterns: an NGL garment description (shared/ngl.js) → a GarmentCode pattern sized to a body,
 * built by py/pattern.py (Python, libraries in server/.pydeps — installed by scripts/pydeps.sh at npm install).
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PY = fileURLToPath(new URL('../../py/pattern.py', import.meta.url));
const PYDEPS = fileURLToPath(new URL('../../.pydeps', import.meta.url));

/** @returns pattern { panels, stitches, body } — see py/pattern.py */
export function buildPattern({ garment, design, spec, zone, overrides, sex = 'female', body = {} }) {
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-W', 'ignore', PY], {
      timeout: 60_000, maxBuffer: 8 << 20, env: { ...process.env, PYDEPS },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`pattern builder: ${String(stderr || err.message).trim().split('\n').pop().slice(0, 300)}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('pattern builder: unreadable output')); }
    });
    child.stdin.end(JSON.stringify({ garment, design, spec, zone, overrides, sex, body }));
  });
}
