/**
 * Standard clothing sizes -> typical body measurements.
 * Anthropometric averages (US retail sizing) so a shopper can pick the size
 * they usually wear instead of guessing their shoulder width, chest, or
 * body-fat percentage off the top of their head.
 *
 * All measurements:
 *   height   inches (crown to sole)
 *   chest    inches (bust for women, chest for men)
 *   waist    inches (natural waist)
 *   hips     inches (fullest part)
 *   width    cm (shoulder point to point — the model's width morph)
 *   weight   kg
 *   build    body-type key (slender | athletic | soft | plus)
 *   waist/bust/chest/hips/glutes/thighs: -1 .. +1 proportion sliders
 */
export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const SIZES = {
  male: {
    XS:  { height: 67, chest: 34, waist: 28, hips: 35, width: 40, weight: 62, build: 'slender', waist: -0.30, chest: -0.30, hips: -0.30, glutes: -0.20, thighs: -0.20 },
    S:   { height: 69, chest: 36, waist: 30, hips: 37, width: 42, weight: 73, build: 'slender', waist: -0.20, chest: -0.20, hips: -0.20, glutes: -0.10, thighs: -0.10 },
    M:   { height: 70, chest: 39, waist: 33, hips: 39, width: 44, weight: 80, build: 'athletic', waist: 0, chest: 0, hips: 0, glutes: 0, thighs: 0 },
    L:   { height: 71, chest: 42, waist: 36, hips: 42, width: 47, weight: 90, build: 'soft', waist: 0.20, chest: 0.20, hips: 0.20, glutes: 0.10, thighs: 0.10 },
    XL:  { height: 72, chest: 45, waist: 39, hips: 45, width: 49, weight: 100, build: 'soft', waist: 0.40, chest: 0.40, hips: 0.40, glutes: 0.20, thighs: 0.20 },
    XXL: { height: 73, chest: 48, waist: 42, hips: 48, width: 51, weight: 112, build: 'plus', waist: 0.60, chest: 0.60, hips: 0.60, glutes: 0.40, thighs: 0.40 },
  },
  female: {
    XS:  { height: 62, chest: 33, waist: 25, hips: 35, width: 35, weight: 52, build: 'slender', waist: -0.40, bust: -0.30, hips: -0.20, glutes: -0.20, thighs: -0.20 },
    S:   { height: 64, chest: 35, waist: 27, hips: 37, width: 37, weight: 60, build: 'slender', waist: -0.30, bust: -0.20, hips: -0.10, glutes: -0.10, thighs: -0.10 },
    M:   { height: 65, chest: 37, waist: 29, hips: 39, width: 39, weight: 68, build: 'athletic', waist: 0, bust: 0, hips: 0, glutes: 0, thighs: 0 },
    L:   { height: 66, chest: 39, waist: 31, hips: 41, width: 41, weight: 79, build: 'soft', waist: 0.20, bust: 0.20, hips: 0.30, glutes: 0.10, thighs: 0.10 },
    XL:  { height: 67, chest: 42, waist: 34, hips: 44, width: 43, weight: 90, build: 'soft', waist: 0.40, bust: 0.40, hips: 0.50, glutes: 0.20, thighs: 0.20 },
    XXL: { height: 68, chest: 45, waist: 37, hips: 47, width: 45, weight: 102, build: 'plus', waist: 0.60, bust: 0.60, hips: 0.70, glutes: 0.40, thighs: 0.40 },
  },
};

const BUILD_MUSCLE = { slender: 0, athletic: 0.6, soft: -0.8, plus: -0.5 };

/** Apply a clothing size to the model state + 3D body. Returns the size object applied. */
export function applySize(M, model, sex, sizeKey) {
  const size = SIZES[sex]?.[sizeKey];
  if (!size) return null;
  Object.assign(M, {
    height: size.height,
    width: size.width,
    build: size.build,
    muscle: BUILD_MUSCLE[size.build] ?? 0,
    waist: size.waist,
    hips: size.hips,
    glutes: size.glutes,
    thighs: size.thighs,
    chest: size.chest ?? 0,
    bust: size.bust ?? 0,
  });
  model.applyShape();
  model.setWeight(size.weight);
  model.applyShape();
  return size;
}

/**
 * Find the closest size to given measurements (all in inches).
 * Compares chest/bust, waist, hips and height.
 */
export function findClosestSize(sex, { height, chest, waist, hips }) {
  const sizes = SIZES[sex];
  if (!sizes) return null;
  let bestKey = null, bestDist = Infinity;
  for (const key of SIZE_ORDER) {
    const s = sizes[key];
    const dh = (height - s.height) / 5;
    const dc = (chest - s.chest) / 3;
    const dw = (waist - s.waist) / 3;
    const dH = (hips - s.hips) / 3;
    const d = dh * dh + dc * dc + dw * dw + dH * dH;
    if (d < bestDist) { bestDist = d; bestKey = key; }
  }
  return bestKey;
}

/** Label shown for the chest/bust measurement by sex. */
export function chestLabel(sex) { return sex === 'female' ? 'Bust' : 'Chest'; }
