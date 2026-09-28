import sharp from 'sharp';
import { config } from '../config.js';
import { db, bucket } from '../lib/supabase.js';
import { describeGarment, cloudflareConfigured } from '../lib/cloudflare.js';
import { processGarmentPixels, resolveCategory } from '../shared/silhouette.js';

const log = (...a) => console.log('[pipeline]', ...a);

export const paths = (userId, garmentId) => ({
  original: `${userId}/${garmentId}/original.jpg`,
  texture: `${userId}/${garmentId}/texture.png`,
  preview: `${userId}/${garmentId}/preview.jpg`,
});

/** Decode → cut out → measure → describe. Pure function of the image bytes. */
export async function analyzeImage(buffer) {
  const N = config.processingSize;
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: N, height: N, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { cutout, geometry } = processGarmentPixels(data, info.width, info.height);

  const texture = await sharp(Buffer.from(cutout.rgba.buffer, cutout.rgba.byteOffset, cutout.rgba.byteLength), {
    raw: { width: cutout.width, height: cutout.height, channels: 4 },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

  const preview = await sharp(texture)
    .flatten({ background: '#ffffff' })
    .resize({ width: 512, height: 512, fit: 'inside' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  let analysis = {};
  let aiError = null;
  if (cloudflareConfigured()) {
    try { analysis = await describeGarment(preview); }
    catch (err) { aiError = err.message; log('vision failed:', err.message); }
  } else {
    aiError = 'Cloudflare AI not configured';
  }

  const category = resolveCategory(analysis.type, geometry.guess);
  return { texture, preview, geometry, analysis: { ...analysis, ai_error: aiError }, category, size: { width: cutout.width, height: cutout.height } };
}

/** Full background job for one garment row. Never throws. */
export async function processGarment({ garmentId, userId, buffer }) {
  const t0 = Date.now();
  const p = paths(userId, garmentId);
  try {
    if (!buffer) {
      const { data, error } = await bucket().download(p.original);
      if (error) throw new Error(`Original image missing: ${error.message}`);
      buffer = Buffer.from(await data.arrayBuffer());
    } else {
      const original = await sharp(buffer, { failOn: 'none' }).rotate()
        .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      const up = await bucket().upload(p.original, original, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
    }

    const r = await analyzeImage(buffer);

    for (const [path, body, type] of [[p.texture, r.texture, 'image/png'], [p.preview, r.preview, 'image/jpeg']]) {
      const up = await bucket().upload(path, body, { contentType: type, upsert: true });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
    }

    const { data: current } = await db().from('garments').select('name, category_locked, category').eq('id', garmentId).single();
    const patch = {
      status: 'ready',
      error: null,
      original_path: p.original,
      texture_path: p.texture,
      preview_path: p.preview,
      width: r.size.width,
      height: r.size.height,
      geometry: r.geometry,
      analysis: r.analysis,
      processed_at: new Date().toISOString(),
    };
    if (!current?.category_locked) patch.category = r.category;
    if (!current?.name && r.analysis.name) patch.name = r.analysis.name;

    const { error } = await db().from('garments').update(patch).eq('id', garmentId).eq('user_id', userId);
    if (error) throw new Error(error.message);
    log(`ready ${garmentId} (${r.category}, ${r.geometry.segmentation.method}) in ${Date.now() - t0}ms`);
  } catch (err) {
    log(`failed ${garmentId}:`, err.message);
    await db().from('garments').update({ status: 'failed', error: String(err.message).slice(0, 500) })
      .eq('id', garmentId).eq('user_id', userId);
  }
}

/** Create the private storage bucket if the migration didn't (self-healing on boot). */
export async function ensureBucket() {
  const name = config.supabase.bucket;
  const { data } = await db().storage.getBucket(name);
  if (data) return;
  const { error } = await db().storage.createBucket(name, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  });
  if (error && !/exists/i.test(error.message)) throw error;
  log(`created storage bucket "${name}"`);
}

/** A process restart kills in-flight jobs. Mark them failed so users can retry. */
export async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await db().from('garments')
    .update({ status: 'failed', error: 'Processing was interrupted — tap retry.' })
    .eq('status', 'processing').lt('updated_at', cutoff).select('id');
  if (!error && data?.length) log(`recovered ${data.length} stale job(s)`);
}
