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
import { hangerGarment, isHangerPhoto } from './hanger.js';
import { parsePhoto } from './parse.js';
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
  let run = 0;          // the try-on in progress (a take-off during it cancels it: its results are dropped)

  const show = () => {
    const hide = new Set(), deep = new Set();
    for (const w of worn) { for (const i of w.hide) hide.add(i); for (const i of w.deep || []) deep.add(i); }
    for (const b of Object.values(human.bodies)) if (b !== human.active) b.setHidden(new Set());
    human.active.setHidden(hide, deep);
    stage.invalidate(4);
  };

  const takeOff = () => {
    run++;
    for (const w of worn) w.dispose();
    worn = [];
    for (const b of Object.values(human.bodies)) b.setHidden(new Set());
    stage.invalidate(4);
  };

  return {
    get wearing() { return worn.length > 0; },
    get busy() { return !!busy; },
    /** @returns [{ zone, garment, sex, source }] what was made, or null when it was taken off before it was done */
    /** images: the group's photos (the first decides: a garment on a hanger → layered on the bodysuit from its
     *  front / back shots; worn by someone → made from that photo) */
    async wear(images, onStep = () => {}, onSex = null) {
      images = [].concat(images);
      const image = images[0];
      if (busy) throw new Error('Already dressing the model — one photo at a time');
      busy = (async () => {
        takeOff();
        const me = run;
        const live = () => me === run;
        let drafted = false;
        const describe = (jpeg) => retry(() => api('/api/ngl/describe', { method: 'POST', body: { image: jpeg }, timeout: 120_000 }));
        const sexHook = onSex && ((sex) => (live() ? onSex(sex) : undefined));
        onStep('Looking at the photos…');
        const first = await parsePhoto(image, 1024, 384);
        if (isHangerPhoto(first)) {
          const details = (jpeg) => retry(() => api('/api/ngl/details', { method: 'POST', body: { image: jpeg }, timeout: 120_000 }));
          const res = await hangerGarment(human, images, { onStep, describe, details, onSex: sexHook, alive: live, parsedFirst: first })
            .catch((e) => { if (!live()) return null; throw e; });
          if (!res || !live()) { for (const r of res || []) r.built.dispose(); return res && live() ? [] : null; }
          worn = res.map((r) => r.built);
          show();
          return res.map(({ zone, garment, sex, source }) => ({ zone, garment, sex, source }));
        }
        const res = await garmentsFromPhoto(human, image, {
          describe,
          pattern: (req) => retry(() => api('/api/ngl/pattern', { method: 'POST', body: req, timeout: 120_000 })),
          onStep: (t) => onStep(drafted && /^Matching|^Trying/.test(t) ? `Dressed — fine-tuning the fit to the photo…` : t),
          onSex: sexHook,
          // each garment is shown the moment its first drape is sewn; the re-cuts to the photo replace it after
          // (two frames: the stage draws it before the next garment's sewing holds the page)
          onDraft: async (builts) => {
            if (!live()) return;
            worn = builts; show(); drafted = true;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          },
          // the app's budget is ~30 s a photo: up to two re-cuts to the photo when the first cut is off (after it's shown), no CLIPSeg
          // (139 MB) or LaMa (208 MB) — the clothes parser, the jewellery detector and fill.js do their jobs in a
          // fraction of the time
          fitRounds: 2, fitTolerance: 0.15, search: false, painter: 'patch', parseSize: 384, parsed: first,
          alive: live,
        }).catch((e) => { if (e.cancelled || !live()) return null; takeOff(); throw e; });
        if (!res || !live()) {                  // taken off meanwhile (another sex, another photo): dropped
          for (const r of res || []) r.built.dispose();
          for (const b of res?.retired || []) b.dispose();
          return null;
        }
        worn = res.map((r) => r.built);
        show();
        for (const b of res.retired || []) b.dispose();
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
