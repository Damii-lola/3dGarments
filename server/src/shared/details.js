/**
 * Garment DETAILS from product photos (a garment on a hanger, a flat-lay): what the 3D garment is built with beyond its
 * cut — collar, closure and buttons, placket, pockets, cuffs, hem, the fabric and its finish. A vision-language model
 * reads the photos and answers in words from a fixed vocabulary (it describes well in words; numbers it guesses
 * badly, so positions are measured on the photo by the client — garments/details.js); every value is validated here.
 * Runs unchanged in Node and the browser.
 */

export const DETAILS_VOCAB = {
  collar_style: ['none', 'spread', 'point', 'button_down', 'cutaway', 'camp', 'mandarin', 'band', 'club', 'polo', 'shawl', 'notch_lapel', 'peak_lapel', 'hood', 'crew_rib', 'v_rib', 'turtleneck'],
  collar_worn: ['open', 'closed'],
  closure: ['buttons', 'zipper', 'snaps', 'toggles', 'pullover', 'wrap', 'none'],
  button_style: ['round_4hole', 'round_2hole', 'shank', 'snap', 'toggle', 'none'],
  placket: ['plain', 'french', 'concealed', 'none'],
  pocket_kind: ['patch', 'patch_flap', 'welt', 'kangaroo', 'zip', 'jeans'],
  pocket_place: ['chest_left', 'chest_right', 'chest_both', 'waist_both', 'hip_both', 'back_both', 'front_center'],
  sleeve_length: ['sleeveless', 'cap', 'short', 'elbow', 'three_quarter', 'long'],
  cuff: ['none', 'hemmed', 'rolled', 'buttoned', 'ribbed', 'elastic'],
  hem: ['straight', 'curved', 'shirt_tail', 'split_sides', 'ribbed', 'elastic', 'asymmetric', 'raw'],
  material: ['cotton', 'linen', 'silk', 'satin', 'polyester', 'viscose', 'denim', 'knit_jersey', 'rib_knit', 'wool', 'fleece', 'leather', 'chiffon', 'jacquard', 'corduroy', 'velvet', 'other'],
  finish: ['matte', 'soft_sheen', 'glossy', 'metallic', 'fuzzy'],
  pattern: ['solid', 'print', 'floral', 'stripes', 'checks', 'plaid', 'graphic', 'logo', 'jacquard', 'embroidery', 'tie_dye', 'camouflage', 'other'],
  weight: ['sheer', 'light', 'medium', 'heavy'],
  stretch: ['none', 'some', 'stretchy'],
  extras: ['shoulder_yoke', 'back_pleat', 'back_box_pleat', 'chest_logo', 'epaulettes', 'contrast_stitching', 'drawstring', 'belt_loops', 'belt', 'side_vents', 'darts', 'ruffles', 'lace_trim', 'piping'],
};

const V = DETAILS_VOCAB;
export const DETAILS_PROMPT = `You are a garment technologist preparing a 3D model of the garment in this product photo (on a hanger,
a mannequin or laid flat). Describe its construction DETAILS. Answer with strict JSON only, no prose, choosing every value
ONLY from the options listed:
{"collar": {"style": ${V.collar_style.join('|')}, "worn": ${V.collar_worn.join('|')}},
 "closure": {"type": ${V.closure.join('|')}, "buttons_visible": a whole number 0-14 (buttons you can see on the front),
             "button_style": ${V.button_style.join('|')}, "button_color": "#rrggbb", "placket": ${V.placket.join('|')}},
 "pockets": [ {"kind": ${V.pocket_kind.join('|')}, "place": ${V.pocket_place.join('|')}} ],
 "sleeves": {"length": ${V.sleeve_length.join('|')}, "cuff": ${V.cuff.join('|')}},
 "hem": ${V.hem.join('|')},
 "fabric": {"material": ${V.material.join('|')}, "finish": ${V.finish.join('|')}, "pattern": ${V.pattern.join('|')},
            "weight": ${V.weight.join('|')}, "stretch": ${V.stretch.join('|')}},
 "colors": {"main": "#rrggbb", "secondary": "#rrggbb or null"},
 "extras": [ only from: ${V.extras.join('|')} ],
 "under": "the kind of garment shown INSIDE this one if any (a tee in an open shirt), else null",
 "accessories": [ things styled with it that are NOT part of it: necklace, chain, hanger, belt, scarf, tie, tag … ] }
Rules:
- Describe ONLY the main garment; what is shown inside it or hung on it is not part of it.
- "rolled" cuffs: sleeves turned up into a folded band. "camp" collar: a flat open collar with no stand.
- buttons_visible counts buttons on the front of the main garment only (not on cuffs or collar points).
- Colours are the fabric's own colour as seen, not the background.`;

const pick = (v, allowed, dflt) => {
  const t = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.includes(t) ? t : dflt;
};
const hex = (v) => (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? `#${v.trim().replace('#', '').toLowerCase()}` : null);

/** the model's answer (text or object) → a validated detail sheet (unknowns → safe defaults) */
export function parseDetails(answer) {
  if (typeof answer === 'string') {
    const s = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
    try { answer = s ? JSON.parse(s) : {}; } catch { answer = {}; }
  }
  const a = answer || {};
  const c = a.collar || {}, cl = a.closure || {}, sl = a.sleeves || {}, f = a.fabric || {}, col = a.colors || {};
  const n = Math.round(Number(cl.buttons_visible));
  return {
    collar: { style: pick(c.style, V.collar_style, 'none'), worn: pick(c.worn, V.collar_worn, 'open') },
    closure: {
      type: pick(cl.type, V.closure, 'none'),
      buttons: Number.isFinite(n) ? Math.max(0, Math.min(14, n)) : 0,
      buttonStyle: pick(cl.button_style, V.button_style, 'round_4hole'),
      buttonColor: hex(cl.button_color),
      placket: pick(cl.placket, V.placket, 'plain'),
    },
    pockets: (Array.isArray(a.pockets) ? a.pockets : []).slice(0, 6).map((p) => ({ kind: pick(p?.kind, V.pocket_kind, null), place: pick(p?.place, V.pocket_place, null) }))
      .filter((p) => p.kind && p.place),
    sleeves: { length: pick(sl.length, V.sleeve_length, 'short'), cuff: pick(sl.cuff, V.cuff, 'hemmed') },
    hem: pick(a.hem, V.hem, 'straight'),
    fabric: {
      material: pick(f.material, V.material, 'cotton'), finish: pick(f.finish, V.finish, 'matte'), pattern: pick(f.pattern, V.pattern, 'solid'),
      weight: pick(f.weight, V.weight, 'medium'), stretch: pick(f.stretch, V.stretch, 'none'),
    },
    colors: { main: hex(col.main), secondary: hex(col.secondary) },
    extras: (Array.isArray(a.extras) ? a.extras : []).map((e) => pick(e, V.extras, null)).filter(Boolean),
    under: typeof a.under === 'string' && a.under.trim() && a.under.trim().toLowerCase() !== 'null' ? a.under.trim().slice(0, 40) : null,
    accessories: (Array.isArray(a.accessories) ? a.accessories : []).filter((x) => typeof x === 'string').map((x) => x.trim().toLowerCase().slice(0, 30)).slice(0, 8),
  };
}
