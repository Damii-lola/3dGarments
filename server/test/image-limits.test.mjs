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
