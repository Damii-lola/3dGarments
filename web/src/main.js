import './styles.css';
import { createStage } from './scene/stage.js';
import { createDresser } from './scene/dresser.js';
import { DEFAULT_BODY } from './scene/body.js';
import { createWardrobe } from './services/wardrobe.js';
import { CLOUD_AVAILABLE } from './services/config.js';
import * as auth from './services/auth.js';
import { api, onSlow } from './services/api.js';
import { svgToDataUrl } from './services/local.js';
import { SAMPLE_SVGS } from '@shared/samples.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CAT_LABEL = { top: 'Top', outerwear: 'Outerwear', dress: 'Dress', skirt: 'Skirt', pants: 'Trousers', shorts: 'Shorts' };
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';

/* ---------------- toasts ---------------- */
function toast(msg, type = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}

/* ---------------- scene ---------------- */
const stage = createStage($('#stage-canvas'));
const dresser = createDresser(stage);
const wardrobe = createWardrobe();
let selectedId = null;
let session = null;

/* ---------------- body ---------------- */
const BODY_KEY = '3dg.body';
let body = { ...DEFAULT_BODY };
try { Object.assign(body, JSON.parse(localStorage.getItem(BODY_KEY) || '{}')); } catch { /* private mode */ }

const bodyInputs = [...document.querySelectorAll('[data-body]')];
function paintSlider(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}
function renderBody() {
  for (const input of bodyInputs) {
    input.value = body[input.dataset.body];
    $(`#${input.id}-out`).textContent = `${Math.round(input.value)} cm`;
    paintSlider(input);
  }
}
let bodyTimer = null, bodySaveTimer = null;
function onBodyChange() {
  clearTimeout(bodyTimer);
  bodyTimer = setTimeout(() => dresser.setBody(body), 40);
  try { localStorage.setItem(BODY_KEY, JSON.stringify(body)); } catch { /* ignore */ }
  if (wardrobe.mode === 'cloud') {
    clearTimeout(bodySaveTimer);
    bodySaveTimer = setTimeout(() => api('/api/me/body', { method: 'PUT', body: { height_cm: body.heightCm, chest_cm: body.chestCm, waist_cm: body.waistCm, hips_cm: body.hipsCm } }).catch(() => {}), 800);
  }
}
for (const input of bodyInputs) {
  input.addEventListener('input', () => {
    body[input.dataset.body] = Number(input.value);
    $(`#${input.id}-out`).textContent = `${input.value} cm`;
    paintSlider(input);
    onBodyChange();
  });
}
$('#body-reset').addEventListener('click', () => { body = { ...DEFAULT_BODY }; renderBody(); onBodyChange(); });

/* ---------------- wardrobe grid ---------------- */
function thumbOf(g) { return g.preview_url || g.texture_url || ''; }

function renderGrid(items) {
  const grid = $('#garment-grid');
  $('#wardrobe-count').textContent = items.length;
  if (!items.length) {
    grid.innerHTML = '<div class="grid-empty">Your wardrobe is empty.<br/>Snap your first garment above.</div>';
    return;
  }
  grid.innerHTML = items.map((g) => {
    const worn = dresser.isWorn(g.id);
    const status = g.status === 'processing'
      ? '<div class="card-status"><div class="spinner"></div>Cutting out…</div>'
      : g.status === 'failed'
        ? `<div class="card-status failed">${esc(g.error || 'Failed')}${wardrobe.mode === 'cloud' ? '<br/><u data-retry>Retry</u>' : ''}</div>`
        : '';
    return `<button class="card${g.id === selectedId ? ' selected' : ''}" data-id="${esc(g.id)}" type="button">
      <div class="card-thumb">${thumbOf(g) ? `<img src="${esc(thumbOf(g))}" alt="" loading="lazy" />` : ''}</div>
      ${status}
      ${worn ? `<span class="card-worn" title="Wearing">${CHECK}</span>` : ''}
      <div class="card-meta"><div class="card-name">${esc(g.name || 'Untitled')}</div><div class="card-cat">${esc(CAT_LABEL[g.category] || (g.status === 'ready' ? '' : '…'))}</div></div>
    </button>`;
  }).join('');
}

$('#garment-grid').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const g = wardrobe.get(card.dataset.id);
  if (!g) return;
  if (e.target.closest('[data-retry]')) { wardrobe.retry(g.id).catch((err) => toast(err.message, 'error')); return; }
  if (g.status !== 'ready') return;
  if (selectedId === g.id && dresser.isWorn(g.id)) { dresser.takeOff(g.id); }
  else { await wearSafe(g); }
  selectedId = g.id;
  refresh();
});

async function wearSafe(g) {
  try { await dresser.wear(g); }
  catch (err) { console.error(err); toast(`Couldn't dress that garment: ${err.message}`, 'error'); }
}

