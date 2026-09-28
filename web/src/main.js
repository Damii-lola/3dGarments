/**
 * 3dGarments Studio — shape a realistic human, pose it, light it, export product shots.
 */
import './styles.css';
import { createStage, HDRIS, LIGHTING } from './scene/stage.js';
import { loadHumanAssets } from './human/assets.js';
import { Human } from './human/human.js';
import { DEFAULT_SHAPE } from './human/modifiers.js';
import { SKIN_TONES } from './human/materials.js';
import { HAIR_STYLES, HAIR_COLORS } from './human/hair.js';
import { POSES, HANDS, DEFAULT_POSE, composePose } from './human/poses.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================================================================ state */

const FEMALE = { shape: { gender: 0, breastSize: 0.5 }, hair: 'sleek', stubble: 0, cm: 174 };
const MALE = { shape: { gender: 1, breastSize: 0.5 }, hair: 'crop', stubble: 0.35, cm: 185 };

const DEFAULTS = {
  shape: { ...DEFAULT_SHAPE, ageYears: 27, muscle: 0.55, proportions: 0.7, height: 0.62 },
  skin: { tone: SKIN_TONES[2].hex, stubble: 0 },
  hair: { style: 'sleek', color: HAIR_COLORS[1].hex },
  underwear: { style: 'auto', color: '#2c2c30' },
  pose: { preset: DEFAULT_POSE, hands: '', adjust: {} },
  env: { kind: 'studio', color: '#e9e6e1', hdri: 'lobby', blur: 0.35, rotation: 0, intensity: 1, image: null },
  light: { preset: 'soft', rotation: 0, intensity: 1, exposure: 1 },
  shot: { aspect: '4:5', size: 2048, transparent: false, shadow: true, format: 'png' },
};

const STORE = '3dg.studio.v1';
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
if (params.get('model') === 'male') Object.assign(state.shape, MALE.shape), state.hair.style = MALE.hair, state.skin.stubble = MALE.stubble;
if (params.get('model') === 'female') Object.assign(state.shape, FEMALE.shape), state.hair.style = FEMALE.hair, state.skin.stubble = 0;
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

function applyShape() {
  if (!human) return;
  human.setShape(state.shape);
  stage.setSubjectHeight(human.heightM);
  save();
}
let shapeRaf = 0;
const queueShape = () => { cancelAnimationFrame(shapeRaf); shapeRaf = requestAnimationFrame(applyShape); };

