/**
 * MakeHuman macro modifiers (apps/human.py) ported to JS.
 *
 * Every macro target is named after the variables it depends on, e.g.
 *   universal-female-young-maxmuscle-averageweight
 *   height/male-old-averagemuscle-minweight-maxheight
 * and its weight is the product of those variables' current values.
 */

export const DEFAULT_SHAPE = Object.freeze({
  gender: 0, // 0 female … 1 male
  ageYears: 28, // 25 … 90
  muscle: 0.5,
  weight: 0.5,
  height: 0.5,
  proportions: 0.5,
  breastSize: 0.5,
  breastFirmness: 0.5,
  african: 1 / 3,
  asian: 1 / 3,
  caucasian: 1 / 3,
});

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0.5));

/** Three-way split used by muscle, weight, height, breasts and proportions. */
function tri(v, [lo, mid, hi], midIsRemainder = true) {
  const max = Math.max(0, v * 2 - 1);
  const min = Math.max(0, 1 - v * 2);
  return { [lo]: min, [hi]: max, ...(mid ? { [mid]: midIsRemainder ? 1 - (min + max) : 1 - Math.max(min, max) } : {}) };
}

export function macroValues(shape) {
  const s = { ...DEFAULT_SHAPE, ...shape };
  const gender = clamp01(s.gender);
  const years = Math.max(25, Math.min(90, +s.ageYears || 25));
  const age = 0.5 + (years - 25) / 130; // MakeHuman: 25y = 0.5, 90y = 1
  const old = Math.max(0, age * 2 - 1);
  let af = Math.max(0, +s.african || 0), as = Math.max(0, +s.asian || 0), ca = Math.max(0, +s.caucasian || 0);
  const tot = af + as + ca;
  if (tot <= 0) { af = as = ca = 1 / 3; } else { af /= tot; as /= tot; ca /= tot; }
  return {
    universal: 1,
    female: 1 - gender, male: gender,
    young: 1 - old, old, baby: 0, child: 0,
    ...tri(clamp01(s.muscle), ['minmuscle', 'averagemuscle', 'maxmuscle']),
    ...tri(clamp01(s.weight), ['minweight', 'averageweight', 'maxweight']),
    ...tri(clamp01(s.height), ['minheight', null, 'maxheight']),
    ...tri(clamp01(s.proportions), ['uncommonproportions', null, 'idealproportions']),
    ...tri(clamp01(s.breastSize), ['mincup', 'averagecup', 'maxcup'], false),
    ...tri(clamp01(s.breastFirmness), ['minfirmness', 'averagefirmness', 'maxfirmness'], false),
    african: af, asian: as, caucasian: ca,
  };
}

const tokenCache = new Map();
function tokensOf(name) {
  let t = tokenCache.get(name);
  if (!t) {
    const base = name.replace(/^(height|proportions|breast)\//, '');
    // local (non-macro) targets such as breast/breast-dist-incr are driven by `local` values
    const local = /^(breast|nipple)-/.test(base) ? base.match(/^(.*)-(incr|decr|up|down)$/) : null;
    t = local ? { local: local[1], dir: /incr|up/.test(local[2]) ? 1 : -1 } : { macro: base.split('-') };
    tokenCache.set(name, t);
  }
  return t;
}

/**
 * @param shape  see DEFAULT_SHAPE; optional `local: { 'breast-dist': -1…1, … }`
 * @param names  iterable of target names
 * @returns [name, weight][] for every target with a non-negligible weight
 */
export function targetWeights(shape, names) {
  const v = macroValues(shape);
  const local = shape?.local || {};
  const out = [];
  for (const name of names) {
    const t = tokensOf(name);
    let w;
    if (t.local) {
      const x = +local[t.local] || 0;
      w = Math.sign(x) === t.dir ? Math.abs(x) : 0;
    } else {
      w = 1;
      for (const k of t.macro) { w *= v[k] ?? 0; if (!w) break; }
    }
    if (w > 1e-4) out.push([name, w]);
  }
  return out;
}
