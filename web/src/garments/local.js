/**
 * Garment photos processed in the browser (local mode, and for tests): the same pipeline the API
 * runs (shared/silhouette.js cut-out + measurements, shared/wardrobe.js grouping), without the AI.
 */
import { processGarmentPixels } from '@shared/silhouette.js';
import { colorSignature, buildItems } from '@shared/wardrobe.js';

const SIZE = 1024;   // same as the API's PROCESSING_SIZE

/** decode any image source (Blob, URL, <img>, ImageBitmap) to an ImageBitmap-like drawable */
export async function loadImage(src) {
  if (typeof src === 'string') {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Couldn't load a photo (${res.status})`);
    src = await res.blob();
  }
  if (src instanceof Blob) {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch { /* SVG & co: an <img> decodes them */ }
    const url = URL.createObjectURL(src);
    try { const im = new Image(); im.src = url; await im.decode(); return im; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  if (src instanceof HTMLImageElement && !src.complete) await src.decode();
  return src;
}

/** one photo → { cut: canvas (RGBA cut-out), geometry, signature } */
export async function processPhoto(src) {
  const img = await loadImage(src);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  const k = Math.min(1, SIZE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const { cutout, geometry } = processGarmentPixels(data, w, h);
  const cut = document.createElement('canvas');
  cut.width = cutout.width; cut.height = cutout.height;
  cut.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cutout.rgba.buffer, cutout.rgba.byteOffset, cutout.rgba.byteLength), cutout.width, cutout.height), 0, 0);
  return { cut, geometry, signature: colorSignature(cutout.rgba, cutout.width, cutout.height) };
}

/**
 * A whole group, locally: every photo cut out and measured, then grouped into garments.
 * @param images [{ id, src }]
 * @returns { items, photos: { [id]: { cut, geometry, signature } } }
 */
export async function processGroupLocally(images, onProgress) {
  const photos = {};
  let done = 0;
  for (const im of images) {
    photos[im.id] = await processPhoto(im.src);
    onProgress?.(++done / images.length);
    await new Promise((r) => setTimeout(r, 0));               // keep the page responsive
  }
  const items = buildItems(images.map((im) => ({ id: im.id, geometry: photos[im.id].geometry, signature: photos[im.id].signature })));
  return { items, photos };
}
