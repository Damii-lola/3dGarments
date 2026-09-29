/**
 * The studio's four model controls, as real measurements:
 *   sex (picker) · width = shoulder point to point (cm) · height = crown to sole (in) · skin tone (slider)
 * Drives a Human (human.js); shared by the studio and the lab so both show the same models.
 */
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
  male: { width: [36, 50], height: [62, 82], defaults: { width: 42, height: 70 } },
};
export const WIDTH_RANGE = [-1, 1.2]; // width morph: ±20 % shoulders per unit

export const IN = 2.54;
export const cmToIn = (cm) => cm / IN;
export const fmtIn = (inches) => { const i = Math.round(inches); return `${i} in · ${Math.floor(i / 12)}′${i % 12}″`; };

export class ModelController {
  /** @param model { sex, width (cm), height (in), tone (0 … 1) } — kept by reference and mutated */
  constructor(human, model) {
    this.human = human;
    this.model = model;
  }

  /** exact: height is a uniform scale; the width morph is linear in shoulder width */
  solve() {
    const h = this.human, { width, height } = this.model;
    h.setSex(this.model.sex);
    const scale = (height * IN) / 100 / h.active.baseHeight;
    const w0 = h.active.shoulderWidth(0), w1 = h.active.shoulderWidth(1);
    const w = ((width / 100) / scale - w0) / (w1 - w0);
    return { scale, width: Math.min(WIDTH_RANGE[1], Math.max(WIDTH_RANGE[0], w)) };
  }

  applyShape() { this.human.setShape(this.solve()); }

  applyLook() {
    this.human.setSkin({ tone: toneAt(this.model.tone ?? DEFAULT_TONE), clay: false });
  }

  apply() { this.applyShape(); this.applyLook(); }

  setSex(sex) {
    this.model.sex = sex;
    Object.assign(this.model, RANGES[sex].defaults);
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
