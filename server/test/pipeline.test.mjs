// node --test test/  — runs the real segmentation + measurement pipeline on the synthetic samples
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SAMPLE_SVGS } from './fixtures/samples.js';
import { processGarmentPixels } from '../src/shared/silhouette.js';

const OUT = process.env.TEST_OUT;
if (OUT) mkdirSync(OUT, { recursive: true });

async function run(key) {
  const { data, info } = await sharp(Buffer.from(SAMPLE_SVGS[key].svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t0 = performance.now();
  const r = processGarmentPixels(data, info.width, info.height);
  const ms = performance.now() - t0;
  if (OUT) {
    await sharp(Buffer.from(r.cutout.rgba.buffer), { raw: { width: r.cutout.width, height: r.cutout.height, channels: 4 } }).png().toFile(`${OUT}/${key}.png`);
    writeFileSync(`${OUT}/${key}.json`, JSON.stringify(r.geometry, null, 1));
  }
  return { ...r, ms };
}

test('tee → top with two sleeves', async () => {
  const { geometry: g, cutout, ms } = await run('tee');
  console.log('tee', g.guess, g.segmentation, g.armpit, g.sleeves, `${ms.toFixed(0)}ms`, cutout.width, cutout.height);
  assert.equal(g.segmentation.method, 'flood');
  assert.equal(g.guess, 'top');
  assert.ok(g.sleeves.left && g.sleeves.right, 'both sleeves found');
  assert.ok(g.sleeves.left.dir[0] < 0 && g.sleeves.right.dir[0] > 0, 'sleeves point outward');
  assert.ok(g.armpit > g.top && g.armpit < g.top + (g.bottom - g.top) * 0.45);
});

test('jeans → pants with crotch', async () => {
  const { geometry: g, ms } = await run('jeans');
  console.log('jeans', g.guess, g.segmentation, g.crotch, `${ms.toFixed(0)}ms`);
  assert.equal(g.guess, 'pants');
  assert.ok(g.crotch !== null);
  const legRows = g.rows.filter((r) => r.legs);
  assert.ok(legRows.length > 20);
});

test('dress → dress, no sleeves', async () => {
  const { geometry: g, ms } = await run('dress');
  console.log('dress', g.guess, g.segmentation, g.armpit, `${ms.toFixed(0)}ms`);
  assert.equal(g.guess, 'dress');
  assert.equal(g.crotch, null);
});
