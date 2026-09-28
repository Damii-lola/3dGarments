/**
 * Garment textures.
 *   front – the cut-out photo.
 *   back  – a synthesised back panel: the photo's colours, low-passed so logos,
 *           prints and buttons don't ghost through mirrored, with the front
 *           neckline filled in (backs sit higher at the neck).
 */
import * as THREE from 'three';
import { makeAlphaSampler } from './wrap.js';
import { WRAP_MODE } from '@shared/silhouette.js';

const ALPHA_GRID = 256;

async function pixelsOf(garment) {
  if (garment.local) return garment.local;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.decoding = 'async';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not load garment texture'));
    i.src = garment.texture_url;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  return { rgba: data, width: c.width, height: c.height };
}

function toTexture(rgba, width, height, anisotropy) {
  // flip rows so uv.y = 1 is the top of the photo (matches wrap.js)
  const out = new Uint8Array(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(rgba.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  const tex = new THREE.DataTexture(out, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function backPixels(src, width, height, garment) {
  // mean garment colour
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < src.length; i += 16) if (src[i + 3] > 200) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
  const mean = n ? [r / n, g / n, b / n] : [128, 128, 128];

  // low-pass: shrink → blur → grow, on an opaque mean-colour backdrop
  const small = 12;
  const sw = Math.max(4, Math.round((width / Math.max(width, height)) * small));
  const sh = Math.max(4, Math.round((height / Math.max(width, height)) * small));
  const full = document.createElement('canvas');
  full.width = width; full.height = height;
  full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src), width, height), 0, 0);
  const sc = document.createElement('canvas');
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = `rgb(${mean.map(Math.round).join(',')})`;
  sctx.fillRect(0, 0, sw, sh);
  sctx.filter = 'blur(1.6px)';
  sctx.drawImage(full, 0, 0, sw, sh);
  const up = document.createElement('canvas');
  up.width = width; up.height = height;
  const uctx = up.getContext('2d', { willReadFrequently: true });
  uctx.imageSmoothingQuality = 'high';
  uctx.drawImage(sc, 0, 0, width, height);
  const blurred = uctx.getImageData(0, 0, width, height).data;

  const out = new Uint8ClampedArray(src.length);
  const keep = 0.06; // a whisper of the original texture keeps fabric grain
  for (let i = 0; i < src.length; i += 4) {
    out[i] = blurred[i] * (1 - keep) + src[i] * keep;
    out[i + 1] = blurred[i + 1] * (1 - keep) + src[i + 1] * keep;
    out[i + 2] = blurred[i + 2] * (1 - keep) + src[i + 2] * keep;
    out[i + 3] = src[i + 3];
  }

  // close the front neckline on the back panel
  const geo = garment.geometry;
  const mode = WRAP_MODE[garment.category] || 'upper';
  if (geo && (mode === 'upper' || mode === 'full')) {
    const ext = geo.bottom - geo.top;
    const yStart = Math.round((geo.top + ext * 0.03) * height);
    const yEnd = Math.round((geo.armpit != null ? Math.min(geo.armpit, geo.top + ext * 0.3) : geo.top + ext * 0.2) * height);
    const cx = Math.round(geo.centerX * height);
    for (let y = Math.max(0, yStart); y < Math.min(height, yEnd); y++) {
      const o = y * width;
      if (out[(o + cx) * 4 + 3] >= 128) continue;
      let l = cx, rr = cx;
      while (l > 0 && out[(o + l) * 4 + 3] < 128) l--;
      while (rr < width - 1 && out[(o + rr) * 4 + 3] < 128) rr++;
      if (l <= 0 || rr >= width - 1) continue;
      for (let x = l; x <= rr; x++) {
        const p = (o + x) * 4;
        out[p] = blurred[p]; out[p + 1] = blurred[p + 1]; out[p + 2] = blurred[p + 2]; out[p + 3] = 255;
      }
    }
  }
  return out;
}

export async function loadGarmentTextures(garment, anisotropy = 4) {
  const { rgba, width, height } = await pixelsOf(garment);
  const front = toTexture(rgba, width, height, anisotropy);
  const backData = backPixels(rgba, width, height, garment);
  const back = toTexture(backData, width, height, anisotropy);

  // culling grid covers both panels
  const aw = Math.min(ALPHA_GRID, width), ah = Math.min(ALPHA_GRID, height);
  const alpha = new Uint8Array(aw * ah);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const sx = Math.round((x / (aw - 1 || 1)) * (width - 1)), sy = Math.round((y / (ah - 1 || 1)) * (height - 1));
    const p = (sy * width + sx) * 4 + 3;
    alpha[y * aw + x] = Math.max(rgba[p], backData[p]);
  }
  return { front, back, alphaAt: makeAlphaSampler(alpha, aw, ah), dispose() { front.dispose(); back.dispose(); } };
}
