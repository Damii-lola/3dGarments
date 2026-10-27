import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentGarment } from '../src/shared/silhouette.js';

/** a navy shirt body on a cream sheet with a CREAM stripe across it that is joined to the backdrop through a deep neck notch */
function striped() {
  const w = 400, h = 500, rgba = new Uint8ClampedArray(w * h * 4);
  const bg = [226, 224, 219];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = bg;
    const inBody = x >= 100 && x < 300 && y >= 60 && y < 440;
    if (inBody) c = [30, 42, 86];
    if (inBody && y >= 200 && y < 228) c = bg;                       // cream stripe, same colour as the sheet
    if (inBody && x >= 185 && x < 215 && y < 200) c = bg;            // narrow neck slit that runs down into the stripe
    const o = (y * w + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  return { w, h, rgba };
}

test('a stripe the colour of the backdrop does not cut the garment in two', () => {
  const { w, h, rgba } = striped();
  const { mask } = segmentGarment(rgba, w, h);
  assert.equal(mask[214 * w + 130], 1, 'the stripe (left of the slit) is part of the garment');
  assert.equal(mask[214 * w + 270], 1, 'the stripe (right of the slit) is part of the garment');
  assert.equal(mask[300 * w + 200], 1, 'the body below the stripe is garment');
  assert.equal(mask[30 * w + 30], 0, 'the backdrop is not');
});
