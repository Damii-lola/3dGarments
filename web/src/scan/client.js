/**
 * Garment scanner client: photos -> the API (server-side AI cut-out + atlas) -> the texture for a template.
 * Auth: a Supabase access token, or (lab only) the shared SCAN_LAB_KEY.
 */
import { API_URL } from '../services/config.js';

/**
 * @param o { front: File|Blob, back?: File|Blob, templateId: string, size?: 1024|2048, token?: string, labKey?: string, apiUrl?: string }
 * @returns Promise<{ dataUrl: string, mime: string, report: object }>
 */
export async function scanOnServer(o) {
  const f = new FormData();
  f.append('front', o.front, o.front.name || 'front.jpg');
  if (o.back) f.append('back', o.back, o.back.name || 'back.jpg');
  f.append('template', o.templateId);
  f.append('size', String(o.size || 2048));
  const headers = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.labKey) headers['X-Scan-Key'] = o.labKey;
  const res = await fetch(`${(o.apiUrl || API_URL).replace(/\/$/, '')}/api/scan`, { method: 'POST', headers, body: f });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `scan failed (${res.status})`);
  return { dataUrl: `data:${body.mime};base64,${body.image}`, mime: body.mime, report: body.report };
}