/* ---------------- garment panel ---------------- */
function renderSelected() {
  const g = selectedId ? wardrobe.get(selectedId) : null;
  $('#garment-section').hidden = !g || g.status !== 'ready';
  if (!g || g.status !== 'ready') return;
  const a = g.analysis || {};
  const meta = [a.material, a.pattern, a.fit && a.fit !== 'regular' ? `${a.fit} fit` : null].filter(Boolean).join(' · ');
  $('#garment-card').innerHTML = `<img src="${esc(thumbOf(g))}" alt="" />
    <div><div><strong>${esc(g.name || 'Untitled')}</strong></div>
    <div class="muted">${a.primary_color ? `<span class="swatch" style="background:${esc(a.primary_color)}"></span>` : ''}${esc(meta || CAT_LABEL[g.category] || '')}</div>
    ${wardrobe.mode === 'local' ? '<div class="muted">Local only · sign in to save</div>' : ''}</div>`;
  if (document.activeElement !== $('#g-name')) $('#g-name').value = g.name || '';
  $('#g-category').value = g.category || 'top';
  const size = g.fit?.size ?? 1, lift = g.fit?.lift ?? 0;
  $('#g-size').value = size; $('#g-size-out').textContent = `${Math.round(size * 100)}%`; paintSlider($('#g-size'));
  $('#g-lift').value = lift; $('#g-lift-out').textContent = `${lift >= 0 ? '+' : ''}${Math.round(lift * 100)} cm`; paintSlider($('#g-lift'));
  $('#g-wear').textContent = dresser.isWorn(g.id) ? 'Take off' : 'Wear';
}

function refresh() {
  renderGrid(wardrobe.items);
  renderSelected();
  $('#stage').classList.toggle('has-garments', dresser.wornIds().length > 0);
}

let fitTimer = null;
function patchSelected(patch, { debounce = 0 } = {}) {
  const g = wardrobe.get(selectedId);
  if (!g) return;
  const local = { ...g, ...patch, fit: { ...(g.fit || {}), ...(patch.fit || {}) } };
  dresser.update(local);
  clearTimeout(fitTimer);
  fitTimer = setTimeout(async () => {
    try { const saved = await wardrobe.update(g.id, patch); if (dresser.isWorn(g.id)) dresser.update(saved); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }, debounce);
}

$('#g-size').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#g-size-out').textContent = `${Math.round(v * 100)}%`; paintSlider(e.target);
  patchSelected({ fit: { size: v } }, { debounce: 500 });
});
$('#g-lift').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#g-lift-out').textContent = `${v >= 0 ? '+' : ''}${Math.round(v * 100)} cm`; paintSlider(e.target);
  patchSelected({ fit: { lift: v } }, { debounce: 500 });
});
$('#g-category').addEventListener('change', (e) => patchSelected({ category: e.target.value }));
$('#g-name').addEventListener('change', (e) => patchSelected({ name: e.target.value.trim() }));
$('#g-wear').addEventListener('click', async () => {
  const g = wardrobe.get(selectedId);
  if (!g) return;
  if (dresser.isWorn(g.id)) dresser.takeOff(g.id); else await wearSafe(g);
  refresh();
});
$('#g-delete').addEventListener('click', async () => {
  const g = wardrobe.get(selectedId);
  if (!g) return;
  const btn = $('#g-delete');
  if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Confirm'; setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Delete'; }, 2500); return; }
  btn.dataset.confirm = ''; btn.textContent = 'Delete';
  try { dresser.forget(g.id); await wardrobe.remove(g.id); selectedId = null; refresh(); }
  catch (err) { toast(err.message, 'error'); }
});

/* ---------------- adding garments ---------------- */
async function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) { toast(`${file.name} is not an image`, 'error'); continue; }
    try {
      const g = await wardrobe.add(file);
      selectedId = g.id;
      if (g.status === 'ready') { await wearSafe(g); refresh(); }
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}
for (const id of ['#file-camera', '#file-library']) {
  $(id).addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; addFiles(files); });
}
// drag & drop anywhere
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])]; if (files.length) addFiles(files); });

async function addSample(key) {
  const s = SAMPLE_SVGS[key];
  const blob = await (await fetch(svgToDataUrl(s.svg))).blob();
  // rasterise SVG → PNG so the upload path is identical to a real photo
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 1000;
  c.getContext('2d').drawImage(img, 0, 0, 1000, 1000);
  URL.revokeObjectURL(img.src);
  const png = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  const file = new File([png], `${s.name}.jpg`, { type: 'image/jpeg' });
  const g = await wardrobe.add(file, { name: s.name });
  selectedId = g.id;
  if (g.status === 'ready') { await wearSafe(g); refresh(); }
  return g;
}
$('#sample-row').innerHTML = Object.entries(SAMPLE_SVGS).map(([k, s]) => `<button class="chip" type="button" data-sample="${k}">${esc(s.name)}</button>`).join('');
$('#sample-row').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sample]');
  if (b) addSample(b.dataset.sample).catch((err) => toast(err.message, 'error'));
});

