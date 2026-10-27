// Render the test flat-lays (one per garment type) to PNGs for a Kaggle run:
//   node tools/garment_ml/chatgarment/photos.mjs [outdir=tools/garment_ml/chatgarment/out/photos]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CATALOG } from '../../../server/test/fixtures/catalog.js';
const sharp = createRequire(new URL('../../../server/package.json', import.meta.url))('sharp');
const out = process.argv[2] || new URL('./out/photos', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const [type, c] of Object.entries(CATALOG)) await sharp(Buffer.from(c.svg)).png().toFile(`${out}/flatlay_${type}.png`);
console.log(Object.keys(CATALOG).length, 'photos →', out);
