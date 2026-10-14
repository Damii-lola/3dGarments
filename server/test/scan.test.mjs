// node --test test/scan.test.mjs — the real API (a child process) against a fake Supabase: login check, template row,
// template model file. Posts a synthetic flat-lay tee (textured backdrop) to /api/scan and checks the texture that comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { SAMPLE_SVGS } from './fixtures/samples.js';

const TEMPLATE_ID = '11111111-2222-3333-4444-555555555555';
const GLB = readFileSync(new URL('./fixtures/M_CrewNeckTee.glb', import.meta.url));
let fake, api, base, apiBase;

before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/auth/v1/user') {
      if (!/Bearer good/.test(req.headers.authorization || '')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"msg":"bad token"}'); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'user-1', aud: 'authenticated', email: 't@t.t' }));
    }
    if (u.pathname === '/rest/v1/garment_templates') {
      const row = u.searchParams.get('id') === `eq.${TEMPLATE_ID}` ? { id: TEMPLATE_ID, name: 'Tee', glb_path: 'Male/M_CrewNeckTee.glb', published: true } : null;
      const wantsObject = /pgrst\.object/.test(req.headers.accept || '');
      res.writeHead(row || !wantsObject ? 200 : 406, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(row ? (wantsObject ? row : [row]) : (wantsObject ? { message: 'none' } : [])));
    }
    if (u.pathname.startsWith('/storage/v1/object/public/templates/')) { res.writeHead(200, { 'content-type': 'model/gltf-binary' }); return res.end(GLB); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${fake.address().port}`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  api = spawn(process.execPath, ['src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'b', CORS_ORIGINS: '*' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiBase = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${apiBase}/health`)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('API did not start');
});
after(() => { api?.kill(); fake?.close(); });

/** the sample tee, rasterised on its textured backdrop */
const photo = () => sharp(Buffer.from(SAMPLE_SVGS.tee.svg), { density: 96 }).resize(1000, 1000).jpeg({ quality: 92 }).toBuffer();
const form = async (fields, extra = {}) => {
  const f = new FormData();
  if (fields.front !== false) f.append('front', new Blob([await photo()], { type: 'image/jpeg' }), 'front.jpg');
  if (fields.template) f.append('template', fields.template);
  if (fields.size) f.append('size', String(fields.size));
  return fetch(`${apiBase}/api/scan`, { method: 'POST', headers: { authorization: 'Bearer good', ...extra }, body: f });
};

test('a scan needs a login', async () => {
  const r = await form({ template: TEMPLATE_ID }, { authorization: 'Bearer nope' });
  assert.equal(r.status, 401);
});

test('a scan needs the front photo and a real template', async () => {
  assert.equal((await form({ front: false, template: TEMPLATE_ID })).status, 400);
  assert.equal((await form({ template: 'not-an-id' })).status, 400);
  assert.equal((await form({ template: '99999999-2222-3333-4444-555555555555' })).status, 404);
});

test('POST /api/scan returns the texture atlas of the template, painted from the photo', { timeout: 180_000 }, async () => {
  const r = await form({ template: TEMPLATE_ID, size: 1024 });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.mime, 'image/webp');
  const meta = await sharp(Buffer.from(body.image, 'base64')).metadata();
  assert.deepEqual([meta.width, meta.height], [1024, 1024]);
  assert.ok(body.report.registration.frontIoU > 0.6, `template lines up with the photo (IoU ${body.report.registration.frontIoU})`);
  assert.ok(body.report.fromFrontPhoto > 0.3, 'a good share of the atlas comes from the photo');
  assert.ok(body.report.backInferredFromFront > 0.2, 'with no back photo, the back is inferred from the front');
});
