/**
 * Try-on in the app: a garment photo → the clothes in it, made and worn on the model (pipeline.js, every system in
 * the browser except the garment words and the sewing pattern, which the API makes: /api/ngl/describe, /api/ngl/pattern).
 *
 *   const tryOn = createTryOn({ human, stage });
 *   await tryOn.wear(bitmap, (step) => …, (sex) => …);   // replaces whatever was worn; may switch the model's sex
 *                                                        // (whose clothes): onSex lets the app put that body on first
 *   tryOn.follow();                            // after a body-shape change: the garments follow the body's morphs
 *   tryOn.takeOff();
 */
import { garmentsFromPhoto } from './pipeline.js';
import { api } from '../services/api.js';
import { API_URL } from '../services/config.js';
import { prefetchModels } from './models.js';
import { parseModel } from './parse.js';
import { poseModel } from './pose.js';

/** an uploaded image ({ blob } locally, { url } from the cloud) → ImageBitmap, upright */
export async function photoBitmap(img) {
  const blob = img.blob || (await (await fetch(img.url)).blob());
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/** a dropped connection or a server restarting (Render's free tier) is tried again, twice; a refusal (4xx) is not */
async function retry(call, tries = 3) {
  for (let k = 1; ; k++) {
    try { return await call(); } catch (err) {
      if (k >= tries || (err.status && err.status < 500)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * k));
    }
  }
}

/** what every try-on needs, fetched while the user is still choosing photos: the two photo models (cached on disk
 *  after the first visit) and the API (a sleeping Render instance takes ~30 s to start) */
export function prepareTryOn() {
  prefetchModels([parseModel(), poseModel()]);
  fetch(`${API_URL}/health`).catch(() => {});
}

export function createTryOn({ human, stage }) {
  let worn = [];        // sew.js results
  let busy = null;

  const show = () => {
    const hide = new Set(), deep = new Set();
    for (const w of worn) { for (const i of w.hide) hide.add(i); for (const i of w.deep || []) deep.add(i); }
    for (const b of Object.values(human.bodies)) if (b !== human.active) b.setHidden(new Set());
    human.active.setHidden(hide, deep);
    stage.invalidate(4);
  };

  const takeOff = () => {
    for (const w of worn) w.dispose();
    worn = [];
    for (const b of Object.values(human.bodies)) b.setHidden(new Set());
    stage.invalidate(4);
  };

  return {
    get wearing() { return worn.length > 0; },
    get busy() { return !!busy; },
    /** @returns [{ zone, garment, sex, source }] what was made */
    async wear(image, onStep = () => {}, onSex = null) {
      if (busy) throw new Error('Already dressing the model — one photo at a time');
      busy = (async () => {
        takeOff();
        const res = await garmentsFromPhoto(human, image, {
          describe: (jpeg) => retry(() => api('/api/ngl/describe', { method: 'POST', body: { image: jpeg }, timeout: 120_000 })),
          pattern: (req) => retry(() => api('/api/ngl/pattern', { method: 'POST', body: req, timeout: 120_000 })),
          onStep, onSex,
          // the app's budget is ~30 s a photo: one re-cut to the photo when the first cut is clearly off, no CLIPSeg (139 MB) or LaMa (208 MB) —
          // the clothes parser, the jewellery detector and fill.js do their jobs in a fraction of the time
          fitRounds: 1, fitTolerance: 0.25, search: false, painter: 'patch', parseSize: 384,
        });
        worn = res.map((r) => r.built);
        show();
        return res.map(({ zone, garment, sex, source }) => ({ zone, garment, sex, source }));
      })();
      try { return await busy; } finally { busy = null; }
    },
    takeOff,
    follow() {
      const infl = human.active.mesh.morphTargetInfluences || [];
      for (const w of worn) w.follow?.(infl);
      if (worn.length) stage.invalidate(2, true);
    },
  };
}
