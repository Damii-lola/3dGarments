/**
 * The studio's four model controls, as real measurements:
 *   sex (picker) · width = shoulder point to point (cm) · height = crown to sole (in) · skin
 * Drives a Human (human.js); shared by the studio and the lab so both show the same models.
 */
/** Skins: grey clay first, then real-world tones. */
export const SKINS = [
  { id: 'gray', label: 'Grey', hex: '#8e8f93', clay: true },
  { id: 'nordic', label: 'Northern European', hex: '#efd7c7' },
  { id: 'european', label: 'European', hex: '#e2bea2' },
  { id: 'eastasian', label: 'East Asian', hex: '#e6c4a2' },
  { id: 'mediterranean', label: 'Mediterranean', hex: '#cfa47f' },
  { id: 'latino', label: 'Latino', hex: '#bb8b64' },
  { id: 'middleeastern', label: 'Middle Eastern', hex: '#b88c69' },
  { id: 'southasian', label: 'South Asian', hex: '#9a6a48' },
  { id: 'african', label: 'African', hex: '#6f4630' },
  { id: 'deep', label: 'Deep African', hex: '#4a2f21' },
];

/** Slider ranges (real measurements) and fit-model defaults. */
export const RANGES = {
  female: { width: [33, 45], height: [58, 78], defaults: { width: 38, height: 67 } },
  male: { width: [36, 50], height: [62, 82], defaults: { width: 42, height: 70 } },
};
export const WIDTH_RANGE = [-1, 1.2]; // width morph: ±20 % shoulders per unit

export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

export const IN = 2.54;
export const cmToIn = (cm) => cm / IN;
export const fmtIn = (inches) => { const i = Math.round(inches); return `${i} in · ${Math.floor(i / 12)}′${i % 12}″`; };

export class ModelController {
  /** @param model { sex, width (cm), height (in), skin } — kept by reference and mutated */
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
    const k = skinById(this.model.skin);
    this.human.setSkin({ tone: k.hex, clay: !!k.clay });
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
