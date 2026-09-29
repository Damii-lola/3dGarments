/**
 * Process a garment-photo group (stage 1): every photo is cut out, measured and described, the
 * photos are grouped into garments, and the result is written back onto the group row:
 *
 *   garment_groups.photos = { <imageId>: { cut, preview, width, height, geometry, signature, ai } }
 *   garment_groups.items  = [ item … ]   (shared/wardrobe.js buildItems)
 *   garment_groups.status = processing → ready | failed
 *
 * Cut-outs go to <uid>/groups/<groupId>/cut/<imageId>.{png,jpg}. Runs in the background; never throws.
 */
import sharp from 'sharp';
import { config } from '../config.js';
import { db, bucket } from '../lib/supabase.js';
import { cloudflareConfigured, describeForWardrobe, groupWithAI, describeNGL } from '../lib/cloudflare.js';
import { processGarmentPixels } from '../shared/silhouette.js';
import { colorSignature, colorDistance, buildItems } from '../shared/wardrobe.js';

const log = (...a) => console.log('[groups]', ...a);
const running = new Set();

/** decode → cut out → measure → colour signature (no AI) */
export async function cutPhoto(buffer) {
  const N = config.processingSize;
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: N, height: N, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { cutout, geometry } = processGarmentPixels(data, info.width, info.height);
  const png = await sharp(Buffer.from(cutout.rgba.buffer, cutout.rgba.byteOffset, cutout.rgba.byteLength), {
    raw: { width: cutout.width, height: cutout.height, channels: 4 },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const preview = await sharp(png).flatten({ background: '#ffffff' })
    .resize({ width: 512, height: 512, fit: 'inside' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { png, preview, geometry, signature: colorSignature(cutout.rgba, cutout.width, cutout.height), width: cutout.width, height: cutout.height };
}

const ZONE_TYPES = {
  upper: ['top', 'shirt', 'sweater', 'hoodie', 'jacket', 'tank'],
  lower: ['skirt', 'pants', 'shorts'],
  full: ['dress', 'jumpsuit'],
};
/** a photo can show a whole outfit: the described garment that matches this item's zone */
function pickForZone(garments, zone) {
  if (!garments?.length) return null;
  return garments.find((g) => ZONE_TYPES[zone]?.includes(g.type)) || (garments.length === 1 ? garments[0] : null);
}

/** the whole job for one group; never throws */
export async function processGroup({ groupId, userId }) {
  if (running.has(groupId)) return;
  running.add(groupId);
  const t0 = Date.now();
  const fail = async (msg) => {
    log(`failed ${groupId}: ${msg}`);
    await db().from('garment_groups').update({ status: 'failed', error: String(msg).slice(0, 500) }).eq('id', groupId).eq('user_id', userId);
  };
  try {
    const { data: row, error } = await db().from('garment_groups').select('id, images').eq('id', groupId).eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return;
    const images = (row.images || []).filter((i) => typeof i.path === 'string' && i.path.startsWith(`${userId}/`));
    if (!images.length) { await fail('This group has no photos.'); return; }

    const photos = [];
    const stored = {};
    const previews = {};
    const ai = cloudflareConfigured();
    for (const img of images) {
      const { data: file, error: e } = await bucket().download(img.path);
      if (e) throw new Error(`Couldn't read ${img.name || 'a photo'}: ${e.message}`);
      const c = await cutPhoto(Buffer.from(await file.arrayBuffer()));
      const base = `${userId}/groups/${groupId}/cut/${img.id}`;
      for (const [path, body, type] of [[`${base}.png`, c.png, 'image/png'], [`${base}.jpg`, c.preview, 'image/jpeg']]) {
        const up = await bucket().upload(path, body, { contentType: type, upsert: true });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      }
      let desc = null;
      if (ai) {
        try { desc = await describeForWardrobe(c.preview); } catch (err) { log('describe failed:', err.message); }
      }
      photos.push({ id: img.id, geometry: c.geometry, signature: c.signature, ai: desc });
      previews[img.id] = c.preview;
      stored[img.id] = { cut: `${base}.png`, preview: `${base}.jpg`, width: c.width, height: c.height, geometry: c.geometry, signature: c.signature, ai: desc, name: img.name || null };
    }

    let aiGroups = null, aiNames = null;
    if (ai && photos.length > 1 && photos.some((p) => p.ai)) {
      try {
        const dist = photos.map((a) => photos.map((b) => colorDistance(a.signature, b.signature)));
        const r = await groupWithAI(photos, dist);
        if (r) ({ groups: aiGroups, names: aiNames } = r);
      } catch (err) { log('grouping AI failed:', err.message); }
    }
    const items = buildItems(photos, aiGroups, aiNames);

    // the cut of each garment in Natural Garment Language (shared/ngl.js): the sewing pattern is built from it
    if (ai) {
      for (const item of items) {
        const front = previews[item.views?.front];
        if (!front) continue;
        try {
          const { garments, model } = await describeNGL(front);
          item.ngl = pickForZone(garments, item.zone);
          item.nglModel = model;
        } catch (err) { log('NGL failed:', err.message); }
      }
    }

    const { error: ue } = await db().from('garment_groups').update({
      status: 'ready', error: null, items, photos: stored, processed_at: new Date().toISOString(),
    }).eq('id', groupId).eq('user_id', userId);
    if (ue) throw new Error(ue.message);
    log(`ready ${groupId}: ${photos.length} photos → ${items.length} garments${ai ? '' : ' (no AI)'} in ${Date.now() - t0}ms`);
  } catch (err) {
    await fail(err.message).catch(() => {});
  } finally {
    running.delete(groupId);
  }
}

/** a restart kills in-flight jobs: mark them failed so the app offers a retry */
export async function recoverStaleGroups() {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await db().from('garment_groups')
    .update({ status: 'failed', error: 'Processing was interrupted — try again.' })
    .eq('status', 'processing').lt('updated_at', cutoff).select('id');
  if (!error && data?.length) log(`recovered ${data.length} stale group(s)`);
}
