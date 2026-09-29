/**
 * 3dGarments Lab — workbench for the human, rig and poses.
 * Drives the real app modules (web/src/human + web/src/scene) with debug views on top.
 */
import './lab.css';
import * as THREE from 'three';
import { createStage } from '@web/scene/stage.js';
import { Human } from '@web/human/human.js';
import { ModelController, SKINS, RANGES, fmtIn, IN } from '@web/human/body.js';
import { POSES, composePose } from '@web/human/poses.js';

const $ = (s) => document.querySelector(s);
const stage = createStage($('#view'));
const params = new URLSearchParams(location.search);

const t0 = performance.now();
const human = await Human.load();
const tLoad = performance.now() - t0;
const sex = params.get('gender') === 'male' ? 'male' : 'female';
const M = { sex, ...RANGES[sex].defaults, skin: params.get('skin') || 'gray' };
const model = new ModelController(human, M);
model.apply();
stage.root.add(human.object);
stage.setSubjectHeight(human.heightM);
stage.setView(params.get('view') || 'front', { instant: true });
let pose = composePose('stand');
human.setPose(pose);
let lastShapeMs = 0;

/* ------------------------------------------------ sliders */
function slider(host, { label, min, max, step, value, fmt = (v) => v }, onInput) {
  const el = document.createElement('label');
  el.className = 'slider';
  el.innerHTML = `<span>${label}</span><output>${fmt(value)}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
  const input = el.querySelector('input'), out = el.querySelector('output');
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); onInput(+input.value); });
  host.append(el);
  return { set(v) { input.value = v; out.textContent = fmt(v); } };
}

// the studio's four model controls — same ModelController as the app
function buildBody() {
  const host = $('#shape-sliders');
  host.innerHTML = '';
  let raf = 0;
  const reshape = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const t = performance.now();
      model.applyShape();
      human.setPose(pose);
      lastShapeMs = performance.now() - t;
      stage.setSubjectHeight(human.heightM);
    });
  };
  const [wLo, wHi] = model.reach('width'), [hLo, hHi] = model.reach('height');
  slider(host, { label: 'Width (shoulder point to point)', min: wLo, max: wHi, step: 0.5, value: M.width, fmt: (v) => `${v.toFixed(1)} cm` }, (v) => { M.width = v; reshape(); });
  slider(host, { label: 'Height', min: hLo, max: hHi, step: 0.5, value: M.height, fmt: (v) => `${fmtIn(v)} · ${Math.round(v * IN)} cm` }, (v) => { M.height = v; reshape(); });
  const skins = document.createElement('div');
  skins.className = 'chips';
  skins.innerHTML = SKINS.map((k) => `<button data-skin="${k.id}" class="${k.id === M.skin ? 'on' : ''}" title="${k.label}"><i class="dot" style="--c:${k.hex}"></i>${k.label}</button>`).join('');
  skins.addEventListener('click', (e) => {
    const b = e.target.closest('[data-skin]');
    if (!b) return;
    M.skin = b.dataset.skin;
    model.apply();
    human.setPose(pose);
    buildBody();
  });
  host.append(skins);
}
$('#presets').innerHTML = '<button data-g="female">Female</button><button data-g="male">Male</button>';
const markSex = () => $('#presets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.g === M.sex));
$('#presets').addEventListener('click', (e) => {
  const g = e.target.dataset.g;
  if (!g || g === M.sex) return;
  model.setSex(g);
  model.apply();
  human.setPose(pose);
  stage.setSubjectHeight(human.heightM);
  markSex();
  buildBody();
  fillBones();
  helper.removeFromParent();
  helper = new THREE.SkeletonHelper(human.active.root);
  helper.visible = dbg.skeleton;
  stage.scene.add(helper);
});
markSex();
buildBody();

/* ------------------------------------------------ poses + bone editor */
$('#poses').innerHTML = Object.entries(POSES).map(([k, p]) => `<button data-p="${k}">${p.label}</button>`).join('');
$('#poses').addEventListener('click', (e) => {
  const k = e.target.dataset.p;
  if (!k) return;
  pose = composePose(k);
  human.setPose(pose);
  selectBone($('#bone').value);
});
const fillBones = () => { $('#bone').innerHTML = human.bones.map((b) => `<option>${b.name}</option>`).join(''); };
fillBones();
const boneSliders = ['x flex', 'y twist', 'z side'].map((label, i) => slider($('#bone-sliders'), { label, min: -180, max: 180, step: 1, value: 0, fmt: (v) => `${v}°` }, (v) => {
  const name = $('#bone').value;
  pose[name] = [...(pose[name] || [0, 0, 0])];
  pose[name][i] = v;
  human.setPose(pose);
  $('#pose-json').textContent = JSON.stringify(pose);
}));
function selectBone(name) {
  const r = pose[name] || [0, 0, 0];
  boneSliders.forEach((s, i) => s.set(r[i] || 0));
  $('#pose-json').textContent = JSON.stringify(pose);
  paintWeights();
}
$('#bone').addEventListener('change', (e) => selectBone(e.target.value));

/* ------------------------------------------------ debug */
let helper = new THREE.SkeletonHelper(human.active.root);
helper.visible = false;
stage.scene.add(helper);
const dbg = {};
for (const id of ['skeleton', 'wire', 'weights', 'spin']) {
  const el = $(`#dbg-${id}`);
  dbg[id] = el.checked;
  el.addEventListener('change', () => {
    dbg[id] = el.checked;
    helper.visible = dbg.skeleton;
    human.body.material.forEach((m) => { m.wireframe = dbg.wire; });
    stage.setAutoRotate(dbg.spin);
    paintWeights();
  });
}
let weightMat = null;
function paintWeights() {
  const mats = human.body.material;
  if (!dbg.weights) { if (weightMat) { mats[0] = weightMat.orig; weightMat = null; } return; }
  const bi = human.boneIndex[$('#bone').value];
  const g = human.body.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const col = new Float32Array(si.count * 3);
  for (let v = 0; v < si.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.array[v * 4 + k] === bi) w += sw.array[v * 4 + k];
    col.set([w, 0.15 + (1 - w) * 0.2, 1 - w], v * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!weightMat) weightMat = { orig: mats[0] };
  mats[0] = new THREE.MeshBasicMaterial({ vertexColors: true });
}

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => stage.setView(b.dataset.view)));

/* ------------------------------------------------ stats */
let frames = 0, fpsT = performance.now();
(function tick() {
  frames++;
  const now = performance.now();
  if (now - fpsT > 500) {
    const fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now;
    const info = stage.renderer.info;
    $('#stats').textContent = [
      `fps            ${fps}`,
      `draw calls     ${info.render.calls}`,
      `triangles      ${info.render.triangles.toLocaleString()}`,
      `assets load    ${tLoad.toFixed(0)} ms`,
      `last reshape   ${lastShapeMs.toFixed(1)} ms`,
      `height         ${(human.heightM * 100).toFixed(1)} cm`,
      `bones          ${human.bones.length}`,
    ].join('\n');
  }
  requestAnimationFrame(tick);
})();

window.__lab = { stage, human, model, THREE, composePose, POSES, setPose: (p) => { pose = p; human.setPose(p); }, ready: true };
