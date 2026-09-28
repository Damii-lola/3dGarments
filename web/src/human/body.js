/**
 * The studio's simple body model: sex, width (cm), height (in) and skin.
 * Everything else is fixed to a fit, athletic build, like a fashion fit model.
 */
import { DEFAULT_SHAPE } from './modifiers.js';

/** Fit, athletic bases (MakeHuman macro + local targets). */
export const FIT = {
  female: {
    gender: 0, ageYears: 26, muscle: 0.74, weight: 0.4, proportions: 1, breastSize: 0.45, breastFirmness: 0.7,
    local: { 'stomach-tone': 0.8, 'buttocks-volume': 0.2, 'torso-muscle-dorsi': 0.15 },
  },
  male: {
    gender: 1, ageYears: 27, muscle: 0.92, weight: 0.44, proportions: 1, breastSize: 0.5, breastFirmness: 0.5,
    local: { 'torso-vshape': 0.35, 'torso-muscle-pectoral': 0.45, 'torso-muscle-dorsi': 0.3, 'stomach-tone': 1 },
  },
};

/**
 * Skins: grey clay first, then real-world tones. Each also sets MakeHuman's
 * ethnicity blend, so faces match the skin (grey keeps the neutral average).
 */
export const SKINS = [
  { id: 'gray', label: 'Grey', hex: '#8e8f93', clay: true, eth: [1 / 3, 1 / 3, 1 / 3], hair: '#55565a' },
  { id: 'nordic', label: 'Northern European', hex: '#efd7c7', eth: [0, 0, 1], hair: '#6e5236' },
  { id: 'european', label: 'European', hex: '#e2bea2', eth: [0, 0.05, 0.95], hair: '#3a2718' },
  { id: 'eastasian', label: 'East Asian', hex: '#e6c4a2', eth: [0, 1, 0], hair: '#0e0b0a' },
  { id: 'mediterranean', label: 'Mediterranean', hex: '#cfa47f', eth: [0.05, 0.1, 0.85], hair: '#1d140e' },
  { id: 'latino', label: 'Latino', hex: '#bb8b64', eth: [0.15, 0.25, 0.6], hair: '#140e0b' },
  { id: 'middleeastern', label: 'Middle Eastern', hex: '#b88c69', eth: [0.1, 0.1, 0.8], hair: '#120d0a' },
  { id: 'southasian', label: 'South Asian', hex: '#9a6a48', eth: [0.2, 0.35, 0.45], hair: '#0d0a09' },
  { id: 'african', label: 'African', hex: '#6f4630', eth: [1, 0, 0], hair: '#0b0908' },
  { id: 'deep', label: 'Deep African', hex: '#4a2f21', eth: [1, 0, 0], hair: '#0a0807' },
];

/** Slider ranges (real measurements) and fit-model defaults. */
export const RANGES = {
  female: { width: [32, 46], height: [58, 78], defaults: { width: 39, height: 69 } },
  male: { width: [42, 57], height: [62, 82], defaults: { width: 48, height: 73 } },
};
export const FRAME_RANGE = [-1.8, 0.6]; // beyond +0.6 the torso turns boxy

export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

/** Width "frame" (−1 narrow … +1 broad): shoulders lead, torso and hips follow. */
function frameLocal(frame, sex) {
  // the whole torso carries the change so broad never turns into slab shoulders
  return {
    'torso-scale-horiz': frame * 0.75,
    'measure-shoulder-dist': frame * 0.45,
    'torso-vshape': frame > 0 ? frame * 0.25 : 0,
    'hip-scale-horiz': frame * (sex === 'female' ? 0.45 : 0.35),
  };
}

function sumLocal(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

/**
 * @param b { sex: 'female'|'male', frame: −1…1, height: 0…1 (macro), skin: id }
 * @returns full MakeHuman shape for Human.setShape()
 */
export function shapeFor({ sex = 'female', frame = 0, height = 0.5, skin = 'gray' }) {
  const fit = FIT[sex] || FIT.female;
  const [african, asian, caucasian] = skinById(skin).eth;
  return {
    ...DEFAULT_SHAPE, ...fit, height, african, asian, caucasian,
    local: sumLocal(fit.local, frameLocal(frame, sex)),
  };
}

export const IN = 2.54;
export const cmToIn = (cm) => cm / IN;
export const fmtIn = (inches) => { const i = Math.round(inches); return `${i} in · ${Math.floor(i / 12)}′${i % 12}″`; };
