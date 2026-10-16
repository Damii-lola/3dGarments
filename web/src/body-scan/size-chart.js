/**
 * Size chart + body measurement recommendation.
 *
 * Given estimated body measurements (chest/bust, waist, hips, height in inches),
 * find the closest clothing size across standard charts, and produce a fit note
 * (e.g. "size M — chest may be snug").
 *
 * Measurements are estimates from the video scan, so we present a range and
 * let the user confirm / override before applying to their 3D mannequin.
 */

import { SIZE_ORDER, SIZES, findClosestSize } from '../sizes.js';

/** Convert cm → inches. */
export const cmToIn = (cm) => cm / 2.54;

/**
 * Standard size charts (chest/bust, waist, hips in inches).
 * These are retail averages; the scan estimates feed into findClosestSize.
 */
export const SIZE_CHARTS = {
  male: {
    XS:  { chest: 32, waist: 26, hips: 34, height: 66 },
    S:   { chest: 36, waist: 30, hips: 38, height: 68 },
    M:   { chest: 40, waist: 34, hips: 40, height: 70 },
    L:   { chest: 44, waist: 38, hips: 44, height: 71 },
    XL:  { chest: 48, waist: 42, hips: 48, height: 72 },
    XXL: { chest: 52, waist: 46, hips: 52, height: 73 },
  },
  female: {
    XS:  { bust: 32, waist: 24, hips: 34, height: 62 },
    S:   { bust: 34, waist: 26, hips: 36, height: 64 },
    M:   { bust: 36, waist: 28, hips: 38, height: 65 },
    L:   { bust: 38, waist: 30, hips: 40, height: 66 },
    XL:  { bust: 40, waist: 33, hips: 43, height: 67 },
    XXL: { bust: 42, waist: 36, hips: 46, height: 68 },
  },
};

/**
 * Estimate body measurements from a set of vision-analyzed frames.
 * Each frame analysis is { view: 'front'|'side'|'back', chestIn, waistIn, hipsIn, heightIn, confidence }.
 * Returns combined estimates with per-measurement confidence.
 */
export function combineFrameEstimates(analyses) {
  const out = {};
  const keys = ['chest', 'waist', 'hips', 'height'];
  for (const k of keys) {
    const vals = analyses
      .filter((a) => a[k] != null && (a.confidence || 0) > 0.3)
      .map((a) => a[k]);
    if (vals.length) {
      out[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
      out[`${k}Confidence`] = Math.min(1, vals.length / 3); // more frames = more confident
    }
  }
  return out;
}

/**
 * Given estimated measurements (inches) + sex, return recommended size + fit notes.
 * @returns { size, sizeKey, chart, notes: string[], alternatives: string[] }
 */
export function recommendSize(sex, measurements) {
  const chart = SIZE_CHARTS[sex];
  if (!chart) return null;

  const chest = measurements.chest ?? measurements.bust;
  const waist = measurements.waist;
  const hips = measurements.hips;
  const height = measurements.height;

  const notes = [];
  const alternatives = [];

  // If we have enough measurements, use findClosestSize from sizes.js
  if (chest && waist && hips && height) {
    const key = findClosestSize(sex, { height, chest, waist, hips });
    if (key) {
      const c = chart[key];
      const dChest = chest - (c.chest ?? c.bust);
      const dWaist = waist - c.waist;
      const dHips = hips - c.hips;

      if (dChest > 1.5) notes.push(`Chest may be snug in size ${key}`);
      else if (dChest < -2) notes.push(`Size ${key} chest may be loose`);
      if (dWaist > 1.5) notes.push(`Waist may be snug in size ${key}`);
      else if (dWaist < -2) notes.push(`Size ${key} waist may be loose`);
      if (dHips > 1.5) notes.push(`Hips may be snug in size ${key}`);
      else if (dHips < -2) notes.push(`Size ${key} hips may be loose`);

      const idx = SIZE_ORDER.indexOf(key);
      if (idx > 0) alternatives.push(SIZE_ORDER[idx - 1]);
      if (idx < SIZE_ORDER.length - 1) alternatives.push(SIZE_ORDER[idx + 1]);

      return { size: key, sizeKey: key, chart: c, notes, alternatives };
    }
  }

  // Fallback: single best measurement (chest/bust for tops)
  if (chest) {
    let bestKey = null, bestDiff = Infinity;
    for (const key of SIZE_ORDER) {
      const diff = Math.abs(chest - (chart[key].chest ?? chart[key].bust));
      if (diff < bestDiff) { bestDiff = diff; bestKey = key; }
    }
    if (bestKey) {
      notes.push(`Based on ${chestLabel(sex)} ${chest.toFixed(0)}″`);
      return { size: bestKey, sizeKey: bestKey, chart: chart[bestKey], notes, alternatives };
    }
  }

  return null;
}

/** Label for chest/bust by sex. */
export function chestLabel(sex) { return sex === 'female' ? 'Bust' : 'Chest'; }
