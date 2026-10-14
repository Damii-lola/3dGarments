/** Template geometry for the scanner: the published garment_templates row -> its .glb from the public `templates` bucket. */
import { db } from '../lib/supabase.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { readGlbMesh } from './glb.js';

const cache = new Map();            // id -> { mesh, exp }
const TTL = 10 * 60_000;

export async function loadTemplate(id) {
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit.mesh;
  const { data, error } = await db().from('garment_templates').select('id, name, glb_path, published').eq('id', id).maybeSingle();
  if (error) throw new HttpError(502, error.message);
  if (!data || !data.published) throw new HttpError(404, 'Template not found');
  if (!data.glb_path) throw new HttpError(422, 'This template has no model file to paint on');
  const url = `${config.supabase.url.replace(/\/$/, '')}/storage/v1/object/public/templates/${data.glb_path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(502, `could not read the template model (${res.status})`);
  let mesh;
  try { mesh = readGlbMesh(Buffer.from(await res.arrayBuffer())); } catch (e) { throw new HttpError(422, e.message); }
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  cache.set(id, { mesh, exp: Date.now() + TTL });
  return mesh;
}
