/**
 * 3dGarments Lab — workbench for the avatar, mannequin and clothing system.
 * It drives the real app modules (web/src/scene + server/src/shared), adding
 * debug views on top: region colours, wireframe, silhouette inspector, stats.
 */
import './lab.css';
import * as THREE from 'three';
import { createStage } from '@web/scene/stage.js';
import { createDresser } from '@web/scene/dresser.js';
import { DEFAULT_BODY } from '@web/scene/body.js';
import { processLocally } from '@web/services/local.js';
import { SAMPLE_SVGS } from '@shared/samples.js';

const $ = (s) => document.querySelector(s);
const stage = createStage($('#view'));
const dresser = createDresser(stage);

const garments = new Map(); // id -> garment
let selected = null;
let body = { ...DEFAULT_BODY };
const lastBuild = { ms: 0 };

/* ------------------------------------------------ garments */
async function addGarment(source, name) {
  const t0 = performance.now();
  const r = await processLocally(source);
  const id = `lab-${Math.random().toString(36).slice(2, 8)}`;
  const g = { id, name, status: 'ready', fit: {}, analysis: {}, updated_at: Date.now(), ...r };
  g.processMs = Math.round(performance.now() - t0);
  garments.set(id, g);
  await wear(g);
  select(id);
}

async function wear(g) {
  const t0 = performance.now();
  await dresser.wear(g);
  lastBuild.ms = Math.round(performance.now() - t0);
  renderWorn();
}

async function sampleFile(key) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVGS[key].svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 1000;
  c.getContext('2d').drawImage(img, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

$('#samples').innerHTML = Object.entries(SAMPLE_SVGS).map(([k, s]) => `<button data-k="${k}">${s.name}</button>`).join('');
$('#samples').addEventListener('click', async (e) => {
  const k = e.target.dataset?.k;
  if (k) await addGarment(await sampleFile(k), SAMPLE_SVGS[k].name);
});
$('#upload').addEventListener('change', async (e) => {
  for (const f of [...e.target.files]) await addGarment(f, f.name.replace(/\.[^.]+$/, ''));
  e.target.value = '';
});

function renderWorn() {
  const ids = [...garments.keys()];
  $('#worn').innerHTML = ids.map((id) => {
    const g = garments.get(id);
    const on = dresser.isWorn(id);
    return `<div class="worn-item${id === selected ? ' sel' : ''}" data-id="${id}">
      <img src="${g.preview_url}" alt="" /><div class="n"><div>${g.name}</div><div>${g.category}${on ? ' · worn' : ''}</div></div>
      <button data-toggle title="${on ? 'Take off' : 'Wear'}">${on ? '−' : '+'}</button></div>`;
  }).join('');
}
$('#worn').addEventListener('click', async (e) => {
  const item = e.target.closest('.worn-item');
  if (!item) return;
  const g = garments.get(item.dataset.id);
  if (e.target.closest('[data-toggle]')) {
    if (dresser.isWorn(g.id)) dresser.takeOff(g.id); else await wear(g);
  }
  select(g.id);
});

/* ------------------------------------------------ sliders */
function slider(host, { key, label, min, max, step, value, fmt }, onInput) {
  const el = document.createElement('label');
  el.className = 'slider';
  el.innerHTML = `<span>${label}</span><output>${fmt(value)}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
  const input = el.querySelector('input'), out = el.querySelector('output');
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); onInput(key, +input.value); });
  host.append(el);
  return { set(v) { input.value = v; out.textContent = fmt(v); } };
}

const cm = (v) => `${Math.round(v)} cm`;
const BODY = [
  { key: 'heightCm', label: 'Height', min: 140, max: 210, step: 1, fmt: cm },
  { key: 'chestCm', label: 'Chest', min: 70, max: 140, step: 1, fmt: cm },
  { key: 'waistCm', label: 'Waist', min: 56, max: 140, step: 1, fmt: cm },
  { key: 'hipsCm', label: 'Hips', min: 70, max: 150, step: 1, fmt: cm },
  { key: 'armAngleDeg', label: 'Arm angle (° below horizontal)', min: 20, max: 85, step: 1, fmt: (v) => `${v}°` },
];
let bodyTimer;
for (const s of BODY) {
  slider($('#body-sliders'), { ...s, value: body[s.key] }, (k, v) => {
    body[k] = v;
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(async () => { const t0 = performance.now(); await dresser.setBody(body); lastBuild.ms = Math.round(performance.now() - t0); }, 30);
  });
}

const fitSliders = {};
const FIT = [
  { key: 'size', label: 'Size', min: 0.7, max: 1.5, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'lift', label: 'Lift', min: -0.2, max: 0.2, step: 0.005, fmt: (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} cm` },
];
for (const s of FIT) {
  fitSliders[s.key] = slider($('#fit-sliders'), { ...s, value: s.key === 'size' ? 1 : 0 }, (k, v) => {
    const g = garments.get(selected);
    if (!g) return;
    g.fit = { ...g.fit, [k]: v };
    dresser.update(g);
  });
}
$('#fit-category').addEventListener('change', (e) => {
  const g = garments.get(selected);
  if (!g) return;
  g.category = e.target.value;
  g.updated_at = Date.now();
  dresser.update(g);
  renderWorn();
});

