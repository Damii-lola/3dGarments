/**
 * 3dGarments — virtual fitting room. Build the model (sex, skin, measurements, body shape) on a live
 * 3D preview.
 */
import './styles.css';
import { createStage } from './scene/stage.js';
import { Human } from './human/human.js';
import {
  RANGES, ModelController, fmtIn, IN, LB, DEFAULT_TONE, toneGradient, BUILDS, ABDOMEN, SHAPE_DEFAULTS,
} from './human/body.js';
import { DEFAULT_POSE, composePose } from './human/poses.js';
import { createUploads } from './uploads/groups.js';
import { loadProfile, saveProfile } from './services/profile.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================================================================ state */

const modelDefaults = (sex = 'female') => ({ sex, ...RANGES[sex].defaults, tone: DEFAULT_TONE, ...SHAPE_DEFAULTS });
/**
 * Each model keeps its own settings: switching sex swaps to the other set, and switching back
 * brings every edit back. Saved in localStorage, and per device in Supabase (services/profile.js).
 *   profile = { sex, models: { female: {...}, male: {...} }, updated }
 */
const STORE = '3dg.tryon.v3';
const withDefaults = (sex, m) => ({ ...modelDefaults(sex), ...(m || {}), sex });
function readProfile(raw) {
  if (!raw?.models) return null;
  return { sex: RANGES[raw.sex] ? raw.sex : 'female', updated: raw.updated || 0, models: { female: withDefaults('female', raw.models.female), male: withDefaults('male', raw.models.male) } };
}
let profile = { sex: 'female', updated: 0, models: { female: modelDefaults('female'), male: modelDefaults('male') } };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  const v2 = JSON.parse(localStorage.getItem('3dg.tryon.v2') || 'null');   // one model only: keep it
  if (readProfile(saved)) profile = readProfile(saved);
  else if (v2?.sex && RANGES[v2.sex]) { profile.sex = v2.sex; profile.models[v2.sex] = withDefaults(v2.sex, v2); }
} catch { /* private mode / bad JSON */ }
let M = profile.models[profile.sex];
let saveTimer = null;
const save = () => {
  profile.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch { /* ignore */ } }, 400);
  saveProfile(profile);
};

const params = new URLSearchParams(location.search);
if (params.get('model') === 'male' || params.get('model') === 'female') { profile.sex = params.get('model'); M = profile.models[profile.sex]; }
if (params.get('tone') != null && !Number.isNaN(+params.get('tone'))) M.tone = Math.min(1, Math.max(0, +params.get('tone')));

/* ================================================================ toasts */

function toast(msg, type = 'info', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}

/* ================================================================ UI kit */

function paint(input) {
  const lo = +input.min, hi = +input.max, v = +input.value;
  const p = ((v - lo) / (hi - lo)) * 100;
  input.style.setProperty('--p', `${p}%`);
  const z = ((0 - lo) / (hi - lo)) * 100; // centred sliders fill from the middle
  input.style.setProperty('--a', `${Math.min(p, z)}%`);
  input.style.setProperty('--b', `${Math.max(p, z)}%`);
}

/**
 * @param o { label, min, max, step, value, fmt(v) → output text, onInput(v), ends: [left, right], centred }
 * The element gets set(v) (silent), setRange(min, max) and out(text).
 */
function slider({ label, min, max, step = 0.01, value, fmt = () => '', onInput, ends, centred = false }) {
  const el = document.createElement('label');
  el.className = `slider${centred ? ' centred' : ''}`;
  el.innerHTML = `<div class="slider-head"><span>${esc(label)}</span><output></output></div><input type="range" min="${min}" max="${max}" step="${step}" />`
    + (ends ? `<div class="slider-ends"><span>${esc(ends[0])}</span><span>${esc(ends[1])}</span></div>` : '');
  const input = $('input', el), out = $('output', el);
  el.set = (v) => { input.value = v; paint(input); };
  el.setRange = (lo, hi) => { input.min = lo; input.max = hi; paint(input); };
  el.out = (t) => { out.textContent = t; };
  el.set(value);
  el.out(fmt(+input.value));
  input.addEventListener('input', () => { paint(input); el.out(fmt(+input.value)); onInput(+input.value); });
  // double-click / double-tap: back to the sculpted model
  if (centred) input.addEventListener('dblclick', () => { el.set(0); el.out(fmt(0)); onInput(0); });
  return el;
}

