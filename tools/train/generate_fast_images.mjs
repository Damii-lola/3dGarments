/**
 * FAST AI Training Data Generator (Image-Based, RESUMABLE)
 * ===============================================
 * Uses Playwright but loads the page ONCE and captures via JS evaluation.
 * Saves after every sample — if your laptop dies, just re-run and it picks
 * up exactly where it left off.
 *
 * Usage:
 *   cd C:\Users\SIFON\3dGarments
 *   npm install playwright
 *   npx playwright install chromium
 *   node tools/train/generate_fast_images.mjs
 *
 * Output: training_dataset_images.json
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const BASE_URL = 'http://localhost:5173/train/';
const OUT_FILE = 'training_dataset_images.json';
const IMAGE_SIZE = 224;

// Sweep ranges
const SEXES = ['female', 'male'];
const WIDTHS_CM = { female: [30, 34, 38, 42], male: [38, 44, 50, 52] };
const HEIGHTS_IN = { female: [58, 64, 68, 72, 78], male: [62, 68, 72, 76, 82] };
const FATS = [-0.4, 0, 0.5, 1.0];
const MUSCLES = [-1, -0.5, 0, 0.5];
const ABDOMENS = ['flat', 'soft', 'toned', 'curved'];
const ANGLES = ['front', 'three', 'side', 'back'];

// --- Resume: load existing samples if file exists ---
let samples = [];
let count = 0;
let startTime = Date.now();

if (existsSync(OUT_FILE)) {
  try {
    const existing = JSON.parse(readFileSync(OUT_FILE, 'utf-8'));
    samples = existing.samples || [];
    count = samples.length;
    console.log(`Resuming from ${count} existing samples...`);
  } catch (e) {
    console.log(`Could not read existing file, starting fresh: ${e.message}`);
  }
}

// Build a set of already-completed combinations for fast lookup
const doneSet = new Set();
for (const s of samples) {
  const p = s.proportions;
  const key = `${p.sex}|${p.width}|${p.height}|${p.fat}|${p.muscle}|${p.abdomen}`;
  doneSet.add(key);
}

console.log(`Already completed: ${count} samples. Starting from where we left off...\n`);

async function waitForReady(page) {
  await page.waitForFunction(() => window.__train && window.__train.mc, { timeout: 60000 });
  await page.waitForTimeout(1500);
}

/** Set all sliders at once via JS evaluation. */
async function setProportions(page, sex, width, height, fat, muscle, abdomen) {
  await page.evaluate(({ sex, width, height, fat, muscle, abdomen }) => {
    const sexBtn = document.querySelector(`.sex-btn[data-sex="${sex}"]`);
    if (sexBtn) sexBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    setSlider('width-slider', width);
    setSlider('height-slider', height);
    setSlider('fat-slider', fat);
    setSlider('muscle-slider', muscle);

    const sel = document.getElementById('abdomen-select');
    if (sel) { sel.value = abdomen; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { sex, width, height, fat, muscle, abdomen });

  await page.waitForTimeout(500);
}

/** Switch view angle. */
async function setView(page, angle) {
  await page.evaluate((a) => {
    const btn = document.querySelector(`.view-btn[data-angle="${a}"]`);
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, angle);
  await page.waitForTimeout(400);
}

/** Capture canvas as PNG data URL. */
async function captureAngle(page) {
  return await page.evaluate(() => {
    const canvas = document.getElementById('train-canvas');
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  });
}

/** Read ground truth from page. */
async function readGroundTruth(page) {
  return await page.evaluate(() => {
    const gt = {};
    const getText = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent : '';
    };
    gt.height = parseFloat(getText('gt-height').replace(' in', '')) || 0;
    gt.weight = parseFloat(getText('gt-weight').replace(' kg', '')) || 0;
    gt.bmi = parseFloat(getText('gt-bmi')) || 0;
    gt.bust = parseFloat(getText('gt-bust').replace(' cm', '')) || 0;
    gt.waist = parseFloat(getText('gt-waist').replace(' cm', '')) || 0;
    gt.hips = parseFloat(getText('gt-hips').replace(' cm', '')) || 0;
    gt.thigh = parseFloat(getText('gt-thigh').replace(' cm', '')) || 0;
    gt.underbust = parseFloat(getText('gt-underbust').replace(' cm', '')) || 0;
    return gt;
  });
}

/** Read current proportions. */
async function readProportions(page) {
  return await page.evaluate(() => {
    const sexBtn = document.querySelector('.sex-btn.active');
    return {
      sex: sexBtn ? sexBtn.dataset.sex : 'female',
      width: parseFloat(document.getElementById('width-slider')?.value || 0),
      height: parseFloat(document.getElementById('height-slider')?.value || 0),
      fat: parseFloat(document.getElementById('fat-slider')?.value || 0),
      muscle: parseFloat(document.getElementById('muscle-slider')?.value || 0),
      abdomen: document.getElementById('abdomen-select')?.value || 'flat',
      waist: parseFloat(document.getElementById('waist-slider')?.value || 0),
      bust: parseFloat(document.getElementById('bust-slider')?.value || 0),
      chest: parseFloat(document.getElementById('chest-slider')?.value || 0),
      glutes: parseFloat(document.getElementById('glutes-slider')?.value || 0),
      hips: parseFloat(document.getElementById('hips-slider')?.value || 0),
      thighs: parseFloat(document.getElementById('thighs-slider')?.value || 0),
    };
  });
}

/** Save progress to disk after every sample. */
function saveProgress() {
  const dataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: samples.length,
    angles: ANGLES,
    samples,
  };
  writeFileSync(OUT_FILE, JSON.stringify(dataset, null, 2));
}

async function generate() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: IMAGE_SIZE, height: IMAGE_SIZE });

  console.log('Opening training page…');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  console.log('Page ready. Starting generation…\n');

  for (const sex of SEXES) {
    const widths = WIDTHS_CM[sex];
    const heights = HEIGHTS_IN[sex];

    for (const width of widths) {
      for (const height of heights) {
        for (const fat of FATS) {
          for (const muscle of MUSCLES) {
            for (const abdomen of ABDOMENS) {
              // Skip if already done
              const key = `${sex}|${width}|${height}|${fat}|${muscle}|${abdomen}`;
              if (doneSet.has(key)) continue;

              // Set proportions
              await setProportions(page, sex, width, height, fat, muscle, abdomen);

              // Read props + ground truth
              const props = await readProportions(page);
              const truth = await readGroundTruth(page);

              // Capture all 4 angles
              const images = {};
              for (const angle of ANGLES) {
                await setView(page, angle);
                images[angle] = await captureAngle(page);
              }

              samples.push({
                id: `sample_${count++}`,
                proportions: props,
                measurements: truth,
                images,
                createdAt: new Date().toISOString(),
              });

              // Save after EVERY sample so we never lose progress
              saveProgress();

              if (count % 10 === 0) {
                const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
                console.log(`${count} samples | ${elapsed} min | ${sex} w=${width} h=${height} f=${fat} m=${muscle} a=${abdomen}`);
              }
            }
          }
        }
      }
    }
  }

  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nDONE! ${samples.length} total samples → ${OUT_FILE}`);
  console.log(`New samples this run: ${count - (samples.length - count)}`);
  console.log(`Next: python tools/train/train_model_images.py --dataset ${OUT_FILE} --device cuda`);
}

generate().catch((e) => {
  console.error('Generation failed:', e);
  // Save what we have before exiting
  try {
    saveProgress();
    console.log('Progress saved before exit.');
  } catch { /* ignore */ }
  process.exit(1);
});
