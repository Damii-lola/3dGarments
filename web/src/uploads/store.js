/**
 * Garment photo groups.
 *
 *   group = { id, name, created, images: [{ id, name, type, blob?, path?, url? }] }
 *
 * Cloud (Supabase settings from the API on Render, see services/config.js): rows in public.garment_groups,
 * files in the private "garments" bucket at <user_id>/groups/<group_id>/<image_id>.<ext>, written
 * with the user's own session (anonymous sign-in when nobody is logged in), shown via signed URLs.
 * Local (no cloud, or the cloud refused): IndexedDB in this browser, and in memory as a last resort.
 */
import { cloudConfig } from '../services/config.js';
import { supabaseClient as client, ensureSession } from '../services/auth.js';

export const MAX_PER_GROUP = 10;
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const BUCKET = 'garments';
const CLOUD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }; // what the bucket accepts
const SIGNED_FOR = 60 * 60 * 24;

/* ================================================================ local (IndexedDB) */

const DB = '3dg-uploads', STORE = 'groups';
let dbp = null;
const memory = new Map();
function idb() {
  dbp ||= new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function idbDo(mode, fn) {
  const db = await idb();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
const local = {
  mode: 'local',
  async list() { return (await idbDo('readonly', (s) => (s ? s.getAll() : { result: [...memory.values()] }))) || []; },
  async save(g) {
    const row = { ...g, images: g.images.map(({ id, name, type, blob }) => ({ id, name, type, blob })) };
    await idbDo('readwrite', (s) => (s ? s.put(row) : memory.set(g.id, row)));
  },
  async remove(g) { await idbDo('readwrite', (s) => (s ? s.delete(g.id) : memory.delete(g.id))); },
};

/* ================================================================ cloud (Supabase) */

/** the bucket takes jpeg / png / webp: anything else the browser can decode is re-encoded as webp */
async function cloudBlob(img) {
  if (CLOUD_TYPES[img.blob.type]) return img.blob;
  const bmp = await createImageBitmap(img.blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not convert the image'))), 'image/webp', 0.92));
}

const cloud = {
  mode: 'cloud',
  async list() {
    const sb = await client();
    const { data, error } = await sb.from('garment_groups').select('id, name, images, created_at').order('created_at');
    if (error) throw error;
    const paths = data.flatMap((r) => r.images.map((i) => i.path));
    const signed = new Map();
    if (paths.length) {
      const { data: s, error: e } = await sb.storage.from(BUCKET).createSignedUrls(paths, SIGNED_FOR);
      if (e) throw e;
      for (const x of s) if (x.signedUrl) signed.set(x.path, x.signedUrl);
    }
    return data.map((r) => ({
      id: r.id, name: r.name, created: Date.parse(r.created_at),
      images: r.images.map((i) => ({ ...i, url: signed.get(i.path) || '' })),
    }));
  },
  async save(g, prev) {
    const sb = await client(), { user } = await ensureSession();
    // upload what is new (in parallel), then write the row, then drop files no longer used
    await Promise.all(g.images.filter((i) => !i.path).map(async (img) => {
      const blob = await cloudBlob(img);
      const path = `${user.id}/groups/${g.id}/${img.id}.${CLOUD_TYPES[blob.type]}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: true });
      if (error) throw error;
      img.path = path;
      img.type = blob.type;
    }));
    const { error } = await sb.from('garment_groups').upsert({
      id: g.id, user_id: user.id, name: g.name, created_at: new Date(g.created).toISOString(),
      images: g.images.map(({ id, name, type, path }) => ({ id, name, type, path })),
    });
    if (error) throw error;
    const keep = new Set(g.images.map((i) => i.path));
    const gone = (prev?.images || []).map((i) => i.path).filter((p) => p && !keep.has(p));
    if (gone.length) await sb.storage.from(BUCKET).remove(gone);
  },
  async remove(g) {
    const sb = await client();
    const { error } = await sb.from('garment_groups').delete().eq('id', g.id);
    if (error) throw error;
    const paths = g.images.map((i) => i.path).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  },
};

/* ================================================================ which one */

let backend = null, picking = null;
/** 'cloud' | 'local' (decided once, on first use; concurrent callers share the decision) */
export function storageMode() {
  picking ||= (async () => {
    backend = local;
    if (await cloudConfig()) {
      try {
        await ensureSession();
        backend = cloud;
      } catch (err) {
        console.warn('garment groups: cloud unavailable, keeping them in this browser', err);
      }
    }
    return backend.mode;
  })();
  return picking;
}

export async function listGroups() {
  await storageMode();
  return (await backend.list()).sort((a, b) => a.created - b.created);
}
/** @param prev the group as it was before editing (to delete files it no longer uses) */
export async function saveGroup(group, prev = null) { await storageMode(); await backend.save(group, prev); return group; }
export async function deleteGroup(group) { await storageMode(); await backend.remove(group); }
