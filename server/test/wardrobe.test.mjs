// Wardrobe logic on real pipeline output: grouping photos into garments, views, zones, back fill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { SAMPLE_SVGS } from './fixtures/samples.js';
import { processGarmentPixels } from '../src/shared/silhouette.js';
import { colorSignature, colorDistance, buildItems, groupImages, photoFeatures } from '../src/shared/wardrobe.js';

async function photo(id, key) {
  const { data, info } = await sharp(Buffer.from(SAMPLE_SVGS[key].svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { cutout, geometry } = processGarmentPixels(data, info.width, info.height);
  return { id, geometry, signature: colorSignature(cutout.rgba, cutout.width, cutout.height) };
}

test('no AI: same garment twice → one item with front + back; others separate, right zones', async () => {
  const photos = await Promise.all([photo('a', 'tee'), photo('b', 'jeans'), photo('c', 'tee'), photo('d', 'dress')]);
  assert.ok(colorDistance(photos[0].signature, photos[2].signature) < 3, 'same photo, same colours');
  assert.ok(colorDistance(photos[0].signature, photos[1].signature) > 14, 'tee vs jeans differ');
  const items = buildItems(photos);
  assert.equal(items.length, 3);
  const tee = items.find((i) => i.images.includes('a'));
  assert.deepEqual(tee.images.sort(), ['a', 'c']);
  assert.equal(tee.category, 'top');
  assert.equal(tee.zone, 'upper');
  assert.ok(tee.views.front && tee.views.back && tee.views.front !== tee.views.back);
  assert.equal(tee.backFill, null, 'the back was photographed');
  const jeans = items.find((i) => i.images.includes('b'));
  assert.equal(jeans.category, 'pants');
  assert.equal(jeans.zone, 'lower');
  assert.equal(jeans.backFill, 'color', 'unknown pattern: back is the base colour, not a copy of the front');
  const dress = items.find((i) => i.images.includes('d'));
  assert.equal(dress.zone, 'full');
});

test('AI grouping is used when valid, ignored when it mixes zones or is not a partition', async () => {
  const photos = await Promise.all([photo('a', 'tee'), photo('b', 'jeans')]);
  photos[0].ai = { type: 'tshirt', view: 'front', pattern: 'solid', fit: 'loose', material: 'cotton', name: 'Blue tee' };
  photos[1].ai = { type: 'jeans', view: 'front' };
  const feats = photos.map(photoFeatures);
  assert.deepEqual(groupImages(feats, [[0, 1]]), [[0], [1]], 'mixed zones rejected');
  assert.deepEqual(groupImages(feats, [[0], [0, 1]]), [[0], [1]], 'not a partition rejected');
  assert.deepEqual(groupImages(feats, [[1], [0]]), [[1], [0]]);
  const items = buildItems(photos, [[0], [1]], ['Blue tee', 'Jeans']);
  assert.equal(items[0].name, 'Blue tee');
  assert.equal(items[0].fit, 'loose');
  assert.equal(items[0].backFill, 'mirror', 'a solid fabric repeats round the back');
  assert.equal(items[1].type, 'jeans');
});
