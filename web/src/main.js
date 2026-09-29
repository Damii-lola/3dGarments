/**
 * 3dGarments Studio — shape a realistic human, pose it, light it, export product shots.
 */
import './styles.css';
import { createStage, HDRIS, LIGHTING } from './scene/stage.js';
import { Human } from './human/human.js';
import { RANGES, ModelController, fmtIn, IN, DEFAULT_TONE, toneGradient } from './human/body.js';
import { POSES, HANDS, DEFAULT_POSE, composePose } from './human/poses.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================================================================ state */

const DEFAULTS = {
  model: { sex: 'female', width: RANGES.female.defaults.width, height: RANGES.female.defaults.height, tone: DEFAULT_TONE },
  pose: { preset: DEFAULT_POSE, hands: '', adjust: {} },
  env: { kind: 'studio', color: '#e9e6e1', hdri: 'lobby', blur: 0.35, rotation: 0, intensity: 1, image: null },
  light: { preset: 'soft', rotation: 0, intensity: 1, exposure: 1 },
  shot: { aspect: '4:5', size: 2048, transparent: false, shadow: true, format: 'png' },
};

const STORE = '3dg.studio.v5';
const state = structuredClone(DEFAULTS);
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved) for (const k of Object.keys(DEFAULTS)) Object.assign(state[k], saved[k] || {});
  state.env.image = null; // object URLs don't survive reloads
} catch { /* private mode / bad JSON */ }
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignore */ } }, 400);
};

const params = new URLSearchParams(location.search);
const M = state.model;
if (params.get('model') === 'male' || params.get('model') === 'female') {
  M.sex = params.get('model');
  Object.assign(M, RANGES[M.sex].defaults);
}
if (params.get('tone') != null && !Number.isNaN(+params.get('tone'))) M.tone = Math.min(1, Math.max(0, +params.get('tone')));
if (params.get('pose') && POSES[params.get('pose')]) state.pose.preset = params.get('pose');
if (params.get('scene') && HDRIS[params.get('scene')]) Object.assign(state.env, { kind: 'hdri', hdri: params.get('scene') });

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
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

function slider({ label, min, max, step = 0.01, value, fmt = (v) => v, onInput, hint }) {
  const el = document.createElement('label');
  el.className = 'slider';
  el.innerHTML = `<div class="slider-head"><span>${esc(label)}${hint ? ` <i class="hint">${esc(hint)}</i>` : ''}</span><output></output></div><input type="range" min="${min}" max="${max}" step="${step}" />`;
  const input = $('input', el), out = $('output', el);
  const set = (v) => { input.value = v; out.textContent = fmt(+input.value); paint(input); };
  set(value);
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); paint(input); onInput(+input.value); });
  input.addEventListener('dblclick', () => { const d = el.dataset.default; if (d != null) { set(+d); onInput(+d); } });
  el.dataset.default = value;
  el.set = set;
  return el;
}

