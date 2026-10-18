/**
 * Size charts, and how one is chosen.
 *
 * US retail size charts in inches; men are sized on the chest and women on the
 * bust. But a chart is a table of three girths per size, and a body is under no
 * obligation to agree with all three at once: a 6'1" man with a 32" waist reads S
 * at the waist and M at the hips, because a chart like this assumes girth and
 * height rise together. Sizing off the chest alone throws away two of the three
 * things the clip actually measured - which is exactly what happened on a real
 * live clip, where a 38" chest sitting precisely on the 36/40 boundary resolved
 * to S while his hips were saying M.
 *
 * The chart's height column is deliberately not used to choose. Height and girth
 * do not move together in the direction the column implies, and the honest thing
 * for a tall slim man is to be told the girths, not to be handed an XXL.
 */

export const CHARTS = {
  male: {
    XS: { chest: 32, waist: 26, hips: 34, height: 66 },
    S: { chest: 36, waist: 30, hips: 38, height: 68 },
    M: { chest: 40, waist: 34, hips: 40, height: 70 },
    L: { chest: 44, waist: 38, hips: 44, height: 71 },
    XL: { chest: 48, waist: 42, hips: 48, height: 72 },
    XXL: { chest: 52, waist: 46, hips: 52, height: 73 },
  },
  female: {
    XS: { bust: 32, waist: 24, hips: 34, height: 62 },
    S: { bust: 34, waist: 26, hips: 36, height: 64 },
    M: { bust: 36, waist: 28, hips: 38, height: 65 },
    L: { bust: 38, waist: 30, hips: 40, height: 66 },
    XL: { bust: 40, waist: 33, hips: 43, height: 67 },
    XXL: { bust: 42, waist: 36, hips: 46, height: 68 },
  },
};

/**
 * The size whose WORST disagreement with any measured girth is the smallest.
 *
 * Worst case rather than average, because the garment that can be worn is the one
 * that is loose somewhere; the one that is snug somewhere is the one that does not
 * close. An exact tie keeps the smaller size.
 *
 * `girths` is the adjusted measurement set: `chest` is required (for a woman it is
 * read against the chart's bust column), `waist` and `hips` are used when the clip
 * showed them. Fewer columns simply means a narrower search, and with only the
 * chest this is the nearest-nominal rule it replaces.
 *
 * `diff` stays the chest/bust difference: it is what the uncertain-gender path
 * compares between the two charts, and what the snug/loose note is written from.
 */
export function bestSize(sex, girths) {
  const chest = girths?.chest;
  if (!Number.isFinite(chest)) return null;
  const chart = CHARTS[sex];
  const key = sex === 'female' ? 'bust' : 'chest';
  const also = [['waist', girths?.waist], ['hips', girths?.hips]].filter(([, v]) => Number.isFinite(v));
  let best = null;
  for (const [sizeKey, row] of Object.entries(chart)) {
    const chestDiff = Math.abs(chest - row[key]);
    const worst = also.reduce((m, [k, v]) => Math.max(m, Math.abs(v - row[k])), chestDiff);
    if (!best || worst < best.misfit) best = { sizeKey, row, key, diff: chestDiff, misfit: worst };
  }
  return best;
}