function chips(options, value, onPick, { cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = `chips ${cls}`;
  el.innerHTML = options.map(([v, label]) => `<button type="button" class="chip${v === value ? ' on' : ''}" data-v="${esc(v)}">${esc(label)}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    el.select(b.dataset.v);
    onPick(b.dataset.v);
  });
  el.select = (v) => el.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.v === v));
  return el;
}

function group(title, note, ...children) {
  const s = document.createElement('section');
  s.className = 'group';
  s.innerHTML = `<h3>${esc(title)}${note ? `<small>${esc(note)}</small>` : ''}</h3>`;
  s.append(...children.filter(Boolean));
  return s;
}

const cm = (v) => `${v.toFixed(1)} cm`;
const cmIn = (v) => `${Math.round(v)} cm · ${(v / IN).toFixed(1)}″`;
const kgLb = (kg) => `${kg.toFixed(1)} kg · ${Math.round(kg * LB)} lb`;

/* ================================================================ scene + human */

const stage = createStage($('#stage-canvas'));
let human = null;
let model = null; // ModelController (human/body.js)
let ui = {};     // live controls + readouts

/** apply the shape now; measurements (weight, girths) follow a beat later */
function applyShape() {
  if (!human) return;
  model.applyShape();
  stage.invalidate(3, true);
  stage.setSubjectHeight(human.heightM);
  queueReadouts();
  save();
}
let shapeRaf = 0;
const queueShape = () => { cancelAnimationFrame(shapeRaf); shapeRaf = requestAnimationFrame(applyShape); };
const applyLook = () => { if (human) { model.applyLook(); stage.invalidate(3, true); save(); } };

let readTimer = 0, readLast = 0;
function queueReadouts() {
  clearTimeout(readTimer);
  const wait = Math.max(0, 90 - (performance.now() - readLast)); // at most ~11× a second while dragging
  readTimer = setTimeout(readouts, wait);
}

/** every number on the panel, from the body as it is now — they all move together */
function readouts() {
  readLast = performance.now();
  if (!human || !ui.weight) return;
  const s = model.solve();
  const kg = model.weight(s), bmi = model.bmi(kg), g = model.girths(s);
  const [wLo, wHi] = model.weightRange();
  ui.weight.setRange(Math.floor(wLo * 2) / 2, Math.ceil(wHi * 2) / 2);
  if (!ui.weight.dragging) ui.weight.set(kg);
  ui.weight.out(kgLb(kg));
  const female = M.sex === 'female';
  const whr = g.waist / g.hips;
  ui.stats.innerHTML = [
    ['Height', `${Math.round(M.height * IN)} cm`, fmtIn(M.height).split(' · ')[1]],
    ['Weight', `${kg.toFixed(1)} kg`, `BMI ${bmi.toFixed(1)}`],
    [female ? 'Bust' : 'Chest', `${Math.round(g.bust)} cm`, female ? `bra ${g.bra}` : `${(g.bust / IN).toFixed(1)}″`],
    ['Waist', `${Math.round(g.waist)} cm`, `${(g.waist / IN).toFixed(1)}″`],
    ['Hips', `${Math.round(g.hips)} cm`, `${(g.hips / IN).toFixed(1)}″`],
    ['Thigh', `${Math.round(g.thigh)} cm`, g.gap > 0.4 ? `gap ${g.gap.toFixed(1)} cm` : 'touching'],
  ].map(([k, v, n]) => `<div class="stat"><span>${k}</span><b>${v}</b><small>${esc(n)}</small></div>`).join('');
  ui.waist.out(`${cmIn(g.waist)} · WHR ${whr.toFixed(2)}`);
  ui.bust.out(female ? `${cmIn(g.bust)} · ${g.bra}` : cmIn(g.bust));
  ui.hips.out(cmIn(g.hips));
  ui.glutes.out(cmIn(g.hips));
  ui.thighs.out(`${cmIn(g.thigh)}`);
  // the body type that matches (muscle tone + BMI), if any
  const match = Object.entries(BUILDS).find(([, b]) => Math.abs(b.muscle - M.muscle) < 0.05 && Math.abs(b.bmi[M.sex] - bmi) < 1.2);
  ui.build.select(match ? match[0] : '');
}

/* ================================================================ the panel */

const breadth = (v) => {
  const d = RANGES[M.sex].defaults.width;
  return v < d - 2.5 ? 'narrow' : v > d + 2.5 ? 'broad' : 'neutral';
};

let uploads = null; // the garment photo section: built once, kept across panel rebuilds

function buildPanel() {
  const host = $('#panel');
  uploads ||= createUploads({ toast });
  host.innerHTML = '';
  ui = {};

  const sex = chips([['female', 'Female'], ['male', 'Male']], M.sex, (v) => {
    if (v === M.sex) return;
    profile.sex = v;
    M = profile.models[v];          // that model's own settings, exactly as they were left
    model.model = M;
    applyShape();
    applyLook();
    buildPanel();
  }, { cls: 'seg big' });

  const skin = slider({ label: '', min: 0, max: 1, step: 0.001, value: M.tone ?? DEFAULT_TONE, onInput: (v) => { M.tone = v; applyLook(); } });
  skin.classList.add('tone');
  skin.querySelector('.slider-head').remove();
  skin.querySelector('input').style.setProperty('--track', toneGradient());

  ui.stats = document.createElement('div');
  ui.stats.className = 'stats';

  // height & weight: weight is the body's own (volume × density) — every other control moves it,
  // and moving it re-solves the body fat, which reshapes belly, waist, hips, bust, thighs and arms
  const [hLo, hHi] = model.reach('height');
  const height = slider({
    label: 'Height', min: hLo, max: hHi, step: 0.5, value: M.height, fmt: (v) => `${fmtIn(v)} · ${Math.round(v * IN)} cm`,
    onInput: (v) => { M.height = v; queueShape(); },
  });
  ui.weight = slider({
    label: 'Weight', min: 30, max: 150, step: 0.5, value: 60,
    onInput: (v) => { model.setWeight(v); M.build = null; queueShape(); },
  });
  const w = $('input', ui.weight);
  w.addEventListener('pointerdown', () => { ui.weight.dragging = true; });
  w.addEventListener('pointerup', () => { ui.weight.dragging = false; queueReadouts(); });
  w.addEventListener('change', () => { ui.weight.dragging = false; queueReadouts(); });

  // body type: muscle tone + a typical weight for the height
  ui.build = chips(Object.entries(BUILDS).map(([k, b]) => [k, b.label]), M.build || '', (v) => {
    model.setBuild(v);
    ui.muscle.set(M.muscle);
    ui.muscle.out(M.muscle < -0.5 ? 'soft' : M.muscle < -0.15 ? 'smooth' : M.muscle <= 0.15 ? 'natural' : M.muscle < 0.5 ? 'toned' : 'defined');
    queueShape();
  }, { cls: 'grid4' });
  const L = model.limits;
  ui.muscle = slider({
    label: 'Muscle tone', min: L.muscle[0], max: L.muscle[1], step: 0.01, value: M.muscle, centred: true, ends: ['Soft', 'Defined'],
    fmt: (v) => (v < -0.5 ? 'soft' : v < -0.15 ? 'smooth' : v <= 0.15 ? 'natural' : v < 0.5 ? 'toned' : 'defined'),
    onInput: (v) => { M.muscle = v; queueShape(); },
  });

  const abdomen = chips(Object.entries(ABDOMEN).map(([k, a]) => [k, a.label]), M.abdomen, (v) => { M.abdomen = v; queueShape(); }, { cls: 'grid2' });
  const prop = (key, label, ends) => slider({ label, min: -1, max: 1, step: 0.01, value: M[key] || 0, centred: true, ends, onInput: (v) => { M[key] = v; queueShape(); } });
  ui.waist = prop('waist', 'Waist', ['Cinched', 'Thick']);
  ui.bust = prop('bust', M.sex === 'female' ? 'Bust' : 'Pecs', ['Smaller', 'Fuller']);
  const chest = prop('chest', 'Chest width', ['Narrow', 'Wide']);

  const [wLo, wHi] = model.reach('width');
  const shoulders = slider({
    label: 'Shoulder breadth', min: wLo, max: wHi, step: 0.5, value: M.width, fmt: (v) => `${cm(v)} · ${breadth(v)}`,
    onInput: (v) => { M.width = v; queueShape(); },
  });
  const posture = slider({
    label: 'Posture', min: -1, max: 1, step: 0.01, value: M.posture || 0, centred: true, ends: ['Upright', 'Rounded'],
    fmt: (v) => (v < -0.33 ? 'upright' : v > 0.33 ? 'rounded' : 'neutral'),
    onInput: (v) => { M.posture = v; queueShape(); },
  });

  ui.glutes = prop('glutes', 'Glutes', ['Flatter', 'Fuller']);
  ui.hips = prop('hips', 'Hip width', ['Narrow', 'Wide']);
  ui.thighs = prop('thighs', 'Thighs', ['Slimmer', 'Fuller']);

  const reset = document.createElement('button');
  reset.className = 'link';
  reset.type = 'button';
  reset.textContent = 'Reset body shape';
  reset.addEventListener('click', () => { model.resetShape(); applyShape(); buildPanel(); });

  host.append(
    uploads,
    group('Model', null, sex),
    group('Skin', null, skin),
    group('Measurements', 'live', ui.stats),
    group('Height & weight', null, height, ui.weight),
    group('Body type', null, ui.build, ui.muscle),
    group('Abdomen & waist', null, abdomen, ui.waist),
    group(M.sex === 'female' ? 'Bust & chest' : 'Chest', null, ui.bust, chest),
    group('Shoulders & posture', null, shoulders, posture),
    group('Glutes & thighs', null, ui.glutes, ui.hips, ui.thighs),
    reset,
  );
  readouts();
}

/* ================================================================ boot */

async function boot() {
  stage.setLighting({ preset: 'soft', rotation: 0, intensity: 1 });
  await stage.setEnvironment({ color: '#e9e6e1' });

  human = await Human.load();
  model = new ModelController(human, M);
  model.apply();
  human.setPose(composePose(DEFAULT_POSE));
  stage.root.add(human.object);
  stage.setSubjectHeight(human.heightM);
  stage.setView('front', { instant: true });
  buildPanel();
  stage.invalidate(4);
  $('#loader').classList.add('done');
  // build the other body's shape targets while idle, so switching sex is instant
  const other = human.bodies[M.sex === 'female' ? 'male' : 'female'];
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => other.ensureShape(), { timeout: 4000 });
  window.__3dg = { stage, human, model, get state() { return M; }, get profile() { return profile; }, applyShape, buildPanel, ready: true };

  // this device's copy in the cloud: take it if it is newer (e.g. local data was cleared),
  // otherwise make sure the cloud has ours
  const cloud = readProfile(await loadProfile());
  if (cloud && cloud.updated > profile.updated) {
    profile = cloud;
    M = profile.models[profile.sex];
    model.model = M;
    model.applyShape();
    model.applyLook();
    stage.setSubjectHeight(human.heightM);
    stage.invalidate(4);
    buildPanel();
    try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch { /* ignore */ }
  } else if (profile.updated) saveProfile(profile, 0);
}

boot().catch((err) => {
  console.error(err);
  $('#loader').innerHTML = `<span class="error">Couldn't load the 3D model: ${esc(err.message)}</span>`;
  toast(err.message, 'error', 8000);
});
