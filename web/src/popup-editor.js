/**
 * "Preview & Customise Popup": the editor a store uses to style its popup.
 *
 * What it edits is the settings object defined in popup-config.js, and what it shows
 * is the real thing: the three screens are the real pages in frames (the store page
 * with the real button; the popup's record screen; its results screen), each told the
 * draft settings as they change and drawing them with the same code a shopper's popup
 * uses. So there is no second, approximate copy of the popup to keep in step.
 *
 * Nothing is saved until "Save"; closing with unsaved changes asks first.
 */
import { api } from './services/api.js';
import {
  buttonAttributeString, DEFAULTS, effectiveColours, FONTS, fromAnalysis, hex6, normalizePopup,
} from './popup-config.js';

/** One-click starting points: the whole look in one go. */
const PRESETS = [
  { name: 'FindMySize', theme: { background: '#221a15', text: '#f5e9d6', accent: '#f0521f' } },
  { name: 'Midnight', theme: { background: '#10151f', text: '#e8edf7', accent: '#4f8cff' } },
  { name: 'Paper', theme: { background: '#f6efe3', text: '#191411', accent: '#d8431a' } },
  { name: 'Forest', theme: { background: '#10201a', text: '#e6f0e8', accent: '#3fbf86' } },
  { name: 'Plum', theme: { background: '#1d1423', text: '#f1e8f5', accent: '#c26bff' } },
  { name: 'Clean', theme: { background: '#ffffff', text: '#161616', accent: '#161616' } },
];

const PHASES = [
  { id: 0, label: 'Button', hint: 'On your product page' },
  { id: 1, label: 'Record', hint: 'The first screen' },
  { id: 2, label: 'Results', hint: 'After the scan' },
];

/* ---------- tiny DOM helpers ---------- */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

let uid = 0;
const nextId = () => `pe-${(uid += 1)}`;

/* ---------- the editor ---------- */

/**
 * @param {object}   options
 * @param {object}   options.chart      the garment being customised ({ code, name, popup, ... })
 * @param {string}   options.siteUrl    the site's own base URL, ending in "/"
 * @param {(popup: object) => Promise<void>} options.onSave   stores the settings; throws to refuse
 * @param {(message: string, kind?: string) => void} options.toast
 */
