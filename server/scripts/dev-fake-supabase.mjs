// Local development / testing only: a tiny stand-in for Supabase (login check, one template row, its .glb)
// so the API can be run and scanned against without the cloud.   node scripts/dev-fake-supabase.mjs <template.glb> [port]
import http from 'node:http';
import { readFileSync } from 'node:fs';
const [glbPath, port = '9999'] = process.argv.slice(2);
const TEMPLATE_ID = process.env.TEMPLATE_ID || '11111111-2222-3333-4444-555555555555';
const GLB = readFileSync(glbPath);
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/auth/v1/user') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'dev-user', aud: 'authenticated' })); }
  if (u.pathname === '/rest/v1/garment_templates') {
    const row = u.searchParams.get('id') === `eq.${TEMPLATE_ID}` ? { id: TEMPLATE_ID, name: 'Dev tee', glb_path: 'Male/dev.glb', published: true } : null;
    const obj = /pgrst\.object/.test(req.headers.accept || '');
    res.writeHead(row || !obj ? 200 : 406, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(row ? (obj ? row : [row]) : (obj ? {} : [])));
  }
  if (u.pathname.startsWith('/storage/v1/object/public/templates/')) { res.writeHead(200, { 'content-type': 'model/gltf-binary' }); return res.end(GLB); }
  res.writeHead(404); res.end();
}).listen(Number(port), '127.0.0.1', () => console.log(`fake supabase on :${port}, template ${TEMPLATE_ID}`));