// cloud processing finished → auto-wear
wardrobe.subscribe((items, changed) => {
  if (changed?.status === 'ready' && changed.id === selectedId) wearSafe(changed).then(refresh);
  if (changed?.status === 'failed') toast(`Couldn't process “${changed.name || 'garment'}”: ${changed.error}`, 'error', 6000);
  if (changed) {
    const worn = dresser.isWorn(changed.id);
    if (worn && changed.status === 'ready') dresser.update(changed);
  }
  refresh();
});

/* ---------------- toolbar ---------------- */
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
  stage.setView(b.dataset.view);
}));
$('#spin-btn').addEventListener('click', (e) => {
  const on = !stage.autoRotate;
  stage.setAutoRotate(on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
});
$('#snap-btn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = stage.snapshot();
  a.download = `3dgarments-${Date.now()}.png`;
  a.click();
});

/* ---------------- mobile sheet ---------------- */
const sheets = { wardrobe: $('#panel-wardrobe'), fit: $('#panel-fit') };
const mobile = window.matchMedia('(max-width: 860px)');
let activeSheet = 'wardrobe';
function layoutSheets() {
  for (const [k, el] of Object.entries(sheets)) el.classList.toggle('sheet-hidden', mobile.matches && k !== activeSheet);
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset.sheet === activeSheet));
  const open = mobile.matches && activeSheet ? sheets[activeSheet] : null;
  stage.setBottomInset(open ? open.getBoundingClientRect().height : 0);
}
document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => {
  activeSheet = activeSheet === b.dataset.sheet ? null : b.dataset.sheet;
  layoutSheets();
}));
mobile.addEventListener('change', layoutSheets);
new ResizeObserver(layoutSheets).observe(sheets.wardrobe);
new ResizeObserver(layoutSheets).observe(sheets.fit);

/* ---------------- auth / mode ---------------- */
onSlow((slow) => { $('#wake-pill').hidden = !slow; });

function renderMode() {
  const pill = $('#mode-pill');
  pill.dataset.mode = wardrobe.mode;
  pill.textContent = wardrobe.mode === 'cloud' ? `Cloud · ${session?.user?.email || ''}` : 'Local mode · not saved';
  const btn = $('#account-btn');
  btn.hidden = !CLOUD_AVAILABLE;
  btn.textContent = session ? 'Sign out' : 'Sign in';
}

async function enterCloud() {
  try {
    await wardrobe.setMode('cloud');
    const { body: b } = await api('/api/me/body');
    body = { heightCm: +b.height_cm, chestCm: +b.chest_cm, waistCm: +b.waist_cm, hipsCm: +b.hips_cm };
    renderBody();
    await dresser.setBody(body);
  } catch (err) {
    toast(`Cloud unavailable (${err.message}). Using local mode.`, 'error', 6000);
    await wardrobe.setMode('local');
  }
  renderMode();
  refresh();
}

async function enterLocal() {
  for (const id of dresser.wornIds()) dresser.forget(id);
  await wardrobe.setMode('local');
  renderMode();
  refresh();
}

const dialog = $('#auth-dialog');
$('#auth-form').addEventListener('submit', async (e) => {
  const action = e.submitter?.value;
  if (action === 'local') { dialog.close(); await enterLocal(); return; }
  e.preventDefault();
  const email = $('#auth-email').value.trim(), password = $('#auth-password').value;
  $('#auth-error').textContent = '';
  try {
    if (action === 'signup') {
      const r = await auth.signUp(email, password);
      if (!r.session) { $('#auth-error').textContent = 'Check your inbox to confirm your email, then sign in.'; return; }
    } else {
      await auth.signIn(email, password);
    }
    dialog.close();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});
$('#account-btn').addEventListener('click', async () => {
  if (session) { await auth.signOut(); return; }
  dialog.showModal();
});

async function boot() {
  renderBody();
  await dresser.setBody(body);
  refresh();
  const params = new URLSearchParams(location.search);

  if (CLOUD_AVAILABLE) {
    session = await auth.getSession();
    await auth.onAuthChange(async (s) => {
      const was = session?.user?.id;
      session = s;
      if (s?.user?.id !== was) { for (const id of dresser.wornIds()) dresser.forget(id); s ? await enterCloud() : await enterLocal(); }
      renderMode();
    });
    if (session) await enterCloud();
    else { await enterLocal(); if (!params.has('demo')) dialog.showModal(); }
  } else {
    await enterLocal();
  }
  layoutSheets();

  // ?demo=tee,jeans — auto-dress samples (handy for demos + tests)
  if (params.has('demo')) {
    for (const k of (params.get('demo') || 'tee,jeans').split(',')) if (SAMPLE_SVGS[k]) await addSample(k);
    if (params.get('view')) stage.setView(params.get('view'));
  }
  window.__3dg = { stage, dresser, wardrobe, ready: true };
}
boot().catch((err) => { console.error(err); toast(err.message, 'error'); });
