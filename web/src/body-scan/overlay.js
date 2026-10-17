/**
 * A picture of what the measurement actually read.
 *
 * A refusal is nearly always something you can SEE — "your arm was lying against
 * your ribs", "your feet were not in frame" — and nearly never something a table
 * of numbers can show. So each sampled frame is drawn with the person mask the
 * widths were read from, the pose joints, and the rows the widths were measured
 * at, labelled in inches from the same head-length scale the app uses.
 *
 * The landmarks drawn are exactly the ones that were sent to the server, so if a
 * number looks wrong, this is the picture it came from. Pure DOM: the mask
 * arrives as the same Float32Array the silhouette module reads.
 */

import { HEAD_LENGTH_CM, MASK_ON } from './silhouette.js';

/**
 * The rows drawn, top to bottom. The landmark names are the ones the silhouette
 * emits — the chest row is named for the armpit it is read at, not the chest.
 */
const ROWS = [
  { left: 'armpitL', right: 'armpitR', name: 'chest', ink: '#ff5b3a' },
  { left: 'waistL', right: 'waistR', name: 'waist', ink: '#ffd23a' },
  { left: 'hipL', right: 'hipR', name: 'hips', ink: '#5cc8ff' },
];

/**
 * A label placer: draws a chip of text near (x, y) and keeps it from landing on
 * top of a chip already drawn — the chest, waist and hips rows can sit a few
 * pixels apart on a straight silhouette, and three labels on one another tell
 * the reader nothing.
 */
function labeller(ctx) {
  const placed = [];
  return function label(text, x, y, ink) {
    const size = Math.max(10, Math.round(ctx.canvas.width / 26));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const pad = Math.max(2, Math.round(size * 0.25));
    const w = ctx.measureText(text).width + pad * 2;
    const h = size + pad * 2;
    const left = Math.min(Math.max(0, x), Math.max(0, ctx.canvas.width - w));
    let top = Math.round(y) - h - 4;
    if (top < 0) top = Math.round(y) + 4;
    const hits = (r) => left < r.left + r.w && left + w > r.left && top < r.top + r.h && top + h > r.top;
    for (let guard = 0; guard < 8 && placed.some(hits); guard += 1) top += h + 2;
    placed.push({ left, top, w, h });

    ctx.fillStyle = 'rgba(5, 7, 11, 0.82)';
    ctx.fillRect(left, top, w, h);
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';
    ctx.fillText(text, left + pad, top + pad);
  };
}

/** The person, as a translucent wash in the shape the mask says. */
function wash(ctx, mask, maskW, maskH, w, h) {
  const sheet = document.createElement('canvas');
  sheet.width = maskW;
  sheet.height = maskH;
  const sctx = sheet.getContext('2d');
  const img = sctx.createImageData(maskW, maskH);
  const px = img.data;
  for (let i = 0; i < maskW * maskH; i += 1) {
    if (!(mask[i] > MASK_ON)) continue;
    const at = i * 4;
    px[at] = 61;
    px[at + 1] = 220;
    px[at + 2] = 151;
    px[at + 3] = 120;
  }
  sctx.putImageData(img, 0, 0);
  ctx.drawImage(sheet, 0, 0, w, h);
}

/** The joints, and the rows the widths came from. */
function rows(ctx, lm, w, h, cmPerWidth, sideOn) {
  const X = (v) => (v / 100) * w;
  const Y = (v) => (v / 100) * h;
  const label = labeller(ctx);
  const thin = Math.max(1, Math.round(w / 300));

  // The pose's joint lines: the arm line is what decides whether a row can be
  // trusted, so it is drawn even when no row was measured from it.
  ctx.fillStyle = 'rgba(238, 240, 244, 0.75)';
  for (const key of ['shoulderL', 'shoulderR', 'armL', 'armR', 'neckL', 'neckR']) {
    const p = lm[key];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), thin * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head length: the one constant in the whole measurement — everything scales
  // from it — so it is worth showing where it was read.
  if (lm.headTop && lm.chin) {
    ctx.save();
    ctx.strokeStyle = 'rgba(61, 220, 151, 0.85)';
    ctx.lineWidth = thin;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(X(lm.headTop.x), Y(lm.headTop.y));
    ctx.lineTo(X(lm.chin.x), Y(lm.chin.y));
    ctx.stroke();
    ctx.restore();
    label(`head ${HEAD_LENGTH_CM}cm`, X(lm.headTop.x) + 4, Y(lm.chin.y), '#3ddc97');
  }

  if (lm.shoulderL && lm.shoulderR) {
    ctx.strokeStyle = 'rgba(238, 240, 244, 0.55)';
    ctx.lineWidth = thin;
    ctx.beginPath();
    ctx.moveTo(X(lm.shoulderL.x), Y(lm.shoulderL.y));
    ctx.lineTo(X(lm.shoulderR.x), Y(lm.shoulderR.y));
    ctx.stroke();
  }

  for (const { left, right, name, ink } of ROWS) {
    const a = lm[left];
    const b = lm[right];
    if (!a || !b) continue;
    const x0 = X(a.x);
    const x1 = X(b.x);
    const y = Y(a.y);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(2, thin * 2);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    // End ticks, so the two edges being measured are unmistakable.
    ctx.beginPath();
    ctx.moveTo(x0, y - thin * 6);
    ctx.lineTo(x0, y + thin * 6);
    ctx.moveTo(x1, y - thin * 6);
    ctx.lineTo(x1, y + thin * 6);
    ctx.stroke();

    // Seen side-on the same line spans the body's front-to-back depth, which is
    // a different measurement wearing the same name — say which it is.
    const text = cmPerWidth > 0
      ? `${name}${sideOn ? ' depth' : ''} ${(((b.x - a.x) / 100) * cmPerWidth / 2.54).toFixed(1)}"`
      : `${name}${sideOn ? ' depth' : ''}`;
    label(text, Math.min(x0, x1), y - thin * 7, ink);
  }
}

/**
 * One frame, as a JPEG data URL.
 *
 * @param {{src: HTMLCanvasElement|HTMLVideoElement, mask?: Float32Array,
 *          maskW?: number, maskH?: number, landmarks?: object|null,
 *          cmPerWidth?: number, sideOn?: boolean, maxWidth?: number,
 *          quality?: number}} opts
 *   `landmarks` null draws the bare frame — which is what "no person found in
 *   this frame" should look like.
 * @returns {string|null} data URL, or null if there is nothing to draw
 */
export function drawMeasuredFrame({
  src,
  mask = null,
  maskW = 0,
  maskH = 0,
  landmarks = null,
  cmPerWidth = 0,
  sideOn = false,
  maxWidth = 360,
  quality = 0.7,
}) {
  if (!src || !src.width || !src.height) return null;
  const w = Math.max(1, Math.round(Math.min(maxWidth, src.width)));
  const h = Math.max(1, Math.round((w * src.height) / src.width));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  // Put the picture back a stop so the wash and the row lines read over a
  // bright wall as well as over a dark one.
  ctx.fillStyle = 'rgba(6, 8, 12, 0.35)';
  ctx.fillRect(0, 0, w, h);

  if (mask && maskW && maskH) wash(ctx, mask, maskW, maskH, w, h);
  if (landmarks) rows(ctx, landmarks, w, h, cmPerWidth, sideOn);

  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch (e) {
    console.warn('[3dg:overlay] could not encode the frame:', e.message);
    return null;
  }
}
