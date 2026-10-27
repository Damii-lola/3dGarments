/**
 * AI Training Data Utilities
 *
 * Saves and loads training datasets for the body-measurement AI.
 * Each entry: the model's exact proportions (known ground truth),
 * plus the rendered images at multiple angles.
 *
 * Stored as JSON in IndexedDB; images are stored as data URLs.
 */
import { ModelController } from '@web/human/body.js';

const DB_NAME = '3dg-training';
const STORE_NAME = 'samples';

let db = null;

async function openDb() {
  if (db) return db;
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
  });
  return db;
}

/** One training sample: proportions + exact measurements + angles. */
export class TrainingSample {
  constructor({ sex, widthCm, heightIn, fat, build, muscle, abdomen,
                waist, bust, chest, glutes, hips, thighs,
                images, measurements, weight, bmi } = {}) {
    this.id = null;
    this.sex = sex || 'female';
    this.widthCm = widthCm || 34;
    this.heightIn = heightIn || 68;
    this.fat = fat || 0;
    this.build = build || null;
    this.muscle = muscle || 0;
    this.abdomen = abdomen || 'flat';
    this.waist = waist || 0;
    this.bust = bust || 0;
    this.chest = chest || 0;
    this.glutes = glutes || 0;
    this.hips = hips || 0;
    this.thighs = thighs || 0;
    this.images = images || {}; // { angle: dataUrl }
    this.measurements = measurements || {}; // exact ground truth from girths()
    this.weight = weight || 0;
    this.bmi = bmi || 0;
    this.createdAt = Date.now();
  }
}

/** Generate ground-truth measurements from a ModelController. */
export function generateGroundTruth(model) {
  const s = model.solve();
  const girths = model.girths(s);
  const w = model.weight(s);
  const bmi = model.bmi(w);
  return {
    chest_cm: girths.bust || girths.chest || 0,
    waist_cm: girths.waist || 0,
    hips_cm: girths.hips || 0,
    bust_cm: girths.bust || 0,
    underbust_cm: girths.underbust || 0,
    thigh_cm: girths.thigh || 0,
    gap_cm: girths.gap || 0,
    weight_kg: w,
    bmi,
    height_in: model.model.height,
    width_cm: model.model.width,
    scale: s.scale,
    morphs: s.morphs,
  };
}

/** Save a sample to IndexedDB. Returns the saved sample with its id. */
export async function saveSample(sample) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(sample);
    req.onsuccess = () => { sample.id = req.result; resolve(sample); };
    req.onerror = () => reject(req.error);
  });
}

/** Load all samples. */
export async function loadSamples() {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a sample by id. */
export async function deleteSample(id) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Export all samples as JSON (images included as data URLs). */
export async function exportDataset() {
  const samples = await loadSamples();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: samples.length,
    samples,
  };
}

/** Import a dataset (replaces all current samples). */
export async function importDataset(data) {
  const d = await openDb();
  const tx = d.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  for (const s of data.samples || []) {
    await new Promise((resolve, reject) => {
      const req = store.add(s);
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  }
}

/** Count samples. */
export async function countSamples() {
  const samples = await loadSamples();
  return samples.length;
}

/** Clear all samples. */
export async function clearSamples() {
  const d = await openDb();
  const tx = d.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const req = store.clear();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Default body states for quick training entry points. */
export const PRESETS = {
  female_slender: { sex: 'female', widthCm: 30, heightIn: 62, fat: -0.4, build: 'slender', muscle: 0, abdomen: 'flat' },
  female_avg: { sex: 'female', widthCm: 34, heightIn: 65, fat: 0, build: null, muscle: 0, abdomen: 'flat' },
  female_plus: { sex: 'female', widthCm: 40, heightIn: 65, fat: 1.0, build: 'plus', muscle: -0.5, abdomen: 'soft' },
  male_slender: { sex: 'male', widthCm: 38, heightIn: 70, fat: -0.4, build: 'slender', muscle: 0, abdomen: 'flat' },
  male_avg: { sex: 'male', widthCm: 44, heightIn: 72, fat: 0, build: null, muscle: 0, abdomen: 'flat' },
  male_plus: { sex: 'male', widthCm: 50, heightIn: 72, fat: 1.0, build: 'plus', muscle: -0.5, abdomen: 'soft' },
};

/** Angles to render for each training sample. */
export const TRAINING_ANGLES = ['front', 'three', 'side', 'back'];
