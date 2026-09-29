/**
 * The studio's simple body model: sex, width (cm), height (in) and skin.
 * Everything else is fixed to a fit, athletic build, like a fashion fit model.
 */
import { DEFAULT_SHAPE } from './modifiers.js';
import { Human } from './human.js';

/**
 * The two bodies, fitted by tools/human/design.py to REAL measurements of people in each
 * category (tape-measure circumferences on the mesh; see REF in design.py):
 *   male   — fit muscular (men's physique): chest ≈ 113, waist ≈ 77, arm ≈ 37, thigh ≈ 57, calf ≈ 41 cm
 *   female — thick fit (wellness): bust ≈ 96, waist ≈ 66, hips ≈ 106, thigh ≈ 62, calf ≈ 38 cm
 */
export const FIT = {
  female: {
    ...{ gender: 0, ageYears: 26, proportions: 1, breastFirmness: 0.5, muscle: 0.708, weight: 0.641, breastSize: 0.62 },
    local: { "buttocks-volume": 1.0, "hip-scale-horiz": 0.104, "stomach-tone": 0.9, "l-upperleg-muscle": 0.95, "r-upperleg-muscle": 0.95, "l-upperleg-fat": 0.45, "r-upperleg-fat": 0.45, "l-lowerleg-muscle": 0.333, "r-lowerleg-muscle": 0.333, "measure-thigh-circ": 0.15, "nipple-point": -1, "nipple-size": -0.6, "breast-point": -1 },
  },
  male: {
    ...{ gender: 1, ageYears: 27, proportions: 1, breastSize: 0.5, breastFirmness: 0.5, muscle: 0.939, weight: 0.411 },
    local: { "torso-vshape": 0.426, "torso-muscle-pectoral": 0.489, "torso-muscle-dorsi": 0.522, "stomach-tone": 1.0, "l-upperarm-muscle": 0.639, "r-upperarm-muscle": 0.639, "l-upperarm-shoulder-muscle": 0.52, "r-upperarm-shoulder-muscle": 0.52, "l-lowerarm-muscle": 0.5, "r-lowerarm-muscle": 0.5, "l-upperleg-muscle": 1.0, "r-upperleg-muscle": 1.0, "l-lowerleg-muscle": 0.55, "r-lowerleg-muscle": 0.55, "measure-thigh-circ": 0.6, "measure-hips-circ": -0.65, "measure-neck-circ": 1 },
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
  female: { width: [36, 50], height: [58, 78], defaults: { width: 44, height: 67 } },
  male: { width: [46, 62], height: [62, 82], defaults: { width: 57, height: 73 } },
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

/**
 * Drives a Human from the four studio controls. Width (shoulder point to point, cm) and
 * height (in) each own one parameter; they barely interact, so two alternating exact
 * solves converge. Shared by the studio and the lab so both show the same models.
 */
export class ModelController {
  /** @param model { sex, width (cm), height (in), skin } — kept by reference and mutated */
  constructor(human, model) {
    this.human = human;
    this.model = model;
    this.frame = 0;
    this.heightParam = 0.5;
  }

  #measure(frame, height) {
    const { sex, skin } = this.model;
    return this.human.measure(shapeFor({ sex, skin, frame, height }));
  }

  solve() {
    const { sex, skin, width, height } = this.model;
    for (let i = 0; i < 2; i++) {
      this.frame = Human.solve((f) => this.#measure(f, this.heightParam).width * 100, width, FRAME_RANGE[0], FRAME_RANGE[1], 0);
      this.heightParam = Human.solve((h) => this.#measure(this.frame, h).height * 100 / IN, height, 0, 1, 0.5);
    }
    return shapeFor({ sex, skin, frame: this.frame, height: this.heightParam });
  }

  applyShape() { this.human.setShape(this.solve()); }

  /** Skin, grey clay mode, hair style/colour and underwear all follow sex + skin. */
  applyLook() {
    const k = skinById(this.model.skin);
    this.human.setSkin({ tone: k.hex, clay: !!k.clay, stubble: 0, hairColor: k.hair });
    this.human.setHair({ style: this.model.sex === 'male' ? 'crop' : 'sleek', color: k.hair });
    this.human.setUnderwear({ style: 'auto', color: k.clay ? '#5f6064' : '#2c2c30' });
  }

  apply() { this.applyShape(); this.applyLook(); }

  setSex(sex) {
    this.model.sex = sex;
    Object.assign(this.model, RANGES[sex].defaults);
  }

  /** Slider ranges clipped to what this body can actually reach. */
  reach(key) {
    const [lo, hi] = RANGES[this.model.sex][key];
    const m = key === 'width'
      ? FRAME_RANGE.map((f) => this.#measure(f, this.heightParam).width * 100)
      : [0, 1].map((h) => this.#measure(this.frame, h).height * 100 / IN);
    return [Math.max(lo, Math.ceil(m[0])), Math.min(hi, Math.floor(m[1]))];
  }
}