function applyPose() {
  human?.setPose(composePose(state.pose.preset, adjustToPose(state.pose.adjust), state.pose.hands || null));
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
  const s = state.shape;

  const gender = chips([['0', 'Female'], ['1', 'Male']], String(Math.round(s.gender)), (v) => {
    const preset = v === '1' ? MALE : FEMALE;
    Object.assign(s, preset.shape);
    if (human) s.height = human.heightParamFor(preset.cm, s);
    // follow the gender's default look unless the user picked something else
    if (Object.values([FEMALE.hair, MALE.hair]).includes(state.hair.style)) state.hair.style = preset.hair;
    state.skin.stubble = preset.stubble;
    applyShape();
    human?.setHair({ style: state.hair.style });
    human?.setSkin({ stubble: state.skin.stubble });
    buildModelTab();
  }, { cls: 'seg' });

  const BUILDS = {
    slim: { label: 'Slim', v: { weight: 0.3, muscle: 0.45, proportions: 0.7 } },
    athletic: { label: 'Athletic', v: { weight: 0.45, muscle: 0.78, proportions: 0.8 } },
    average: { label: 'Average', v: { weight: 0.5, muscle: 0.5, proportions: 0.5 } },
    curvy: { label: 'Curvy', v: { weight: 0.66, muscle: 0.45, proportions: 0.55, breastSize: 0.72 } },
    plus: { label: 'Plus size', v: { weight: 0.9, muscle: 0.4, proportions: 0.45 } },
    muscular: { label: 'Muscular', v: { weight: 0.62, muscle: 1, proportions: 0.85 } },
  };
  const builds = chips(Object.entries(BUILDS).map(([k, b]) => [k, b.label]), null, (k) => {
    Object.assign(s, BUILDS[k].v);
    applyShape();
    buildModelTab();
  });

  // height is chosen in centimetres; the macro value is solved for it
  const heightSlider = () => {
    const lo = Math.max(145, Math.ceil(human.estimateHeight({ ...s, height: 0 }) * 100));
    const hi = Math.min(205, Math.floor(human.estimateHeight({ ...s, height: 1 }) * 100));
    const cur = Math.round(human.estimateHeight(s) * 100);
    return slider({
      label: 'Height', min: lo, max: hi, step: 1, value: Math.min(hi, Math.max(lo, cur)), fmt: (v) => `${v} cm · ${ftIn(v)}`,
      onInput: (v) => { s.height = human.heightParamFor(v, s); queueShape(); },
    });
  };

  const body = [
    human ? heightSlider() : null,
    slider({ label: 'Weight', min: 0, max: 1, value: s.weight, fmt: pct, onInput: (v) => { s.weight = v; queueShape(); } }),
    slider({ label: 'Muscle', min: 0, max: 1, value: s.muscle, fmt: pct, onInput: (v) => { s.muscle = v; queueShape(); } }),
    slider({ label: 'Proportions', min: 0, max: 1, value: s.proportions, fmt: pct, hint: 'model-ideal →', onInput: (v) => { s.proportions = v; queueShape(); } }),
    s.gender < 0.5 ? slider({ label: 'Bust', min: 0, max: 1, value: s.breastSize, fmt: pct, onInput: (v) => { s.breastSize = v; queueShape(); } }) : null,
    slider({ label: 'Age', min: 25, max: 80, step: 1, value: s.ageYears, fmt: (v) => `${v}`, onInput: (v) => { s.ageYears = v; queueShape(); } }),
    slider({ label: 'Masculine ↔ feminine blend', min: 0, max: 1, value: s.gender, fmt: pct, onInput: (v) => { s.gender = v; queueShape(); } }),
  ];

  const face = ['african', 'asian', 'caucasian'].map((k) => slider({
    label: { african: 'African', asian: 'Asian', caucasian: 'European' }[k], min: 0, max: 1, value: s[k], fmt: pct,
    onInput: (v) => { s[k] = v; queueShape(); },
  }));

  const skin = swatches(SKIN_TONES, state.skin.tone, (hex) => { state.skin.tone = hex; human?.setSkin({ tone: hex }); save(); });

  const hairStyle = chips(Object.entries(HAIR_STYLES).map(([k, h]) => [k, h.label]), state.hair.style, (v) => {
    state.hair.style = v; human?.setHair({ style: v }); save();
  });
  const hairColor = swatches(HAIR_COLORS, state.hair.color, (hex) => { state.hair.color = hex; human?.setHair({ color: hex }); save(); });
  const stubble = s.gender >= 0.5 ? slider({ label: 'Stubble', min: 0, max: 1, value: state.skin.stubble, fmt: pct, onInput: (v) => { state.skin.stubble = v; human?.setSkin({ stubble: v }); save(); } }) : null;

  const uwStyle = chips([['auto', 'Auto'], ['set', 'Bra + briefs'], ['briefs', 'Briefs'], ['boxers', 'Boxer briefs'], ['none', 'None']], state.underwear.style, (v) => {
    state.underwear.style = v; human?.setUnderwear({ style: v }); save();
  });
  const uwColor = swatches([
    { label: 'Charcoal', hex: '#2c2c30' }, { label: 'Black', hex: '#141416' }, { label: 'White', hex: '#e9e7e2' },
    { label: 'Nude', hex: '#c9a58a' }, { label: 'Grey marl', hex: '#8b8b8f' }, { label: 'Navy', hex: '#1f2a44' },
  ], state.underwear.color, (hex) => { state.underwear.color = hex; human?.setUnderwear({ color: hex }); save(); });

  const reset = document.createElement('button');
  reset.className = 'link';
  reset.textContent = 'Reset model';
  reset.addEventListener('click', () => {
    Object.assign(state.shape, DEFAULTS.shape, { gender: s.gender });
    applyShape();
    buildModelTab();
  });

  host.append(
    section('Model', gender, builds),
    section('Body', ...body),
    section('Skin tone', skin),
    section('Face features', ...face),
    section('Hair', hairStyle, hairColor, stubble),
    section('Underwear', uwStyle, uwColor),
    reset,
  );
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
const mobile = window.matchMedia('(max-width: 860px)');
let activeSheet = 'edit';
function layoutSheets() {
  for (const [k, el] of Object.entries(sheets)) el.classList.toggle('sheet-hidden', mobile.matches && k !== activeSheet);
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

  const assets = await loadHumanAssets();
  human = new Human(assets, {
    shape: state.shape,
    skin: { tone: state.skin.tone, stubble: state.skin.stubble },
    hair: { style: state.hair.style, color: state.hair.color },
  });
  const wanted = params.get('model') === 'male' ? MALE.cm : params.get('model') === 'female' ? FEMALE.cm : null;
  if (wanted) { state.shape.height = human.heightParamFor(wanted, state.shape); human.setShape(state.shape); }
  human.setSkin({ tone: state.skin.tone, stubble: state.skin.stubble, hairColor: state.hair.color });
  human.setUnderwear(state.underwear);
  stage.root.add(human.object);
  stage.setSubjectHeight(human.heightM);
  applyPose();
  const view = params.get('view') || 'front';
  stage.setView(view, { instant: true });
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  buildModelTab();
  buildPoseTab();
  $('#loader').classList.add('done');
  window.__3dg = { stage, human, state, takeShot, applyPose, applyShape, ready: true };
}

boot().catch((err) => {
  console.error(err);
  $('#loader').innerHTML = `<span class="error">Couldn't load the 3D model: ${esc(err.message)}</span>`;
  toast(err.message, 'error', 8000);
});
