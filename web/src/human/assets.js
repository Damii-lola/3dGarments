/**
 * Loads the packed MakeHuman data produced by tools/human/build.py.
 * Everything is decoded once and shared by every Human instance.
 */
import brotliPromise from 'brotli-dec-wasm';

const BASE = `${import.meta.env.BASE_URL}human/`;
const TYPES = { float32: Float32Array, uint32: Uint32Array, uint16: Uint16Array, int16: Int16Array, uint8: Uint8Array };

let cache = null;

export const assetUrl = (file) => `${BASE}${file}`;

export function loadHumanAssets() {
  if (!cache) cache = load().catch((err) => { cache = null; throw err; });
  return cache;
}

async function load() {
  const [manifest, packed, brotli] = await Promise.all([
    fetch(assetUrl('human.json')).then(ok).then((r) => r.json()),
    fetch(assetUrl('human.bin')).then(ok).then((r) => r.arrayBuffer()),
    brotliPromise,
  ]);
  const raw = brotli.decompress(new Uint8Array(packed));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const s = {};
  for (const [name, [offset, length, dtype]] of Object.entries(manifest.sections)) {
    s[name] = new TYPES[dtype](buf, offset, length);
  }
  return { manifest, sections: s, targets: decodeTargets(manifest, s) };
}

function ok(res) {
  if (!res.ok) throw new Error(`Could not load the 3D human (${res.status} ${res.url})`);
  return res;
}

/** Undo the byte-plane shuffle: → one Map name → { index: Uint16Array, delta: Int16Array (xyz) }. */
function decodeTargets(manifest, s) {
  const total = manifest.targets.reduce((a, [, n]) => a + n, 0);
  const g = s['targets.gaps'], v = s['targets.vals'];
  const gaps = new Uint16Array(total);
  for (let i = 0; i < total; i++) gaps[i] = g[i] | (g[total + i] << 8);
  const vals = new Int16Array(total * 3);
  for (let c = 0; c < 3; c++) {
    const lo = 2 * c * total, hi = lo + total;
    for (let i = 0; i < total; i++) vals[i * 3 + c] = (v[lo + i] | (v[hi + i] << 8)) << 16 >> 16;
  }
  const out = new Map();
  let at = 0;
  for (const [name, n] of manifest.targets) {
    const index = new Uint16Array(n);
    let vi = -1;
    for (let i = 0; i < n; i++) { vi += gaps[at + i] + 1; index[i] = vi; }
    out.set(name, { index, delta: vals.subarray(at * 3, (at + n) * 3) });
    at += n;
  }
  return out;
}
