/**
 * Every image that reaches sharp here came off the network: a file a shopper
 * uploaded, a photo pulled out of a user's bucket, a frame ffmpeg cut out of a
 * clip. Some of those are compressed, and a compressed file can describe a very
 * large canvas in very few bytes - a 15 MB PNG at 20000x20000 is 1.6 GB of RGBA
 * once decoded, and the free Render instance has 512 MB. sharp's own default
 * ceiling is 268 megapixels, which is far above what this server can hold.
 *
 * So decoding goes through `inputSharp`, which refuses anything above
 * `MAX_INPUT_PIXELS` before a pixel is allocated. 50 MP is comfortably above
 * every phone camera the app accepts, and low enough that a worst-case decode
 * still fits in the instance.
 */
import sharp from 'sharp';
import { config } from '../config.js';

export const MAX_INPUT_PIXELS = config.limits.maxInputPixels;

/** sharp() for untrusted bytes: the caller's options plus the pixel ceiling. */
export function inputSharp(buffer, options = {}) {
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, ...options });
}

/**
 * A message a person can act on when sharp refused an image for its size, or
 * null when the error was something else. The raw error ("Input image exceeds
 * pixel limit") reads like a bug rather than a rejection.
 */
export function pixelLimitMessage(err) {
  if (!/pixel limit/i.test(String(err?.message || ''))) return null;
  return `That photo is too large to process (over ${Math.round(MAX_INPUT_PIXELS / 1e6)} megapixels).`;
}
