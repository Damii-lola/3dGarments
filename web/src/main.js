/**
 * 3dGarments — size finder.
 * One unified flow: scan your body from a video, or pick your usual size.
 * No 3D model — just your recommended clothing size and measurements.
 */
import './styles.css';
import { loadProfile, saveProfile } from './services/profile.js';
import { SIZE_ORDER, SIZES, applySize, findClosestSize, chestLabel } from './sizes.js';
import { buildBodyScanCard } from './body-scan/body-scan.js';
import { API_URL } from './services/config.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================================================================ state */

const STORE = '3dg.tryon.v3';

let profile = { sex: 'female', updated: 0, models: { female: { sex: 'female' }, male: { sex: 'male' } } };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved?.models) profile = saved;
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

/* ================================================================ toasts */

const toasts = $('#toasts');
function toast(msg, type = 'info', ms = 3600) {
  if (!toasts) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toasts.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}

/* ================================================================ UI kit */

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

/* ---------------------------------------------------------------- size result readout */

/** Show the currently-applied size (from scan or quick pick) as a readout. */
function renderSizeResult() {
  const el = $('#size-result');
  if (!el) return;
  const sizeKey = M._size;
  const size = sizeKey && SIZES[M.sex]?.[sizeKey];
  if (!size) {
    el.innerHTML = `<p style="color:var(--muted);font-size:12px;">No size picked yet. Scan your body or choose a size below.</p>`;
    return;
  }
  const chest = chestLabel(M.sex);
  const fromScan = M._sizeFromScan ? ' (from body scan)' : '';
  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;">
      <b style="font-size:16px;">Your size: <span style="color:var(--accent);font-size:22px;">${sizeKey}</span></b>
      <span style="font-size:11px;color:var(--muted);">${fromScan}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11.5px;color:var(--muted);">
      <div><b>${chest}</b><br><span style="color:var(--text);">${size.chest ?? size.bust}″</span></div>
      <div><b>Waist</b><br><span style="color:var(--text);">${size.waist}″</span></div>
      <div><b>Hips</b><br><span style="color:var(--text);">${size.hips}″</span></div>
      <div><b>Height</b><br><span style="color:var(--text);">${size.height}″</span></div>
      <div><b>Weight</b><br><span style="color:var(--text);">${size.weight} kg</span></div>
      <div><b>Build</b><br><span style="color:var(--text);">${size.build}</span></div>
    </div>
  `;
}

/* ---------------------------------------------------------------- quick size picker (part of size finding) */

/**
 * Quick size picker integrated into the size finder: choose your usual size
 * without scanning. This is an alternative to the body scan above it.
 */
function buildSizePicker() {
  let sizeSelected = M._size || null;

  const title = document.createElement('h3');
  title.textContent = 'Or pick your size';

  const intro = document.createElement('div');
  intro.style.cssText = 'font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:6px;';
  intro.textContent = "I usually wear";

  const sizeChips = chips(
    SIZE_ORDER.map((k) => [k, k]),
    sizeSelected,
    (v) => { sizeSelected = v; },
    { cls: 'grid6' }
  );

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary grow';
  applyBtn.textContent = 'Apply this size';
  applyBtn.addEventListener('click', () => {
    if (!sizeSelected) { toast('Pick a size first'); return; }
    const size = applySize(M, M.sex, sizeSelected);
    if (size) {
      M._size = sizeSelected;
      M._sizeFromScan = false;
      toast(`Applied size ${sizeSelected}`);
      renderSizeResult();
      save();
    }
  });

  const measureNote = document.createElement('div');
  measureNote.style.cssText = 'border-top:1px solid var(--line-2);padding-top:8px;margin-top:10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);';
  measureNote.textContent = 'Or enter your measurements';

  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:8px;margin-top:6px;';

  const numInput = (label, id, placeholder) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--muted);';
    const span = document.createElement('span'); span.textContent = label;
    const out = document.createElement('output'); out.id = id; out.textContent = placeholder;
    head.append(span, out);
    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = placeholder;
    input.style.cssText = 'height:22px;border-radius:6px;background:#1d2029;border:1px solid var(--line);color:inherit;padding:0 6px;font-size:12px;';
    input.addEventListener('input', () => { out.textContent = input.value + (placeholder === 'in' ? ' in' : ''); });
    wrap.append(head, input);
    return { wrap, input, out };
  };

  const szHeight = numInput('Height', 'sz-height-out', 'in');
  const szChest = numInput(chestLabel(M.sex), 'sz-chest-out', 'in');
  const szWaist = numInput('Waist', 'sz-waist-out', 'in');
  const szHips = numInput('Hips', 'sz-hips-out', 'in');
  row.append(szHeight.wrap, szChest.wrap, szWaist.wrap, szHips.wrap);

  const findBtn = document.createElement('button');
  findBtn.className = 'btn btn-ghost grow';
  findBtn.textContent = 'Find my size';
  findBtn.style.cssText = 'margin-top:8px;';
  findBtn.addEventListener('click', () => {
    const h = +szHeight.input.value, c = +szChest.input.value, w = +szWaist.input.value, hp = +szHips.input.value;
    if (!h || !c || !w || !hp) { toast('Fill in all four measurements'); return; }
    const key = findClosestSize(M.sex, { height: h, chest: c, waist: w, hips: hp });
    if (!key) { toast("Couldn't match a size"); return; }
    const size = applySize(M, M.sex, key);
    if (size) {
      M._size = key;
      M._sizeFromScan = false;
      toast(`Closest match: size ${key}`);
      renderSizeResult();
      save();
    }
  });

  return group('Or pick your size', null, intro, sizeChips, applyBtn, measureNote, row, findBtn);
}

/* ---------------------------------------------------------------- panel */

function buildPanel() {
  const host = $('#panel');
  host.innerHTML = '';

  const sex = chips([['female', 'Female'], ['male', 'Male']], M.sex, (v) => {
    if (v === M.sex) return;
    profile.sex = v;
    M = profile.models[v];
    buildPanel();
  }, { cls: 'seg big' });

  const sizeResult = document.createElement('div');
  sizeResult.id = 'size-result';
  sizeResult.style.cssText = 'border:1px solid var(--line-2);border-radius:var(--radius);background:var(--card);padding:16px;';
  renderSizeResult();

  host.append(
    group('Find your size', null, sex, sizeResult),
    group('Body scan', null, buildBodyScanCard({
      sex: M.sex,
      apiUrl: API_URL,
      onApply: (sizeKey, measurements) => {
        const size = applySize(M, M.sex, sizeKey);
        if (size) {
          M._size = sizeKey;
          M._sizeFromScan = true;
          toast(`Applied size ${sizeKey} from body scan`);
          renderSizeResult();
          save();
        }
      },
    })),
    buildSizePicker(),
  );
}

/* ================================================================ boot */

function boot() {
  buildPanel();
}

boot();
