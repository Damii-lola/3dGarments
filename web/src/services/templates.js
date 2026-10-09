/**
 * Template garments (public catalogue): rows of Supabase `garment_templates`, models in the public
 * `templates` storage bucket. Both are world-readable (RLS: published rows only), so this works for
 * the lab and, later, the embeddable widget without any login.
 */
import { cloudConfig } from './config.js';

/** @returns Promise<Array<{ id, name, category, sex, url, thumb, meta }>> */
export async function listTemplates() {
  const cfg = await cloudConfig();
  if (!cfg) throw new Error('Supabase is not configured');
  const base = cfg.supabaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/garment_templates?select=id,name,category,sex,glb_path,thumb_path,meta&published=eq.true&order=sort.asc,name.asc`, {
    headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` },
  });
  if (!res.ok) throw new Error(`templates: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
  const pub = (p) => `${base}/storage/v1/object/public/templates/${p.split('/').map(encodeURIComponent).join('/')}`;
  return (await res.json()).map((r) => ({ id: r.id, name: r.name, category: r.category, sex: r.sex, url: r.glb_path ? pub(r.glb_path) : null, thumb: r.thumb_path ? pub(r.thumb_path) : null, meta: r.meta || {} }));
}