export function openPopupEditor({ chart, siteUrl, onSave, toast }) {
  const opener = document.activeElement;
  let cfg = normalizePopup(chart.popup);
  let savedJson = JSON.stringify(cfg);
  let phase = 1;
  let busy = false;
  const frames = new Map(); // phase -> { iframe, ready }

  /* ---- shell ---- */
  const root = el('div', { class: 'pe', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Customise the popup for ${chart.name}` });
  const tabs = el('div', { class: 'pe-tabs', role: 'tablist', 'aria-label': 'Screens' });
  const saveButton = el('button', { class: 'btn btn--primary btn--small', type: 'button', text: 'Save' });
  const closeButton = el('button', { class: 'btn btn--ghost btn--small', type: 'button', text: 'Close' });
  const status = el('span', { class: 'pe-status', role: 'status', 'aria-live': 'polite' });
  const side = el('div', { class: 'pe-side' });
  const stage = el('div', { class: 'pe-stage' });
  const shopBox = el('div', { class: 'pe-shop' });
  const popupBox = el('div', { class: 'pe-popup' });
  stage.append(shopBox, popupBox);

  root.append(
    el('div', { class: 'pe-bar' },
      el('h2', { class: 'pe-title' }, el('small', { text: 'Customise popup' }), chart.name),
      tabs,
      el('div', { class: 'pe-actions' }, status, closeButton, saveButton)),
    el('div', { class: 'pe-body' }, side, stage),
  );

  /* ---- state ---- */
  const isDirty = () => JSON.stringify(cfg) !== savedJson;

  // The "hard to read" note under the colours: one element, kept up to date as colours change.
  const contrastNote = el('p', { class: 'pe-note', hidden: true });
  function updateContrastNote() {
    const eff = effectiveColours(cfg);
    contrastNote.hidden = !eff.corrected;
    if (eff.corrected) {
      contrastNote.replaceChildren('That text colour is hard to read on this background, so the popup uses ', el('b', { text: eff.text }), ' instead.');
    }
  }

  function refreshChrome() {
    const dirty = isDirty();
    saveButton.disabled = busy || !dirty;
    status.textContent = dirty ? 'Unsaved changes' : '';
    const { background } = effectiveColours(cfg);
    popupBox.style.setProperty('--pe-bg', background);
    popupBox.style.setProperty('--pe-radius', `${cfg.theme.radius}px`);
  }

  function activeFrame() {
    return frames.get(phase);
  }

  let queued = false;
  function push() {
    refreshChrome();
    updateContrastNote();
    if (queued) return;
    queued = true;
    // One message per frame, however fast a slider is dragged.
    requestAnimationFrame(() => {
      queued = false;
      const frame = activeFrame();
      if (frame && frame.ready && frame.iframe.contentWindow) {
        frame.iframe.contentWindow.postMessage({ source: '3dg-preview', type: 'config', config: cfg }, location.origin);
      }
    });
  }

  /** Any control: change the draft, then redraw. `rebuild` re-renders the controls (when one control affects another). */
  function edit(change, { rebuild = false } = {}) {
    change(cfg);
    cfg = normalizePopup(cfg);
    push();
    if (rebuild) renderControls();
  }

  /* ---- controls ---- */
  function field(label, control, hint) {
    const id = nextId();
    const labelEl = el('label', { class: 'pe-label', for: id, text: label });
    control.id = id;
    return el('div', { class: 'pe-field' }, labelEl, control, hint ? el('p', { class: 'pe-hint', text: hint }) : null);
  }

  function textInput(get, set, { max = 60, multiline = false, placeholder = '' } = {}) {
    const node = el(multiline ? 'textarea' : 'input', { class: 'pe-input', maxlength: max, placeholder, rows: multiline ? 4 : undefined, type: multiline ? undefined : 'text' });
    node.value = get();
    node.addEventListener('input', () => edit((c) => set(c, node.value)));
    // an emptied box means "the default", so show the default again once the field is left
    node.addEventListener('blur', () => { node.value = get(); });
    return node;
  }

  function colourInput(get, set, { label }) {
    const picker = el('input', { class: 'pe-swatch', type: 'color', 'aria-label': `${label} colour` });
    const hexBox = el('input', { class: 'pe-input pe-hex', type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': `${label} as a hex code` });
    const sync = () => { picker.value = get(); hexBox.value = get(); };
    sync();
    picker.addEventListener('input', () => { hexBox.value = picker.value; edit((c) => set(c, picker.value)); });
    hexBox.addEventListener('input', () => {
      const value = hex6(hexBox.value.startsWith('#') ? hexBox.value : `#${hexBox.value}`);
      if (value) { picker.value = value; edit((c) => set(c, value)); }
    });
    hexBox.addEventListener('blur', sync);
    const wrap = el('div', { class: 'pe-colour' }, picker, hexBox);
    // the label's "for" targets the first control
    Object.defineProperty(wrap, 'id', { set: (v) => { picker.id = v; }, get: () => picker.id });
    return wrap;
  }

  function rangeInput(get, set, { min, max, step, format }) {
    const output = el('output', { class: 'pe-out' });
    const input = el('input', { class: 'pe-range', type: 'range', min, max, step });
    const show = () => { output.textContent = format(get()); };
    input.value = get();
    show();
    input.addEventListener('input', () => { edit((c) => set(c, Number(input.value))); show(); });
    const wrap = el('div', { class: 'pe-rangewrap' }, input, output);
    Object.defineProperty(wrap, 'id', { set: (v) => { input.id = v; }, get: () => input.id });
    return wrap;
  }

  function selectInput(get, set, options) {
    const node = el('select', { class: 'pe-input pe-select' }, options.map(([value, text]) => el('option', { value, text })));
    node.value = get();
    node.addEventListener('change', () => edit((c) => set(c, node.value)));
    return node;
  }

  function segmented(get, set, options, label) {
    const group = el('div', { class: 'pe-seg', role: 'group', 'aria-label': label });
    const paint = () => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(get()))));
    for (const [value, text] of options) {
      group.append(el('button', { type: 'button', 'data-value': value, text, onclick: () => { edit((c) => set(c, value)); paint(); } }));
    }
    paint();
    Object.defineProperty(group, 'id', { set: () => {}, get: () => '' });
    return group;
  }

  function toggle(get, set, label, hint) {
    const id = nextId();
    const input = el('input', { type: 'checkbox', id });
    input.checked = get();
    input.addEventListener('change', () => edit((c) => set(c, input.checked)));
    return el('div', { class: 'pe-field pe-toggle' },
      el('div', {}, el('label', { class: 'pe-label pe-label--plain', for: id, text: label }), hint ? el('p', { class: 'pe-hint', text: hint }) : null),
      el('label', { class: 'pe-switch' }, input, el('span', { class: 'pe-switch-track' })));
  }

  function section(title, body, { open = true, resetLabel, onReset } = {}) {
    const summary = el('summary', {}, el('span', { text: title }));
    if (onReset) {
      summary.append(el('button', {
        class: 'pe-reset', type: 'button', text: resetLabel || 'Reset',
        onclick: (event) => { event.preventDefault(); event.stopPropagation(); onReset(); },
      }));
    }
    const details = el('details', { class: 'pe-section' }, summary, el('div', { class: 'pe-section-body' }, body));
    if (open) details.open = true;
    return details;
  }

  /* ---- the controls for each screen ---- */
  const percent = (v) => `${Math.round(v * 100)}%`;
  const pixels = (v) => `${Math.round(v)} px`;

  function buttonControls() {
    return [
      field('Button text', textInput(() => cfg.button.label, (c, v) => { c.button.label = v; }, { max: 28 })),
      field('Button colour', colourInput(() => cfg.button.bg, (c, v) => { c.button.bg = v; }, { label: 'Button' })),
      field('Text colour', colourInput(() => cfg.button.textColor, (c, v) => { c.button.textColor = v; }, { label: 'Button text' })),
      field('Corners', rangeInput(() => cfg.button.radius, (c, v) => { c.button.radius = v; }, { min: 0, max: 32, step: 1, format: (v) => (v >= 30 ? 'Pill' : pixels(v)) })),
      field('Where it sits', segmented(() => (cfg.button.float ? cfg.button.side : 'inline'), (c, v) => {
        if (v === 'inline') c.button.float = false;
        else { c.button.float = true; c.button.side = v; }
      }, [['right', 'Bottom right'], ['left', 'Bottom left'], ['inline', 'In the page']], 'Position'),
      'Bottom corners float above the page; "In the page" puts it where you paste the code.'),
    ];
  }

  function recordControls() {
    return [
      field('Headline', textInput(() => cfg.record.headline, (c, v) => { c.record.headline = v; }, { max: 60 })),
      field('Instruction', textInput(() => cfg.record.instruction, (c, v) => { c.record.instruction = v; }, { max: 260, multiline: true })),
      field('Record button', textInput(() => cfg.record.recordLabel, (c, v) => { c.record.recordLabel = v; }, { max: 30 })),
      field('Small print under it', textInput(() => cfg.record.recordHint, (c, v) => { c.record.recordHint = v; }, { max: 60 })),
      toggle(() => cfg.record.promises, (c, v) => { c.record.promises = v; }, 'Show the two promises', '"Measured on your device" and "Frames deleted after reading", under the privacy note.'),
    ];
  }

  function resultsControls() {
    return [
      field('Small heading', textInput(() => cfg.results.kicker, (c, v) => { c.results.kicker = v; }, { max: 40 })),
      field('Title', textInput(() => cfg.results.title, (c, v) => { c.results.title = v; }, { max: 60 })),
      field('Label above the size', textInput(() => cfg.results.sizeLabel, (c, v) => { c.results.sizeLabel = v; }, { max: 30 }), 'The numbers shown here are samples; shoppers see their own.'),
    ];
  }

  function lookControls() {
    updateContrastNote();
    const presets = el('div', { class: 'pe-presets', role: 'group', 'aria-label': 'Starting points' },
      PRESETS.map((preset) => {
        const text = hex6(preset.theme.text);
        return el('button', {
          class: 'pe-preset', type: 'button', title: preset.name,
          style: `--bg:${preset.theme.background};--fg:${text};--ac:${preset.theme.accent}`,
          onclick: () => edit((c) => { Object.assign(c.theme, preset.theme); }, { rebuild: true }),
        }, el('span', { class: 'pe-preset-dot' }), el('span', { text: preset.name }));
      }));

    return [
      presets,
      field('Background', colourInput(() => cfg.theme.background, (c, v) => { c.theme.background = v; }, { label: 'Background' })),
      field('Text', colourInput(() => cfg.theme.text, (c, v) => { c.theme.text = v; }, { label: 'Text' })),
      contrastNote,
      field('Accent', colourInput(() => cfg.theme.accent, (c, v) => { c.theme.accent = v; }, { label: 'Accent' }), 'Icons, rules and highlights inside the popup.'),
      field('Typeface', selectInput(() => cfg.theme.font, (c, v) => { c.theme.font = v; }, Object.entries(FONTS).map(([key, f]) => [key, f.label]))),
      field('Corners', rangeInput(() => cfg.theme.radius, (c, v) => { c.theme.radius = v; }, { min: 0, max: 40, step: 1, format: pixels })),
      field('Text size', rangeInput(() => cfg.theme.scale, (c, v) => { c.theme.scale = v; }, { min: 0.85, max: 1.25, step: 0.05, format: percent })),
    ];
  }

  /* ---- match my website (the AI) ---- */
  function websiteControls() {
    const urlInput = el('input', { class: 'pe-input', type: 'url', placeholder: 'https://your-store.com', autocomplete: 'off' });
    const go = el('button', { class: 'btn btn--ghost btn--small', type: 'button', text: 'Match my site' });
    go.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) { toast('Enter your homepage address first.', 'error'); return; }
      go.disabled = true;
      go.textContent = 'Reading your site…';
      try {
        const found = await api('/api/website-analysis/analyze', { method: 'POST', body: { url } });
        if (!found) throw new Error('No answer came back.');
        edit((c) => fromAnalysis(c, found), { rebuild: true });
        toast('Colours and type taken from your site. Adjust anything you like.', 'ok');
      } catch (err) {
        toast(err.message || 'Could not read that site.', 'error');
      } finally {
        go.disabled = false;
        go.textContent = 'Match my site';
      }
    });
    return [
      field('Your homepage', urlInput, 'We read its colours and type and set the popup and button to suit. You can change anything afterwards.'),
      el('div', { class: 'pe-row' }, go),
    ];
  }

  function renderControls() {
    const scroll = side.scrollTop;
    const phaseBody = phase === 0 ? buttonControls() : phase === 1 ? recordControls() : resultsControls();
    const phaseReset = () => {
      edit((c) => {
        if (phase === 0) c.button = { ...DEFAULTS.button };
        if (phase === 1) c.record = { ...DEFAULTS.record };
        if (phase === 2) c.results = { ...DEFAULTS.results };
      }, { rebuild: true });
    };
    side.replaceChildren(
      el('p', { class: 'pe-phase-hint', text: PHASES[phase].hint }),
      section(phase === 0 ? 'The button' : phase === 1 ? 'The record screen' : 'The results screen', phaseBody, { onReset: phaseReset, resetLabel: 'Reset' }),
      section('Look of the popup', lookControls(), {
        onReset: () => edit((c) => { c.theme = { ...DEFAULTS.theme }; }, { rebuild: true }),
        resetLabel: 'Reset',
      }),
      section('Match my website', websiteControls(), { open: false }),
    );
    side.scrollTop = scroll;
  }

  /* ---- the preview frames ---- */
  function frameUrl(p) {
    const code = encodeURIComponent(chart.code);
    if (p === 0) return `${siteUrl}shop/`;
    return `${siteUrl}size/?g=${code}&embed=1&preview=${p === 1 ? 'record' : 'results'}`;
  }

  function showPhase(next) {
    phase = next;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.phase) === phase)));
    shopBox.hidden = phase !== 0;
    popupBox.hidden = phase === 0;
    stage.dataset.phase = String(phase);
    for (const [p, frame] of frames) frame.iframe.hidden = p !== phase;

    if (!frames.has(phase)) {
      const iframe = el('iframe', { class: 'pe-frame', title: `${PHASES[phase].label} preview`, loading: 'eager', src: frameUrl(phase) });
      frames.set(phase, { iframe, ready: false });
      (phase === 0 ? shopBox : popupBox).append(iframe);
    }
    renderControls();
    push();
  }

  // A frame says it is ready once its page has started; only then is it sent the draft.
  function onMessage(event) {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== '3dg-preview' || data.type !== 'ready') return;
    for (const frame of frames.values()) {
      if (frame.iframe.contentWindow === event.source) {
        frame.ready = true;
        if (frame === activeFrame()) push();
        else frame.iframe.contentWindow.postMessage({ source: '3dg-preview', type: 'config', config: cfg }, location.origin);
      }
    }
  }

  /* ---- save, close ---- */
  async function save() {
    if (busy || !isDirty()) return;
    busy = true;
    saveButton.textContent = 'Saving…';
    refreshChrome();
    try {
      const before = buttonAttributeString(JSON.parse(savedJson));
      await onSave(cfg);
      savedJson = JSON.stringify(cfg);
      const after = buttonAttributeString(cfg);
      toast(before !== after ? 'Saved. The button changed, so copy the updated popup code from the card.' : 'Popup saved.', 'ok');
    } catch (err) {
      toast(err.message || 'Could not save.', 'error');
    } finally {
      busy = false;
      saveButton.textContent = 'Save';
      refreshChrome();
    }
  }

  function close() {
    if (isDirty() && !window.confirm('Close without saving your changes?')) return;
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.body.style.overflow = '';
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  }

  /* ---- go ---- */
  for (const p of PHASES) {
    tabs.append(el('button', {
      class: 'pe-tab', type: 'button', role: 'tab', 'data-phase': p.id, text: `${p.id + 1}  ${p.label}`,
      onclick: () => showPhase(p.id),
    }));
  }
  saveButton.addEventListener('click', save);
  closeButton.addEventListener('click', close);
  window.addEventListener('message', onMessage);
  document.addEventListener('keydown', onKey, true);

  document.body.append(root);
  document.body.style.overflow = 'hidden';
  showPhase(1);
  closeButton.focus();
}