function chips(options, value, onPick, { cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = `chips ${cls}`;
  el.innerHTML = options.map(([v, label]) => `<button type="button" class="chip${v === value ? ' on' : ''}" data-v="${esc(v)}">${esc(label)}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    el.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    onPick(b.dataset.v);
  });
  el.select = (v) => el.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.v === v));
  return el;
}

function swatches(colors, value, onPick, { custom = true } = {}) {
  const el = document.createElement('div');
  el.className = 'swatches';
  el.innerHTML = colors.map((c) => `<button type="button" class="sw${c.hex.toLowerCase() === String(value).toLowerCase() ? ' on' : ''}" data-v="${c.hex}" title="${esc(c.label)}" style="--c:${c.hex}"></button>`).join('')
    + (custom ? `<label class="sw sw-custom" title="Custom colour"><input type="color" value="${esc(value)}" /></label>` : '');
  const pick = (hex, btn) => { el.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s === btn)); onPick(hex); };
  el.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) pick(b.dataset.v, b); });
  $('input[type=color]', el)?.addEventListener('input', (e) => pick(e.target.value, e.target.parentElement));
  return el;
}

function section(title, ...children) {
  const s = document.createElement('section');
  s.className = 'group';
  s.innerHTML = `<h3>${esc(title)}</h3>`;
  s.append(...children.filter(Boolean));
  return s;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const ftIn = (cm) => { const i = Math.round(cm / 2.54); return `${Math.floor(i / 12)}′${i % 12}″`; };

/* ================================================================ scene + human */

const stage = createStage($('#stage-canvas'));
let human = null;

let model = null; // ModelController (human/body.js)

function applyShape() {
  if (!human) return;
  model.applyShape();
  stage.invalidate();
  stage.setSubjectHeight(human.heightM);
  save();
}
let shapeRaf = 0;
const queueShape = () => { cancelAnimationFrame(shapeRaf); shapeRaf = requestAnimationFrame(applyShape); };
const applyLook = () => { if (human) { model.applyLook(); stage.invalidate(); save(); } };

function applyPose() {
  human?.setPose(composePose(state.pose.preset, adjustToPose(state.pose.adjust), state.pose.hands || null));
  stage.invalidate();
  save();
}

/** Friendly sliders → anatomical per-bone offsets (see poses.js for axis meanings). */
const ADJUST = [
  { group: 'Head', key: 'headTurn', label: 'Turn', min: -60, max: 60, map: (v) => ({ c: { neck_01: [0, v * 0.35, 0], head: [0, v * 0.65, 0] } }) },
  { group: 'Head', key: 'headTilt', label: 'Tilt', min: -25, max: 25, map: (v) => ({ c: { head: [0, 0, -v] } }) },
  { group: 'Head', key: 'headNod', label: 'Chin up / down', min: -30, max: 30, map: (v) => ({ c: { neck_01: [v * 0.4, 0, 0], head: [v * 0.6, 0, 0] } }) },
  { group: 'Torso', key: 'twist', label: 'Twist', min: -40, max: 40, map: (v) => ({ c: { spine_01: [0, v * 0.3, 0], spine_02: [0, v * 0.35, 0], spine_03: [0, v * 0.35, 0] } }) },
  { group: 'Torso', key: 'lean', label: 'Lean sideways', min: -20, max: 20, map: (v) => ({ c: { spine_01: [0, 0, -v * 0.3], spine_02: [0, 0, -v * 0.35], spine_03: [0, 0, -v * 0.35] } }) },
  { group: 'Torso', key: 'bend', label: 'Lean forward / back', min: -20, max: 30, map: (v) => ({ c: { spine_01: [v * 0.3, 0, 0], spine_02: [v * 0.35, 0, 0], spine_03: [v * 0.35, 0, 0] } }) },
  { group: 'Torso', key: 'hip', label: 'Hip shift', min: -12, max: 12, map: (v) => ({ c: { pelvis: [0, 0, v] }, l: { thigh: [0, 0, -v] }, r: { thigh: [0, 0, v] } }) },
  ...['l', 'r'].flatMap((s) => {
    const side = s === 'l' ? 'Left' : 'Right';
    return [
      { group: `${side} arm`, key: `${s}ArmOut`, label: 'Raise sideways', min: -10, max: 120, map: (v) => ({ [s]: { upperarm: [0, 0, v] } }) },
      { group: `${side} arm`, key: `${s}ArmFwd`, label: 'Swing forward / back', min: -60, max: 120, map: (v) => ({ [s]: { upperarm: [v, 0, 0] } }) },
      { group: `${side} arm`, key: `${s}ArmTwist`, label: 'Rotate', min: -60, max: 60, map: (v) => ({ [s]: { upperarm: [0, v, 0] } }) },
      { group: `${side} arm`, key: `${s}Elbow`, label: 'Bend elbow', min: -5, max: 140, map: (v) => ({ [s]: { lowerarm: [v, 0, 0] } }) },
      { group: `${side} arm`, key: `${s}Wrist`, label: 'Bend wrist', min: -60, max: 60, map: (v) => ({ [s]: { hand: [v, 0, 0] } }) },
      { group: `${side} leg`, key: `${s}LegFwd`, label: 'Step forward / back', min: -40, max: 80, map: (v) => ({ [s]: { thigh: [v, 0, 0] } }) },
      { group: `${side} leg`, key: `${s}LegOut`, label: 'Step out', min: -10, max: 40, map: (v) => ({ [s]: { thigh: [0, 0, v] } }) },
      { group: `${side} leg`, key: `${s}Knee`, label: 'Bend knee', min: 0, max: 120, map: (v) => ({ [s]: { calf: [-v, 0, 0] } }) },
      { group: `${side} leg`, key: `${s}Foot`, label: 'Point foot', min: -30, max: 45, map: (v) => ({ [s]: { foot: [-v, 0, 0] } }) },
    ];
  }),
];

function adjustToPose(adjust) {
  const out = { c: {}, l: {}, r: {} };
  for (const a of ADJUST) {
    const v = +adjust[a.key] || 0;
    if (!v) continue;
    for (const [g, bones] of Object.entries(a.map(v))) {
      for (const [bone, rot] of Object.entries(bones)) {
        const cur = out[g][bone] || [0, 0, 0];
        out[g][bone] = [cur[0] + rot[0], cur[1] + rot[1], cur[2] + rot[2]];
      }
    }
  }
  return out;
}

/* ================================================================ Model tab */

function buildModelTab() {
  const host = $('[data-body="model"]');
  host.innerHTML = '';
  const R = RANGES[M.sex];

  const sex = chips([['female', 'Female'], ['male', 'Male']], M.sex, (v) => {
    if (v === M.sex) return;
    model.setSex(v);
    applyShape();
    applyLook();
    buildModelTab();
  }, { cls: 'seg big' });

  // ranges are clipped to what the body can actually reach for this sex
  const [wLo, wHi] = human ? model.reach('width') : R.width;
  const [hLo, hHi] = human ? model.reach('height') : R.height;

  const width = slider({
    label: 'Width', hint: 'shoulder point to point', min: wLo, max: wHi, step: 0.5, value: M.width,
    fmt: (v) => `${v.toFixed(1)} cm`,
    onInput: (v) => { M.width = v; queueShape(); },
  });
  const height = slider({
    label: 'Height', min: hLo, max: hHi, step: 0.5, value: M.height,
    fmt: (v) => `${fmtIn(v)} · ${Math.round(v * IN)} cm`,
    onInput: (v) => { M.height = v; queueShape(); },
  });

  // skin tone: one unlabelled slider along real-world tones (light → dark)
  const skin = slider({ label: '', min: 0, max: 1, step: 0.001, value: M.tone ?? DEFAULT_TONE, onInput: (v) => { M.tone = v; applyLook(); } });
  skin.classList.add('tone');
  skin.querySelector('.slider-head').remove();
  skin.querySelector('input').style.setProperty('--track', toneGradient());

  host.append(section('Model', sex), section('Measurements', width, height), section('Skin', skin));
}

/* ================================================================ Pose tab */

function buildPoseTab() {
  const host = $('[data-body="pose"]');
  host.innerHTML = '';
  const presets = chips(Object.entries(POSES).map(([k, p]) => [k, p.label]), state.pose.preset, (v) => {
    state.pose.preset = v; applyPose();
  }, { cls: 'grid2' });
  const hands = chips([['', 'Pose default'], ...Object.entries(HANDS).map(([k, h]) => [k, h.label])], state.pose.hands || '', (v) => {
    state.pose.hands = v; applyPose();
  });

  const groups = new Map();
  for (const a of ADJUST) {
    if (!groups.has(a.group)) groups.set(a.group, []);
    groups.get(a.group).push(slider({
      label: a.label, min: a.min, max: a.max, step: 1, value: state.pose.adjust[a.key] || 0, fmt: (v) => `${v > 0 ? '+' : ''}${v}°`,
      onInput: (v) => { state.pose.adjust[a.key] = v; applyPose(); },
    }));
  }
  const fine = document.createElement('div');
  fine.className = 'fold-list';
  for (const [name, list] of groups) {
    const d = document.createElement('details');
    d.className = 'fold';
    d.innerHTML = `<summary>${esc(name)}</summary>`;
    const inner = document.createElement('div');
    inner.className = 'fold-body';
    inner.append(...list);
    d.append(inner);
    fine.append(d);
  }
  const reset = document.createElement('button');
  reset.className = 'link';
  reset.textContent = 'Reset adjustments';
  reset.addEventListener('click', () => { state.pose.adjust = {}; applyPose(); buildPoseTab(); });

  host.append(section('Pose', presets), section('Hands', hands), section('Fine-tune', fine, reset));
}

/* ================================================================ Scene tab */

function buildSceneTab() {
  const host = $('[data-body="scene"]');
  host.innerHTML = '';
  const e = state.env;
  const setEnv = (patch) => { Object.assign(e, patch); stage.setEnvironment(e).then(() => updateCrop()); save(); };

  const kind = chips([['studio', 'Studio'], ['hdri', 'Location'], ['color', 'Solid'], ['image', 'Your image']], e.kind, (v) => {
    if (v === 'image' && !e.image) { $('#bg-file').click(); return; }
    setEnv({ kind: v });
    buildSceneTab();
  }, { cls: 'seg' });

  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.id = 'bg-file'; file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (e.image?.startsWith('blob:')) URL.revokeObjectURL(e.image);
    setEnv({ kind: 'image', image: URL.createObjectURL(f) });
    buildSceneTab();
  });

  const parts = [kind, file];
  if (e.kind === 'studio' || e.kind === 'color') {
    parts.push(swatches([
      { label: 'Warm white', hex: '#e9e6e1' }, { label: 'Paper', hex: '#f4f3f0' }, { label: 'Stone', hex: '#c9c4bb' },
      { label: 'Sand', hex: '#d8c3a5' }, { label: 'Blush', hex: '#e7c9c1' }, { label: 'Sage', hex: '#b7c1ac' },
      { label: 'Sky', hex: '#b9cad8' }, { label: 'Slate', hex: '#5b6470' }, { label: 'Charcoal', hex: '#2b2d31' },
    ], e.color, (hex) => setEnv({ color: hex })));
  }
  if (e.kind === 'hdri') {
    parts.push(chips(Object.entries(HDRIS).map(([k, h]) => [k, h.label]), e.hdri, (v) => setEnv({ hdri: v }), { cls: 'grid2' }));
    parts.push(slider({ label: 'Background blur', min: 0, max: 1, value: e.blur, fmt: pct, onInput: (v) => setEnv({ blur: v }) }));
    parts.push(slider({ label: 'Brightness', min: 0.3, max: 2, value: e.intensity, fmt: pct, onInput: (v) => setEnv({ intensity: v }) }));
    parts.push(slider({ label: 'Rotate location', min: -180, max: 180, step: 1, value: e.rotation, fmt: (v) => `${v}°`, onInput: (v) => setEnv({ rotation: v }) }));
  }
  if (e.kind === 'image') {
    const again = document.createElement('button');
    again.className = 'btn btn-ghost btn-sm';
    again.textContent = 'Choose another image';
    again.addEventListener('click', () => file.click());
    parts.push(again);
  }

  const L = state.light;
  const light = [
    chips(Object.entries(LIGHTING).map(([k, l]) => [k, l.label]), L.preset, (v) => { L.preset = v; stage.setLighting(L); save(); }),
    slider({ label: 'Light direction', min: -180, max: 180, step: 1, value: L.rotation, fmt: (v) => `${v}°`, onInput: (v) => { L.rotation = v; stage.setLighting(L); save(); } }),
    slider({ label: 'Light strength', min: 0.2, max: 2, value: L.intensity, fmt: pct, onInput: (v) => { L.intensity = v; stage.setLighting(L); save(); } }),
    slider({ label: 'Exposure', min: 0.5, max: 1.8, value: L.exposure, fmt: (v) => v.toFixed(2), onInput: (v) => { L.exposure = v; stage.setExposure(v); save(); } }),
  ];
  host.append(section('Background', ...parts), section('Lighting', ...light));
}

/* ================================================================ Shot panel */

const ASPECTS = { '4:5': 4 / 5, '1:1': 1, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16, '4:3': 4 / 3, '16:9': 16 / 9 };

function buildShotPanel() {
  const host = $('#shot-section');
  host.innerHTML = '<div class="panel-head"><h2>Shot</h2></div>';
  const sh = state.shot;
  const aspect = chips(Object.keys(ASPECTS).map((k) => [k, k]), sh.aspect, (v) => { sh.aspect = v; updateCrop(); save(); }, { cls: 'grid4' });
  const size = chips([['1080', '1080 px'], ['2048', '2K'], ['4096', '4K']], String(sh.size), (v) => { sh.size = +v; save(); }, { cls: 'seg' });
  const toggles = document.createElement('div');
  toggles.className = 'toggles';
  toggles.innerHTML = `
    <label class="check"><input type="checkbox" id="shot-transparent" ${sh.transparent ? 'checked' : ''} /> Transparent background (cut-out PNG)</label>
    <label class="check"><input type="checkbox" id="shot-shadow" ${sh.shadow ? 'checked' : ''} /> Keep floor shadow</label>`;
  $('#shot-transparent', toggles).addEventListener('change', (ev) => { sh.transparent = ev.target.checked; updateCrop(); save(); });
  $('#shot-shadow', toggles).addEventListener('change', (ev) => { sh.shadow = ev.target.checked; save(); });
  const format = chips([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']], sh.format, (v) => { sh.format = v; save(); }, { cls: 'seg' });
  const go = document.createElement('button');
  go.className = 'btn btn-primary btn-block';
  go.id = 'capture-main';
  go.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 4h6l1.6 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.4L9 4z"/><circle cx="12" cy="13" r="4"/></svg> Take shot';
  go.addEventListener('click', takeShot);
  const lab = (t, el) => { const w = document.createElement('div'); w.className = 'field-group'; w.innerHTML = `<span>${t}</span>`; w.append(el); return w; };
  host.append(lab('Frame', aspect), lab('Size', size), lab('Format', format), toggles, go);
}

function updateCrop() {
  const r = stage.cropRect(ASPECTS[state.shot.aspect] || 0.8);
  const el = $('#crop');
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  el.classList.toggle('transparent', !!state.shot.transparent);
}
stage.onResize(updateCrop);

let shots = [];
let busy = false;
async function takeShot() {
  if (!human || busy) return;
  busy = true;
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 350);
  try {
    const sh = state.shot;
    const type = `image/${sh.format}`;
    const { blob, width, height } = await stage.capture({
      aspect: ASPECTS[sh.aspect], longEdge: sh.size, transparent: sh.transparent, shadow: sh.shadow, type,
    });
    const url = URL.createObjectURL(blob);
    const ext = sh.transparent ? 'png' : sh.format === 'jpeg' ? 'jpg' : sh.format;
    const name = `3dgarments-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    shots.unshift({ url, name, width, height, transparent: sh.transparent });
    shots = shots.slice(0, 24);
    renderShots();
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    toast(`Saved ${width}×${height} ${ext.toUpperCase()}`, 'success');
  } catch (err) {
    console.error(err);
    toast(`Couldn't render the shot: ${err.message}`, 'error');
  } finally {
    busy = false;
  }
}

function renderShots() {
  $('#shots-count').textContent = shots.length;
  $('#shots').innerHTML = shots.length
    ? shots.map((s) => `<a class="shot${s.transparent ? ' checker' : ''}" href="${s.url}" download="${esc(s.name)}" title="${s.width}×${s.height} — click to download again"><img src="${s.url}" alt="" /></a>`).join('')
    : '<div class="grid-empty">Your shots appear here.</div>';
}

/* ================================================================ chrome */

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('[data-body]').forEach((x) => { x.hidden = x.dataset.body !== b.dataset.tab; });
}));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
  stage.setView(b.dataset.view);
}));
$('#spin-btn').addEventListener('click', (e) => {
  const on = !stage.autoRotate;
  stage.setAutoRotate(on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
});
$('#capture-top').addEventListener('click', takeShot);
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'p' || e.key === 'P') takeShot();
});

