/**
 * The studio's model controls, as real measurements where there is one:
 *   sex · height = crown to sole (in) · weight (kg, from the body's volume) · shoulder breadth =
 *   shoulder point to point (cm) · skin tone · body type · abdomen / waist · bust / chest ·
 *   posture · glutes / hips / thighs
 * Drives a Human (human.js); shared by the studio and the lab so both show the same models.
 */
import { DENSITY } from './shape.js';
/**
 * Skin tone: one slider (0 … 1) along real-world tones, lightest (Northern European) to darkest
 * (African). No names are shown; the default sits on the Latino tone.
 */
export const SKIN_STOPS = ['#efd7c7', '#e6c4a2', '#e2bea2', '#cfa47f', '#bb8b64', '#b88c69', '#9a6a48', '#6f4630'];
export const DEFAULT_TONE = 4 / (SKIN_STOPS.length - 1); // Latino

const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** css colour at position t (0 … 1) along SKIN_STOPS */
export function toneAt(t) {
  const x = Math.min(1, Math.max(0, t)) * (SKIN_STOPS.length - 1);
  const i = Math.min(SKIN_STOPS.length - 2, Math.floor(x)), f = x - i;
  const a = hexRGB(SKIN_STOPS[i]), b = hexRGB(SKIN_STOPS[i + 1]);
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}
/** css gradient of the whole range (slider track) */
export const toneGradient = () => `linear-gradient(90deg, ${SKIN_STOPS.join(', ')})`;

/** Slider ranges (real measurements) and fit-model defaults. */
export const RANGES = {
  female: { width: [30, 42], height: [58, 78], defaults: { width: 34, height: 68 } },
  male: { width: [38, 52], height: [62, 82], defaults: { width: 44, height: 72 } },
};
export const WIDTH_RANGE = [-1, 1.2]; // width morph: ±20 % shoulders per unit

/** Body type: muscle tone + a typical BMI (weight follows the height). */
export const BUILDS = {
  slender: { label: 'Slender', muscle: 0, bmi: { female: 18.4, male: 20 } },
  athletic: { label: 'Athletic', muscle: 0.6, bmi: { female: 21.5, male: 24.5 } },
  soft: { label: 'Soft', muscle: -0.8, bmi: { female: 25.5, male: 27 } },
  plus: { label: 'Plus-size', muscle: -0.5, bmi: { female: 32, male: 32 } },
};
/** Abdomen: belly prominence + core definition. 'flat' is the model as sculpted. */
export const ABDOMEN = {
  flat: { label: 'Flat', belly: 0, core: 0 },
  soft: { label: 'Soft belly', belly: 0.4, core: -0.8 },
  toned: { label: 'Toned', belly: -0.12, core: 0.85 },
  curved: { label: 'Curved', belly: 0.8, core: -0.45 },
};

/**
 * Realistic limits of every morph influence, per sex, calibrated on renders: past these the body
 * stops reading as a real person. The proportion sliders are −1 … +1 across these limits.
 */
export const LIMITS = {
  female: { fat: [-0.4, 1.5], muscle: [-1, 0.8], waist: [-1, 1], bust: [-1, 1], chest: [-1, 1], glutes: [-0.8, 0.9], hips: [-1, 1], thighs: [-1, 1] },
  male: { fat: [-0.4, 1.05], muscle: [-1, 1], waist: [-1, 1], bust: [-0.6, 1], chest: [-1, 1], glutes: [-0.8, 0.8], hips: [-1, 1], thighs: [-1, 1] },
};
/** Proportion sliders (−1 … +1). Everything a slider adds is damped by body fat (see ModelController#room). */
export const SHAPE_KEYS = ['waist', 'bust', 'chest', 'glutes', 'hips', 'thighs'];
export const SHAPE_DEFAULTS = { fat: 0, build: null, muscle: 0, abdomen: 'flat', waist: 0, bust: 0, chest: 0, posture: 0, glutes: 0, hips: 0, thighs: 0 };
const BMI_RANGE = [15.5, 40];

export const IN = 2.54;
export const LB = 2.20462;
export const cmToIn = (cm) => cm / IN;
export const fmtIn = (inches) => { const i = Math.round(inches); return `${i} in · ${Math.floor(i / 12)}′${i % 12}″`; };

export class ModelController {
  /** @param model { sex, width (cm), height (in), tone (0 … 1) } — kept by reference and mutated */
  constructor(human, model) {
    this.human = human;
    this.model = model;
  }

  get shape() { return this.human.active.ensureShape(); }
  get limits() { return LIMITS[this.model.sex]; }

  /**
   * How much of a slider's range is left at this body fat: a heavy body already carries fat on the
   * belly, hips, bust and thighs, so a slider adds less on top; a very lean one can't lose much more.
   */
  room(v, fat) {
    const [lo, hi] = this.limits.fat;
    return v >= 0 ? 1 - 0.45 * Math.min(1, Math.max(0, fat) / hi) : 1 - 0.55 * Math.min(1, Math.max(0, -fat) / -lo);
  }

