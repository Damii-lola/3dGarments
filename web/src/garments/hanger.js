/**
 * Garment photos taken on a HANGER (a shop's product shots: front, back, close-ups) → the garment layered on the
 * bodysuit (layer.js), exactly as it looks on the hanger.
 *
 *   isHangerPhoto(parsed)                      no wearer in it (hardly any skin / face / limbs)
 *   await hangerGarment(human, images, { onStep, describe, onSex })
 *
 * Of a group's photos, the ones that show the WHOLE garment (inside the frame, not a close-up) are the views: the
 * first is the front, the second the back (the order shops list them in). Each is cut out of its background
 * (the clothes parser; the hanger reads as "hat" and isn't clothing) and cleaned: the hanger hook, a garment shown
 * worn under it (a tee in an open shirt: underIn), a necklace hung on it, painted / opened as clean.js does.
 */
import { parsePhoto, cutGarment } from './parse.js';
import { cleanGarment } from './clean.js';
import { layerGarment } from './layer.js';
import { findButtons, buttonFace } from './details.js';

const SKIN = [11, 12, 13, 14, 15];                     // face, legs, arms

export function isHangerPhoto(parsed) {
  let skin = 0;
  for (const l of parsed.label) if (SKIN.includes(l)) skin++;
  return skin / parsed.label.length < 0.012;
}

/** the garment whole in this photo — its top and its hem inside the frame (product shots crop tight on the
 *  sleeves: the sides may touch it), big enough: a view, not a close-up */
function wholeView(parsed, cut) {
  const { w, h } = parsed, { x, y, w: bw, h: bh } = cut.bbox;
  const m = 0.012;
  const inside = y > h * m && y + bh < h * (1 - m) && bw > 0.25 * w;
  const share = cut.mask.reduce((a, v) => a + v, 0) / (w * h);
  return inside && share > 0.06 && bh > 0.3 * h;
}

/**
 * @param images   the group's photos (drawables), in the order they were added
 * @param opts     { onStep, describe?(jpegDataUrl) → NGL (its made_for picks the model), onSex?(sex), alive?() (false: the
 *                 caller gave up), parsedFirst? (the first photo already parsed at 384²) }
 * @returns [{ zone, garment, built, sex, source: 'hanger' }] (like pipeline.js), or null when no photo shows the
 *          whole garment
 */
export async function hangerGarment(human, images, { onStep = () => {}, describe = null, details = null, onSex = null, alive = () => true, parsedFirst = null } = {}) {
  onStep('Finding the garment in the photos…');
  // whose garment it is (menswear → the male model): the vision model reads the first photo meanwhile
  let described = null, detailed = null;
  if (describe || details) {
    const c = document.createElement('canvas'), k = Math.min(1, 768 / Math.max(images[0].width, images[0].height));
    c.width = Math.round(images[0].width * k); c.height = Math.round(images[0].height * k);
    c.getContext('2d', { willReadFrequently: true }).drawImage(images[0], 0, 0, c.width, c.height);
    const jpeg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88))
      .then((b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }));
    described = describe ? describe(jpeg).catch(() => null) : null;
    // the garment's construction details (collar, buttons, cuffs, fabric: shared/details.js) from the same photo
    if (details) detailed = details(jpeg).then((r) => r?.details || null).catch(() => null);
    await new Promise((r) => setTimeout(r, 0));
  }
  const views = [], closeups = [];
  for (const [k, img] of images.entries()) {
    if (views.length >= 2) { closeups.push(img); continue; }
    const parsed = k === 0 && parsedFirst ? parsedFirst : await parsePhoto(img, 1024, 384);
    const cut = cutGarment(parsed, 'full');
    if (!wholeView(parsed, cut)) { closeups.push(img); continue; }
    views.push({ parsed, cut });
  }
  // the close-ups (a button, the collar, a cuff): a button's face is taken from the clearest one
  let face = null;
  for (const img of closeups) { const f = buttonFace(img); if (f && (!face || f.r > face.r)) face = f; }
  if (!alive()) return null;
  if (!views.length) return null;
  onStep('Taking the hanger and what hangs with it off the garment…');
  const cleaned = [];
  for (const [k, v] of views.entries()) {
    // the front can show a garment worn under it (a tee in an open shirt) and a necklace hung over it
    cleaned.push(await cleanGarment(v.parsed, v.cut, { onGarment: ['necklace', 'chain'], under: k === 0 ? ['top'] : [], onStep: () => {} }));
  }
  const ngl = described ? await described : null;
  // tops for now (shirts, tees, jackets, sweaters): trousers, skirts and dresses on a hanger come next
  const kind = ngl?.garments?.[0]?.type;
  if (kind && !['top', 'shirt', 'sweater', 'hoodie', 'jacket', 'tank'].includes(kind)) {
    throw new Error(`Hanger photos of ${kind === 'pants' ? 'trousers' : kind + 's'} aren't supported yet — tops, shirts and jackets are`);
  }
  const madeFor = ngl?.madeFor;
  const sex = madeFor === 'men' ? 'male' : madeFor === 'women' ? 'female' : human.sex;
  if (!alive()) return null;
  if (sex !== human.sex) { onStep(`Menswear and womenswear differ: dressing the ${sex} model…`); human.setSex(sex); }
  if (onSex) await onSex(sex);
  if (!alive()) return null;
  const det = detailed ? await detailed : null;
  // the buttons the detail sheet counts, found on the front photo (in the cleaned cut-out's garment units)
  const c0 = cleaned[0], scale = c0.cut.height;
  const buttons = det?.closure?.buttons ? findButtons(views[0].parsed, views[0].cut.mask, det.closure.buttons, { buttonColor: det.closure.buttonColor, mainColor: det.colors?.main })
    .map((b) => ({ x: (b.x - c0.bbox.x) / scale, y: (b.y - c0.bbox.y) / scale, r: b.r / scale, color: b.color })) : [];
  const THICK = { sheer: 0.0005, light: 0.0008, medium: 0.0012, heavy: 0.002 };
  onStep('Putting it on…');
  await new Promise((r) => setTimeout(r, 0));
  const built = layerGarment(human, {
    front: { cut: cleaned[0].cut, geometry: cleaned[0].geometry },
    back: cleaned[1] ? { cut: cleaned[1].cut, geometry: cleaned[1].geometry } : null,
  }, { details: det, buttons, buttonFace: face, thick: THICK[det?.fabric?.weight] ?? 0.0012, finish: det?.fabric?.finish });
  if (built) built.details = det;
  if (!built) return [];
  const type = ngl?.garments?.[0]?.type || cleaned[0].geometry.guess;
  return [{ zone: 'upper', garment: { type }, built, sex, source: 'hanger' }];
}