// mobile: bottom sheets
const sheets = { edit: $('#panel-edit'), shot: $('#panel-shot') };
const mobile = window.matchMedia('(max-width: 860px), (max-height: 540px) and (orientation: landscape) and (max-width: 1100px)'); // keep in sync with styles.css
let activeSheet = 'edit';
function layoutSheets() {
  for (const [k, el] of Object.entries(sheets)) el.classList.toggle('sheet-hidden', mobile.matches && k !== activeSheet);
  $('#app').classList.toggle('sheet-closed', mobile.matches && !activeSheet);
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset.sheet === activeSheet));
}
document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => {
  activeSheet = activeSheet === b.dataset.sheet ? null : b.dataset.sheet;
  layoutSheets();
}));
mobile.addEventListener('change', layoutSheets);

/* ================================================================ boot */

async function boot() {
  buildShotPanel();
  buildSceneTab();
  layoutSheets();
  updateCrop();
  stage.setLighting(state.light);
  stage.setExposure(state.light.exposure);
  await stage.setEnvironment(state.env);

  human = await Human.load();
  model = new ModelController(human, M);
  model.apply();
  stage.root.add(human.object);
  stage.setSubjectHeight(human.heightM);
  applyPose();
  const view = params.get('view') || 'front';
  stage.setView(view, { instant: true });
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  buildModelTab();
  buildPoseTab();
  $('#loader').classList.add('done');
  window.__3dg = { stage, human, state, takeShot, applyPose, applyShape, applyLook, buildModelTab, ready: true };
}

boot().catch((err) => {
  console.error(err);
  $('#loader').innerHTML = `<span class="error">Couldn't load the 3D model: ${esc(err.message)}</span>`;
  toast(err.message, 'error', 8000);
});
