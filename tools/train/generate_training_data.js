/**
 * Automated AI Training Data Generator
 *
 * Runs headless via Playwright against the training page (/train/).
 * Iterates through body proportion combinations, renders each at all 4
 * angles, captures the canvas as PNG, and saves exact ground-truth
 * measurements (bust, waist, hips, thighs, weight, BMI) alongside.
 *
 * Output: training_dataset.json — ready to feed into PyTorch/TensorFlow.
 *
 * Usage:
 *   1. Start the web dev server: cd web && npm run dev
 *   2. Run this: node tools/train/generate_training_data.js
 *
 * Requirements:
 *   npx playwright install chromium
 *   node >= 20
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/train/';

// Body proportion sweep ranges
const SEXES = ['female', 'male'];
const WIDTHS_CM = { female: [30, 34, 38, 42], male: [38, 44, 50, 52] };
const HEIGHTS_IN = { female: [58, 64, 68, 72, 78], male: [62, 68, 72, 76, 82] };
const FATS = [-0.4, 0, 0.5, 1.0, 1.5];
const MUSCLES = [-1, -0.5, 0, 0.5, 0.8];
const ABDOMENS = ['flat', 'soft', 'toned', 'curved'];

const ANGLES = ['front', 'three', 'side', 'back'];

/** Wait for the page to be ready. */
async function waitForReady(page) {
  await page.waitForFunction(() => window.__train && window.__train.mc, { timeout: 30000 });
}

/** Set a sex on the model. */
async function setSex(page, sex) {
  await page.click(`.sex-btn[data-sex="${sex}"]`);
  await page.waitForTimeout(500);
}

/** Set a slider value. */
async function setSlider(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value });
  await page.waitForTimeout(300);
}

/** Select an abdomen option. */
async function selectAbdomen(page, value) {
  await page.selectOption('#abdomen-select', value);
  await page.waitForTimeout(300);
}

/** Click a view button to switch angle. */
async function setView(page, angle) {
  await page.click(`.view-btn[data-angle="${angle}"]`);
  await page.waitForTimeout(400);
}

/** Capture the canvas as a PNG data URL. */
async function captureCanvas(page) {
  return await page.evaluate(() => {
    const canvas = document.getElementById('train-canvas');
    return canvas.toDataURL('image/png');
  });
}

/** Click capture button for current angle. */
async function captureAngle(page) {
  await page.click('#capture-angle');
  await page.waitForTimeout(1200); // let render complete
}

/** Read ground truth from the page. */
async function readGroundTruth(page) {
  return await page.evaluate(() => {
    const gt = {};
    gt.height = parseFloat(document.getElementById('gt-height').textContent.replace(' in', ''));
    gt.weight = parseFloat(document.getElementById('gt-weight').textContent.replace(' kg', ''));
    gt.bmi = parseFloat(document.getElementById('gt-bmi').textContent);
    gt.bust = parseFloat(document.getElementById('gt-bust').textContent.replace(' cm', ''));
    gt.waist = parseFloat(document.getElementById('gt-waist').textContent.replace(' cm', ''));
    gt.hips = parseFloat(document.getElementById('gt-hips').textContent.replace(' cm', ''));
    gt.thigh = parseFloat(document.getElementById('gt-thigh').textContent.replace(' cm', ''));
    gt.underbust = parseFloat(document.getElementById('gt-underbust').textContent.replace(' cm', ''));
    return gt;
  });
}

/** Read current proportions from the page. */
async function readProportions(page) {
  return await page.evaluate(() => {
    return {
      sex: document.querySelector('.sex-btn.active').dataset.sex,
      width: parseFloat(document.getElementById('width-slider').value),
      height: parseFloat(document.getElementById('height-slider').value),
      fat: parseFloat(document.getElementById('fat-slider').value),
      muscle: parseFloat(document.getElementById('muscle-slider').value),
      abdomen: document.getElementById('abdomen-select').value,
      waist: parseFloat(document.getElementById('waist-slider').value),
      bust: parseFloat(document.getElementById('bust-slider').value),
      chest: parseFloat(document.getElementById('chest-slider').value),
      glutes: parseFloat(document.getElementById('glutes-slider').value),
      hips: parseFloat(document.getElementById('hips-slider').value),
      thighs: parseFloat(document.getElementById('thighs-slider').value),
    };
  });
}

/** Clear captured angles by resetting. */
async function resetCaptures(page) {
  // Reload page to clear captures
  await page.reload();
  await waitForReady(page);
}

/** Main generation loop. */
async function generate() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('Opening training page…');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await waitForReady(page);

  const samples = [];
  let count = 0;
  const total = SEXES.length * WIDTHS_CM.female.length * HEIGHTS_IN.female.length * FATS.length * MUSCLES.length * ABDOMENS.length * 2; // rough estimate

  for (const sex of SEXES) {
    await setSex(page, sex);
    const widths = WIDTHS_CM[sex];
    const heights = HEIGHTS_IN[sex];

    for (const width of widths) {
      for (const height of heights) {
        for (const fat of FATS) {
          for (const muscle of MUSCLES) {
            for (const abdomen of ABDOMENS) {
              // Set proportions
              await setSlider(page, 'width-slider', width);
              await setSlider(page, 'height-slider', height);
              await setSlider(page, 'fat-slider', fat);
              await setSlider(page, 'muscle-slider', muscle);
              await selectAbdomen(page, abdomen);
              await page.waitForTimeout(400);

              // Read proportions + ground truth
              const props = await readProportions(page);
              const truth = await readGroundTruth(page);

              // Capture all 4 angles
              const images = {};
              for (const angle of ANGLES) {
                await setView(page, angle);
                await captureAngle(page);
                images[angle] = await captureCanvas(page);
              }

              samples.push({
                id: `sample_${count++}`,
                proportions: props,
                measurements: truth,
                images, // { angle: dataUrl }
                createdAt: new Date().toISOString(),
              });

              if (count % 10 === 0) {
                console.log(`Progress: ${count} samples generated (${sex}, w=${width}, h=${height}, f=${fat}, m=${muscle}, a=${abdomen})`);
              }
            }
          }
        }
      }
    }
  }

  await browser.close();

  const dataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: samples.length,
    angles: ANGLES,
    samples,
  };

  const fs = await import('node:fs');
  fs.writeFileSync('training_dataset.json', JSON.stringify(dataset, null, 2));
  console.log(`\nDone! Generated ${samples.length} samples → training_dataset.json`);
  console.log('File size:', (fs.statSync('training_dataset.json').size / 1024 / 1024).toFixed(2), 'MB');
}

generate().catch((e) => {
  console.error('Generation failed:', e);
  process.exit(1);
});