function select(id) {
  selected = id;
  const g = garments.get(id);
  $('#fit-section').hidden = !g;
  $('#inspector').hidden = !g;
  if (!g) return;
  $('#fit-name').textContent = g.name;
  $('#fit-category').value = g.category;
  fitSliders.size.set(g.fit.size ?? 1);
  fitSliders.lift.set(g.fit.lift ?? 0);
  renderWorn();
  drawInspector(g);
}

/* ------------------------------------------------ silhouette inspector */
function drawInspector(g) {
  const cv = $('#insp-canvas'), ctx = cv.getContext('2d');
  const { rgba, width, height } = g.local;
  const geo = g.geometry;
  const S = 320, k = Math.min(S / width, S / height);
  const ox = (S - width * k) / 2, oy = (S - height * k) / 2;
  const tmp = document.createElement('canvas');
  tmp.width = width; tmp.height = height;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(tmp, ox, oy, width * k, height * k);
  ctx.globalAlpha = 1;
  const P = (x, y) => [ox + x * height * k, oy + y * height * k]; // garment space unit = height

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#3ddc97';
  for (const side of [0, 1]) {
    ctx.beginPath();
    let started = false;
    for (const r of geo.rows) {
      if (!r.t) { started = false; continue; }
      const [x, y] = P(r.t[side], r.y);
      started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      started = true;
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#3ad7ff';
  for (const r of geo.rows) if (r.legs) for (const [l, rr] of r.legs) {
    const [a, y] = P(l, r.y), [b] = P(rr, r.y);
    ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(a + 1, y); ctx.moveTo(b, y); ctx.lineTo(b + 1, y); ctx.stroke();
  }
  const hline = (y, col) => { ctx.strokeStyle = col; ctx.setLineDash([5, 4]); ctx.beginPath(); const [, py] = P(0, y); ctx.moveTo(0, py); ctx.lineTo(S, py); ctx.stroke(); ctx.setLineDash([]); };
  if (geo.armpit != null) hline(geo.armpit, '#ffd24a');
  if (geo.crotch != null) hline(geo.crotch, '#3ad7ff');
  for (const sl of [geo.sleeves?.left, geo.sleeves?.right]) {
    if (!sl) continue;
    const [rx, ry] = P(sl.root[0], sl.root[1]);
    const [ex, ey] = P(sl.root[0] + sl.dir[0] * sl.length, sl.root[1] + sl.dir[1] * sl.length);
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(ex, ey); ctx.stroke();
    const nx = -sl.dir[1], ny = sl.dir[0], hw = (sl.width / 2) * height * k;
    const mx = (rx + ex) / 2, my = (ry + ey) / 2;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mx - nx * hw, my - ny * hw); ctx.lineTo(mx + nx * hw, my + ny * hw); ctx.stroke();
    ctx.fillStyle = '#ff4fd8'; ctx.beginPath(); ctx.arc(rx, ry, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  $('#insp-name').textContent = `${g.name} (${g.category})`;
  const { rows, ...summary } = geo;
  $('#insp-json').textContent = JSON.stringify({ ...summary, rows: `${rows.length} rows` }, null, 1);
}

/* ------------------------------------------------ debug overlays */
const REGION_RGB = [[0.1, 0.5, 1], [1, 0.12, 0.12], [1, 0.7, 0], [0.05, 0.85, 0.25], [0.6, 0.2, 1]];
const dbg = {};
for (const id of ['wire', 'regions', 'mannequin', 'garments', 'back', 'spin']) {
  const el = $(`#dbg-${id}`);
  dbg[id] = el.checked;
  el.addEventListener('change', () => { dbg[id] = el.checked; if (id === 'spin') stage.setAutoRotate(el.checked); applied = ''; applyDebug(); });
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => stage.setView(b.dataset.view)));
$('#shot').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = stage.snapshot(); a.download = `lab-${Date.now()}.png`; a.click();
});

