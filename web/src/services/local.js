/**
 * In-browser garment processing — the exact same silhouette engine the server runs.
 * Used in local mode (no account) and for instant previews.
 */
import { processGarmentPixels, resolveCategory } from '@shared/silhouette.js';

const MAX = 1024;

async function decode(source) {
  if (source instanceof Blob) {
    try { return await createImageBitmap(source, { imageOrientation: 'from-image' }); } catch { /* Safari fallback */ }
    const url = URL.createObjectURL(source);
    try { return await loadImg(url); } finally { URL.revokeObjectURL(url); }
  }
  return loadImg(source);
}
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image. Try a JPG or PNG.'));
    img.src = src;
  });
}

export function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** File/Blob/URL → { local:{rgba,width,height}, geometry, category, preview_url } */
export async function processLocally(source) {
  const img = await decode(source);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const scale = Math.min(1, MAX / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  img.close?.();
  const { data } = ctx.getImageData(0, 0, w, h);

  await new Promise((r) => setTimeout(r, 0)); // let the UI paint the spinner
  const { cutout, geometry } = processGarmentPixels(data, w, h);

  const pc = document.createElement('canvas');
  pc.width = cutout.width; pc.height = cutout.height;
  pc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cutout.rgba), cutout.width, cutout.height), 0, 0);
  const preview_url = pc.toDataURL('image/png');

  return {
    local: { rgba: cutout.rgba, width: cutout.width, height: cutout.height },
    geometry,
    category: resolveCategory(null, geometry.guess),
    preview_url,
    width: cutout.width,
    height: cutout.height,
  };
}
