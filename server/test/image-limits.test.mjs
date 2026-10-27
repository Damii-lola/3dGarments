// The pixel ceiling is what stops a small compressed file from asking sharp for
// gigabytes of decoded memory. Tested with a tiny ceiling so the test itself does
// not have to allocate the 50-megapixel image it is guarding against.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MAX_INPUT_PIXELS = '10000';
const { inputSharp, pixelLimitMessage, MAX_INPUT_PIXELS } = await import('../src/lib/image.js');
const sharp = (await import('sharp')).default;

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } }).png().toBuffer();

test('MAX_INPUT_PIXELS comes from the environment', () => {
  assert.equal(MAX_INPUT_PIXELS, 10000);
});

test('a picture under the ceiling decodes', async () => {
  const { info } = await inputSharp(await png(20, 20)).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 20);
  assert.equal(info.height, 20);
});

test('a picture over the ceiling is refused before any pixels are decoded', async () => {
  const bomb = await png(200, 200); // 40 000 pixels, four times the limit
  await assert.rejects(inputSharp(bomb).toBuffer(), /pixel limit/i);
});

test('the refusal reads like a rejection, not a crash', () => {
  const err = new Error('Input image exceeds pixel limit');
  assert.match(pixelLimitMessage(err), /too large to process/);
  assert.match(pixelLimitMessage(err), /megapixels/);
  assert.equal(pixelLimitMessage(new Error('Input buffer contains unsupported image format')), null);
  assert.equal(pixelLimitMessage(null), null);
});

// A dimension bomb: a few dozen bytes whose IHDR claims an enormous canvas.
// sharp must reject on the header alone, before allocating anything, and the
// friendly message must still be produced (this is the path a hostile upload
// actually takes).
function crc32(buf) {
  let c = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let x = i;
    for (let k = 0; k < 8; k++) x = (x & 1) ? (0xedb88320 ^ (x >>> 1)) : (x >>> 1);
    table[i] = x;
  }
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngHeader(width, height) {
  // Start from a real 1x1 PNG so every other chunk (IDAT/IEND) stays valid;
  // only the IHDR dimensions (and its CRC) change.
  const base = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de' +
    '0000000c4944415408d763f8cfc000000301010018dd8db40000000049454e44ae426082',
    'hex'
  );
  const out = Buffer.from(base);
  out.writeUInt32BE(width, 16);
  out.writeUInt32BE(height, 20);
  const crc = crc32(out.slice(12, 29)); // type (IHDR) + 13 bytes of data
  out.writeUInt32BE(crc, 29);
  return out;
}

test('a dimension bomb (tiny file, huge declared canvas) is refused before decoding', async () => {
  const bomb = pngHeader(50000, 50000); // 2.5 gigapixels, > 50 MP ceiling
  assert.ok(bomb.length < 200, `bomb must stay tiny (got ${bomb.length} bytes)`);
  await assert.rejects(inputSharp(bomb).toBuffer(), /pixel limit/i);
  let err;
  try { await inputSharp(bomb).toBuffer(); } catch (e) { err = e; }
  assert.match(pixelLimitMessage(err), /too large to process/);
});