  /** morph influences for a body fat (the proportion sliders scaled to their limits and damped) */
  morphs(fat = this.model.fat || 0) {
    const m = { ...SHAPE_DEFAULTS, ...this.model }, L = this.limits;
    const ab = ABDOMEN[m.abdomen] || ABDOMEN.flat;
    const out = { belly: ab.belly * this.room(ab.belly, fat), core: ab.core, muscle: Math.min(L.muscle[1], Math.max(L.muscle[0], m.muscle)), fat };
    for (const k of SHAPE_KEYS) {
      const v = Math.min(1, Math.max(-1, m[k] || 0));
      out[k] = (v >= 0 ? v * L[k][1] : -v * L[k][0]) * this.room(v, fat);
    }
    return out;
  }

  #scaleWidth() {
    const h = this.human, { width, height } = this.model;
    h.setSex(this.model.sex);
    const scale = (height * IN) / 100 / h.active.baseHeight;
    const w0 = h.active.shoulderWidth(0), w1 = h.active.shoulderWidth(1);
    const w = Math.min(WIDTH_RANGE[1], Math.max(WIDTH_RANGE[0], ((width / 100) / scale - w0) / (w1 - w0)));
    return { scale, width: w };
  }

  /** exact: height is a uniform scale; the width morph is linear in shoulder width */
  solve() {
    const { scale, width } = this.#scaleWidth();
    return { scale, width, morphs: this.morphs() };
  }

  applyShape() {
    const s = this.solve();
    this.human.setShape(s);
    this.human.setPosture(this.model.posture || 0);
    return s;
  }

  /** weight (kg) = the body's volume × density */
  weight(s = this.solve()) {
    return DENSITY * s.scale ** 3 * this.shape.volume({ ...s.morphs, width: s.width });
  }

  /**
   * Set the weight (kg): solves the body fat that gives it with every other slider held (the fat
   * damping makes it a fixed point; 2 rounds land within grams). Returns the weight actually reached.
   */
  setWeight(kg) {
    const { scale, width } = this.#scaleWidth();
    const [lo, hi] = this.limits.fat, V = kg / DENSITY / scale ** 3;
    let f = this.model.fat || 0;
    for (let i = 0; i < 2; i++) f = this.shape.solveFat({ ...this.morphs(f), width }, V, [lo, hi]);
    this.model.fat = f;
    return this.weight();
  }

  /** the weights this body can reach (kg), inside a healthy-to-plus BMI range */
  weightRange() {
    const { scale, width } = this.#scaleWidth(), [lo, hi] = this.limits.fat;
    const k = DENSITY * scale ** 3, hM = (this.model.height * IN) / 100;
    const at = (f) => k * this.shape.volume({ ...this.morphs(f), width });
    return [Math.max(at(lo), BMI_RANGE[0] * hM * hM), Math.min(at(hi), BMI_RANGE[1] * hM * hM)];
  }

  bmi(kg = this.weight()) { const hM = (this.model.height * IN) / 100; return kg / (hM * hM); }

  /** tape measurements in cm: bust, underbust, waist, hips, thigh, gap (+ bra size for women) */
  girths(s = this.solve()) {
    const g = this.shape.girths({ ...s.morphs, width: s.width });
    const out = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v * s.scale * 100]));
    if (this.model.sex === 'female') out.bra = braSize(out.bust, out.underbust);
    return out;
  }

  /** a body type: its muscle tone, and the weight of its typical BMI at this height */
  setBuild(key) {
    const b = BUILDS[key];
    if (!b) return;
    const hM = (this.model.height * IN) / 100;
    Object.assign(this.model, { build: key, muscle: b.muscle });
    this.setWeight(b.bmi[this.model.sex] * hM * hM);
  }

  applyLook() {
    this.human.setSkin({ tone: toneAt(this.model.tone ?? DEFAULT_TONE), clay: false });
  }

  apply() { this.applyShape(); this.applyLook(); }

  setSex(sex) {
    this.model.sex = sex;
    Object.assign(this.model, RANGES[sex].defaults, SHAPE_DEFAULTS);
  }

  /** back to the sculpted model (keeps sex, height and skin) */
  resetShape() {
    Object.assign(this.model, { width: RANGES[this.model.sex].defaults.width }, SHAPE_DEFAULTS);
  }

  /** Slider ranges clipped to what this body can actually reach. */
  reach(key) {
    const [lo, hi] = RANGES[this.model.sex][key];
    if (key === 'height') return [lo, hi];
    const h = this.human, { scale } = this.solve();
    const m = WIDTH_RANGE.map((w) => h.active.shoulderWidth(w) * scale * 100);
    return [Math.max(lo, Math.ceil(m[0])), Math.min(hi, Math.floor(m[1]))];
  }
}

/** US bra size (retail method): band = underbust in inches + 4 (+5 if odd), cup = bust − band */
export function braSize(bust, underbust) {
  const u = Math.round(underbust / IN), band = u + (u % 2 ? 5 : 4);
  const cups = ['AA', 'A', 'B', 'C', 'D', 'DD', 'DDD', 'G', 'H', 'I', 'J'];
  const d = Math.round(bust / IN - band);
  return `${band}${cups[Math.min(cups.length - 1, Math.max(0, d))]}`;
}
