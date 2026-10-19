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
 *
 * The charts below are the fallback. A store that has typed its own chart gets
 * sized against that instead (chartFromInput, below), and the same rules apply
 * either way: a chart is still a table of girths, and the size is still the row
 * with the smallest worst disagreement.
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
 * Which column a chart is scored on: the one every row actually has.
 *
 * A store's chart may carry a chest column, a bust column, or nothing but a
 * waist and an inseam. It follows the table, not the sex, so a men's shirt chart
 * that the store typed as "chest" is not read as a bust chart just because the
 * shopper picked "a woman". Null means the chart has no girth column at all and
 * cannot size anybody.
 */
export function chartKey(chart) {
  const rows = Object.values(chart || {});
  if (!rows.length) return null;
  const every = (key) => rows.every((row) => Number.isFinite(row?.[key]));
  if (every('chest')) return 'chest';
  if (every('bust')) return 'bust';
  return null;
}

/**
 * The size whose WORST disagreement with any measured girth is the smallest.
 *
 * Worst case rather than average, because the garment that can be worn is the one
 * that is loose somewhere; the one that is snug somewhere is the one that does not
 * close. An exact tie keeps the smaller size — which for a store's chart means the
 * earlier row, so a chart typed smallest-first answers a tie with the smaller
 * size, exactly as the built-in ones do.
 *
 * `girths` is the adjusted measurement set: `chest` is required (for a woman it is
 * read against the chart's bust column), `waist` and `hips` are used when the clip
 * showed them AND the chart has that column. Fewer columns simply means a narrower
 * search, and with only the chest this is the nearest-nominal rule it replaces.
 *
 * `diff` stays the chest/bust difference: it is what the uncertain-gender path
 * compares between the two charts, and what the snug/loose note is written from.
 */
export function bestSize(sex, girths, chart = CHARTS[sex]) {
  const chest = girths?.chest;
  if (!Number.isFinite(chest)) return null;
  const rows = chart || {};
  const key = chartKey(rows) || (sex === 'female' ? 'bust' : 'chest');
  const every = (k) => Object.values(rows).every((row) => Number.isFinite(row?.[k]));
  const also = [['waist', girths?.waist], ['hips', girths?.hips]]
    .filter(([k, v]) => Number.isFinite(v) && every(k));
  let best = null;
  for (const [sizeKey, row] of Object.entries(rows)) {
    if (!Number.isFinite(row?.[key])) continue;
    const chestDiff = Math.abs(chest - row[key]);
    const worst = also.reduce((m, [k, v]) => Math.max(m, Math.abs(v - row[k])), chestDiff);
    if (!best || worst < best.misfit) best = { sizeKey, row, key, diff: chestDiff, misfit: worst };
  }
  return best;
}

/**
 * A store's own chart, as it was typed, in the shape the sizing above wants:
 * inches, one entry per size, keyed by the label the store gave that size.
 *
 * The unit belongs to the chart, not to the reader: a chart typed in centimetres
 * is converted here, once, rather than in every place that reads a chart. The
 * plausibility bounds are wide — a garment girth between 10" and 100" — and a row
 * that cannot be scored is dropped rather than guessed at, so one broken row does
 * not lose the other five. A row with no chest/bust cannot be scored at all and
 * is skipped for the same reason.
 *
 * Returns null when nothing usable is left, and the caller falls back to the
 * built-in chart rather than sizing a body against an empty table.
 */
export function chartFromInput(input) {
  if (!input || typeof input !== 'object') return null;
  const cm = input.unit === 'cm';
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const out = {};
  for (const row of rows) {
    const label = typeof row?.key === 'string' ? row.key.trim().slice(0, 14) : '';
    // Two rows with the same label are the same size; the first one wins, because
    // that is the order the store typed them in.
    if (!label || out[label]) continue;
    const r = {};
    for (const k of ['chest', 'bust', 'waist', 'hips', 'height']) {
      const n = Number(row?.[k]);
      if (!Number.isFinite(n)) continue;
      const inch = cm ? n / 2.54 : n;
      if (inch >= 10 && inch <= 100) r[k] = Math.round(inch * 10) / 10;
    }
    if (!Number.isFinite(r.chest) && !Number.isFinite(r.bust)) continue;
    out[label] = r;
  }
  return Object.keys(out).length ? out : null;
}