const garmentMeshes = () => {
  const out = [];
  stage.root.traverse((o) => { if (o.isMesh && o.name.startsWith('garment:')) out.push(o); });
  return out;
};
let applied = '';
function applyDebug() {
  const meshes = garmentMeshes();
  const sig = meshes.map((m) => m.uuid).join() + JSON.stringify(dbg);
  if (sig === applied) return;
  applied = sig;
  stage.root.traverse((o) => {
    if (o.name === 'mannequin') o.visible = dbg.mannequin;
    if (o.isMesh && o.parent?.name === 'mannequin') o.material.wireframe = dbg.wire;
  });
  for (const m of meshes) {
    m.visible = dbg.garments;
    m.material.forEach((mat, i) => {
      mat.wireframe = dbg.wire;
      mat.visible = !(i === 1 && dbg.back);
      if (!('orig' in mat.userData)) mat.userData.orig = mat.map;
      mat.map = dbg.regions ? null : mat.userData.orig;
      mat.needsUpdate = true;
    });
    const { regions, V } = m.userData;
    const col = m.geometry.attributes.color;
    for (let k = 0; k < V; k++) {
      const c = dbg.regions ? REGION_RGB[regions[k]] : [1, 1, 1];
      col.setXYZ(k, c[0], c[1], c[2]);
      col.setXYZ(V + k, dbg.regions ? c[0] * 0.8 : 0.9, dbg.regions ? c[1] * 0.8 : 0.9, dbg.regions ? c[2] * 0.8 : 0.9);
    }
    col.needsUpdate = true;
  }
}

/* ------------------------------------------------ stats */
let frames = 0, fpsT = performance.now(), fps = 0;
function tick() {
  applyDebug();
  frames++;
  const now = performance.now();
  if (now - fpsT > 500) {
    fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now;
    const meshes = garmentMeshes();
    const info = stage.renderer.info;
    const g = garments.get(selected);
    $('#stats').textContent = [
      `fps            ${fps}`,
      `draw calls     ${info.render.calls}`,
      `scene tris     ${info.render.triangles.toLocaleString()}`,
      `last rebuild   ${lastBuild.ms} ms`,
      `garments worn  ${meshes.length}`,
      ...meshes.map((m) => `  ${m.userData.mode.padEnd(6)} ${m.userData.triangles.toLocaleString()} tris · ${m.userData.scale.toFixed(3)} m/u · ease ${m.userData.ease.toFixed(2)}`),
      g ? `selected       ${g.category} · seg ${g.geometry.segmentation?.method} · ${g.processMs} ms` : '',
    ].join('\n');
  }
  requestAnimationFrame(tick);
}
tick();

/* ------------------------------------------------ boot */
await dresser.setBody(body);
const initial = (new URLSearchParams(location.search).get('demo') ?? 'tee,jeans').split(',').filter((k) => SAMPLE_SVGS[k]);
for (const k of initial) await addGarment(await sampleFile(k), SAMPLE_SVGS[k].name);
window.__lab = { stage, dresser, garments, THREE, dbg, applyDebug, ready: true };
