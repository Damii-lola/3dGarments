/**
 * Garment scanner client: photos -> the API (server-side AI cut-out + atlas) -> the texture for a template.
 * No auth needed: /api/scan is open.
 *
 * Template can be identified either by a garment_templates id (loaded from Supabase by the API)
 * or by sending the raw mesh geometry as `template` (a {pos, nrm, uv, index} object) — used for
 * builtin body-derived templates that have no .glb file in Supabase.
 */
/**
 * @param o { front: File|Blob, back?: File|Blob, template?: string|object, size?: 1024|2048, apiUrl?: string }
 * @returns Promise<{ dataUrl: string, mime: string, report: object }>
 */
export async function scanOnServer(o) {
  const f = new FormData();
  f.append('front', o.front, o.front.name || 'front.jpg');
  if (o.back) f.append('back', o.back, o.back.name || 'back.jpg');
  f.append('size', String(o.size || 2048));
  if (typeof o.template === 'string') f.append('template', o.template);
  else if (o.template) f.append('template_geometry', JSON.stringify(o.template));
  const res = await fetch(`${(o.apiUrl || API_URL).replace(/\/$/, '')}/api/scan`, { method: 'POST', body: f });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `scan failed (${res.status})`);
  return { dataUrl: `data:${body.mime};base64,${body.image}`, mime: body.mime, report: body.report };
}
