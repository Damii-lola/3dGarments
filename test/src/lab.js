/**
 * 3dGarments Lab — workbench for the human, rig and poses.
 * Drives the real app modules (web/src/human + web/src/scene) with debug views on top.
 */
import './lab.css';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { createStage } from '@web/scene/stage.js';
import { Human } from '@web/human/human.js';
import { ModelController, RANGES, fmtIn, IN, DEFAULT_TONE } from '@web/human/body.js';
import { POSES, composePose } from '@web/human/poses.js';
import { skinLikeBody } from '@web/live/blender.js';

const $ = (s) => document.querySelector(s);
const stage = createStage($('#view'));
const params = new URLSearchParams(location.search);

const t0 = performance.now();
const human = await Human.load();
const tLoad = performance.now() - t0;
const sex = params.get('gender') === 'male' ? 'male' : 'female';
const M = { sex, ...RANGES[sex].defaults, tone: params.get('tone') != null ? +params.get('tone') : DEFAULT_TONE };
const model = new ModelController(human, M);
model.apply();
stage.root.add(human.object);
// the stage renders on demand: every pose / shape change asks for a redraw
for (const k of ['setPose', 'setShape', 'setSkin', 'setSex']) { const f = human[k].bind(human); human[k] = (...a) => { const r = f(...a); stage.invalidate(); return r; }; }
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
  slider(host, { label: 'Skin tone', min: 0, max: 1, step: 0.01, value: M.tone, fmt: (v) => v.toFixed(2) }, (v) => { M.tone = v; model.applyLook(); });
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
for (const id of ['skeleton', 'wire', 'weights', 'spin', 'suit']) {
  const el = $(`#dbg-${id}`);
  dbg[id] = el.checked;
  el.addEventListener('change', () => {
    dbg[id] = el.checked;
    helper.visible = dbg.skeleton;
    human.body.material.forEach((m) => { m.wireframe = dbg.wire; });
    stage.setAutoRotate(dbg.spin);
    human.setSuit(dbg.suit);
    stage.invalidate?.(2);
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

/* ------------------------------------------------ templates */
const templates = new Map(); // id -> THREE.SkinnedMesh currently loaded

async function loadTemplate(id, url) {
  const loader = new OBJLoader();
  const group = await loader.loadAsync(url);
  const geom = group.children[0]?.geometry;
  if (!geom) throw new Error(`no geometry in ${url}`);
  geom.computeVertexNormals();
  const P = geom.attributes.position.array;
  const idx = geom.index?.array ?? (() => { const a = new Uint32Array(P.length / 3); for (let i = 0; i < a.length; i++) a[i] = i; return a; })();
  const { si, sw } = skinLikeBody(human, P, idx);
  geom.setAttribute('skinIndex',  new THREE.Uint16BufferAttribute(si, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mat = new THREE.MeshStandardMaterial({ color: 0xf0eeeb, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.SkinnedMesh(geom, mat);
  const body = human.active.mesh;
  mesh.bind(body.skeleton, body.bindMatrix);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  body.parent.add(mesh);
  templates.set(id, mesh);
  stage.invalidate(2);
}

function unloadTemplate(id) {
  const mesh = templates.get(id);
  if (!mesh) return;
  mesh.removeFromParent();
  mesh.geometry.dispose();
  templates.delete(id);
  stage.invalidate(2);
}

const TEMPLATE_DEFS = {
  'tpl-male-basic-tee': { sex: 'male', url: './garments/male_basic_tee.obj' },
};

document.querySelectorAll('#templates button').forEach((btn) => {
  const def = TEMPLATE_DEFS[btn.id];
  if (!def) return;
  btn.addEventListener('click', async () => {
    if (templates.has(btn.id)) {
      unloadTemplate(btn.id);
      btn.classList.remove('on');
    } else {
      if (def.sex && M.sex !== def.sex) {
        model.setSex(def.sex); model.apply(); human.setPose(pose);
        stage.setSubjectHeight(human.heightM); markSex(); buildBody(); fillBones();
        helper.removeFromParent();
        helper = new THREE.SkeletonHelper(human.active.root);
        helper.visible = dbg.skeleton;
        stage.scene.add(helper);
      }
      btn.textContent = 'Loading…';
      btn.disabled = true;
      try {
        await loadTemplate(btn.id, def.url);
        btn.classList.add('on');
      } catch (e) {
        console.error(e);
      } finally {
        btn.textContent = 'Male_Basic_Tee';
        btn.disabled = false;
      }
    }
  });
});
