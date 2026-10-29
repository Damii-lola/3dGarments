/**
 * Fast AI Training Data Generator
 * ================================
 * Headless Three.js rendering — NO browser, NO Playwright, NO screenshots.
 * Renders the 3D body model directly in Node.js and computes exact ground-truth
 * measurements. ~100x faster than the Playwright version.
 *
 * Usage:
 *   cd C:\Users\SIFON\3dGarments
 *   npm install canvas
 *   node tools/train/generate_fast.mjs
 *
 * Output: training_dataset.json (ready for tools/train/train_model.py)
 */

import * as THREE from 'three';
import { createCanvas } from 'canvas';
import { Human } from '../web/src/human/human.js';
import { ModelController } from '../web/src/human/body.js';
import { composePose } from '../web/src/human/poses.js';
import { writeFileSync, existsSync, statSync } from 'node:fs';

const OUT_FILE = 'training_dataset.json';
const IMAGE_SIZE = 224;

// Sweep ranges — adjust to make it faster or slower
const SEXES = ['female', 'male'];
const WIDTHS_CM = { female: [30, 34, 38, 42], male: [38, 44, 50, 52] };
const HEIGHTS_IN = { female: [58, 64, 68, 72, 78], male: [62, 68, 72, 76, 82] };
const FATS = [-0.4, 0, 0.5, 1.0];
const MUSCLES = [-1, -0.5, 0, 0.5];
const ABDOMENS = ['flat', 'soft', 'toned', 'curved'];
const ANGLES = ['front', 'three', 'side', 'back'];

// Create headless canvas for offscreen rendering
const canvas = createCanvas(IMAGE_SIZE, IMAGE_SIZE);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(IMAGE_SIZE, IMAGE_SIZE);
renderer.setPixelRatio(1);

const human = await Human.load();
const model = {
  sex: 'female', width: 34, height: 68, tone: 0.5,
  fat: 0, build: null, muscle: 0, abdomen: 'flat',
  waist: 0, bust: 0, chest: 0, glutes: 0, hips: 0, thighs: 0,
};
const mc = new ModelController(human, model);
const pose = composePose('stand');

const scene = new THREE.Scene();
scene.add(human.object);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

const views = {
  front: { az: 0, el: 4, dist: 5.2, ty: 0.9 },
  three: { az: 32, el: 6, dist: 5.2, ty: 0.9 },
  side: { az: 90, el: 4, dist: 5.2, ty: 0.9 },
  back: { az: 180, el: 4, dist: 5.2, ty: 0.9 },
};

function setView(angle) {
  const v = views[angle];
  camera.position.set(0, v.ty, v.dist);
  camera.lookAt(0, v.ty, 0);
}

function captureImage() {
  renderer.render(scene, camera);
  return canvas.toDataURL('image/png');
}

const samples = [];
let count = 0;
const startTime = Date.now();

console.log('Starting FAST generation (no browser, no Playwright)...\n');

for (const sex of SEXES) {
  model.sex = sex;
  model.width = sex === 'male' ? 44 : 34;
  model.height = sex === 'male' ? 72 : 68;
  mc.setSex(sex);
  mc.apply();
  human.setPose(pose);

  const widths = WIDTHS_CM[sex];
  const heights = HEIGHTS_IN[sex];

  for (const width of widths) {
    for (const height of heights) {
      for (const fat of FATS) {
        for (const muscle of MUSCLES) {
          for (const abdomen of ABDOMENS) {
            model.width = width;
            model.height = height;
            model.fat = fat;
            model.muscle = muscle;
            model.abdomen = abdomen;
            model.waist = 0; model.bust = 0; model.chest = 0;
            model.glutes = 0; model.hips = 0; model.thighs = 0;

            mc.applyShape();
            human.setPose(pose);

            const s = mc.solve();
            const gt = mc.girths(s);
            const weight = mc.weight(s);
            const bmi = mc.bmi(weight);

            const images = {};
            for (const angle of ANGLES) {
              setView(angle);
              images[angle] = captureImage();
            }

            samples.push({
              id: `sample_${count++}`,
              proportions: { sex, width, height, fat, build: null, muscle, abdomen, waist: 0, bust: 0, chest: 0, glutes: 0, hips: 0, thighs: 0 },
              measurements: {
                chest_cm: Number((gt.bust || gt.chest || 0).toFixed(1)),
                waist_cm: Number((gt.waist || 0).toFixed(1)),
                hips_cm: Number((gt.hips || 0).toFixed(1)),
                bust_cm: Number((gt.bust || 0).toFixed(1)),
                underbust_cm: Number((gt.underbust || 0).toFixed(1)),
                thigh_cm: Number((gt.thigh || 0).toFixed(1)),
                gap_cm: Number((gt.gap || 0).toFixed(1)),
                weight_kg: Number(weight.toFixed(1)),
                bmi: Number(bmi.toFixed(1)),
                height_in: height,
                width_cm: width,
              },
              images,
              createdAt: new Date().toISOString(),
            });

            if (count % 50 === 0) {
              const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
              console.log(`${count} samples | ${elapsed} min | ${sex} w=${width} h=${height} f=${fat} m=${muscle} a=${abdomen}`);
            }
          }
        }
      }
    }
  }
}

const dataset = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: samples.length,
  angles: ANGLES,
  samples,
};

writeFileSync(OUT_FILE, JSON.stringify(dataset, null, 2));
const mb = (statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\nDONE! ${samples.length} samples → ${OUT_FILE} (${mb} MB) in ${elapsed} min`);
console.log(`Next: python tools/train/train_model.py --dataset ${OUT_FILE} --device cuda`);
