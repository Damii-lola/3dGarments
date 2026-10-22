/**
 * The dashboard: the clothing a store sells, and the link each garment hands out.
 *
 * The whole loop lives on this page. A store types a garment's size chart in the
 * words it already prints — sizes named its way, in its own unit — saves it, and
 * gets two things: a link, and a snippet that opens the size finder in a popup on
 * its own product page. A shopper follows either one, records one slow turn, and
 * is told which size of THAT garment to buy, scored against the chart that was
 * typed here.
 *
 * The columns are the store's too. A chart is not always chest/waist/hips: a
 * shirt may print a shoulder and a sleeve, trousers a waist and an inseam, a coat
 * a body length. The form therefore holds a list of columns the store adds,
 * renames and removes, and the table under it grows and shrinks with them. Which
 * column decides the size is answered by order, not by a setting: the first
 * column this app can measure is the one the size is picked on, and a column with
 * no measurement behind it (a body length) is carried and shown, never scored.
 *
 * Signed out is not an error state: it is a state, with the way in beside it.
 * That is why this page does not bounce anyone to the account screen the way the
 * scanner does.
 */
import './nav.js';
import { MEASURES } from '@shared/measures.js';
import { getSession, isAccount, signOut } from './services/auth.js';
import { chartColumns, checkChartColumns, listCharts, notSetUp, removeChart, saveChart } from './services/charts.js';

const signInSection = document.getElementById('dash-anon');
const workSection = document.getElementById('dash-in');
const nameEl = document.getElementById('dash-name');
const mailEl = document.getElementById('dash-mail');
const outBtn = document.getElementById('dash-out');

const setupEl = document.getElementById('dash-setup');
const listSection = document.getElementById('dash-list-section');
const howSection = document.getElementById('dash-how');
const listEl = document.getElementById('dash-list');
const statsEl = document.getElementById('dash-stats');
const statGarments = document.getElementById('stat-garments');
const statSizes = document.getElementById('stat-sizes');
const statUpdated = document.getElementById('stat-updated');
const searchInput = document.getElementById('chart-search');
const sortSelect = document.getElementById('chart-sort');
const toastEl = document.getElementById('dash-toast');
const form = document.getElementById('chart-form');
const formTitle = document.getElementById('chart-form-title');
const nameInput = document.getElementById('chart-name');
const sexInput = document.getElementById('chart-sex');
const unitInput = document.getElementById('chart-unit');
const addColBtn = document.getElementById('chart-add-col');
const tableEl = document.getElementById('chart-table');
const headEl = document.getElementById('chart-head');
const rowsEl = document.getElementById('chart-rows');
const addBtn = document.getElementById('chart-add');
const saveBtn = document.getElementById('chart-save');
const cancelBtn = document.getElementById('chart-cancel');
const statusEl = document.getElementById('chart-status');

/** The site's own root, so a link or a snippet is right on any host or subpath. */
const SITE = new URL(import.meta.env.BASE_URL, window.location.origin).href;
const EMBED = new URL(`${import.meta.env.BASE_URL}embed.js`, window.location.origin).href;

/**
 * The popup script, loaded at runtime rather than with a tag in the page.
 *
 * It is the same file a store pastes onto its own product page, so previewing a
 * chart here runs the real popup and not an impression of it. Resolving on error
 * as well as on load keeps the promise a statement about "we are done waiting"
 * rather than a promise that something worked — the preview button checks for
 * ThreeDG itself and says so when it is not there.
 */
const embedReady = new Promise((resolve) => {
  if (window.ThreeDG) { resolve(); return; }
  const script = document.createElement('script');
  script.src = EMBED;
  script.addEventListener('load', resolve);
  script.addEventListener('error', resolve);
  document.head.append(script);
});

/** Bone-stock rows to start from. Empty on purpose: these are the store's numbers. */
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** A column's measurement, when this app can read it off a body. Null = printed only. */
const fieldOf = (column) => (MEASURES.some((m) => m.id === column.measure) ? column.measure : null);

/** The three columns a chart starts with: the torso, the waist, the seat. */
function defaultColumns(sex) {
  return [
    { id: 'col1', label: sex === 'female' ? 'Bust' : 'Chest', measure: 'chest' },
    { id: 'col2', label: 'Waist', measure: 'waist' },
    { id: 'col3', label: 'Hips', measure: 'hips' },
  ];
}

/** The columns on screen, in the order the store put them. */
let columns = defaultColumns('male');

/** Which chart the form is editing, or null when it is adding a new one. */
let editingId = null;
/** The charts on screen, by code, so a button can find its own row. */
let shown = [];
/** Search + sort state for the garment list. */
let searchQuery = '';
let sortBy = 'name';
/** Toast timer. */
let toastTimer = null;

function showToast(message, kind = '') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast${kind ? ' toast-' + kind : ''}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}
/* ---------- the chart editor ---------- */

function input(className, { value = '', placeholder = '', label, mode = 'decimal' } = {}) {
  const el = document.createElement('input');
  el.className = className;
  el.type = 'text';
  el.value = value;
  el.placeholder = placeholder;
  if (label) el.setAttribute('aria-label', label);
  if (mode) el.inputMode = mode;
  return el;
}

function deleteButton(what, onClick) {
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'chart-row-del';
  del.setAttribute('aria-label', what);
  del.textContent = '\u00d7';
  del.addEventListener('click', onClick);
  return del;
}

/**
 * The heading over the table, and the column editor itself.
 *
 * There is no second list of columns to keep in step: each column's name and
 * the measurement it stands for are controls sitting in its own header cell,
 * directly over the numbers they describe. Typing a name updates the column in
 * place, so the table moves as the store types; the header is rebuilt only when
 * a column is added, removed, repointed or the unit changes.
 */
function paintHead() {
  const unit = unitInput.value === 'cm' ? 'cm' : 'in';
  const cells = [];

  const sizeCell = document.createElement('span');
  sizeCell.className = 'chart-head-size';
  sizeCell.append(document.createTextNode('Size'));
  const unitEl = document.createElement('em');
  unitEl.textContent = unit;
  sizeCell.append(unitEl);
  cells.push(sizeCell);

  columns.forEach((column, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'col-head';
    wrap.dataset.col = column.id;

    const label = input('col-label', {
      value: column.label,
      placeholder: column.measure ? 'Chest' : 'Body length',
      label: `Column ${index + 1} name`,
      mode: null,
    });
    label.maxLength = 24;
    label.addEventListener('input', () => {
      column.label = label.value;
      // Number cells already carry the column's name for a screen reader; keep
      // that name in step without rebuilding the header under the cursor.
      for (const cell of rowsEl.querySelectorAll('.chart-num')) {
        if (cell.dataset.col === column.id) {
          cell.setAttribute('aria-label', `${label.value.trim() || 'Column'} for this size`);
        }
      }
    });

    const measure = document.createElement('select');
    measure.className = 'col-measure';
    measure.setAttribute('aria-label', `What column ${index + 1} measures`);
    for (const m of MEASURES) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      measure.append(opt);
    }
    const other = document.createElement('option');
    other.value = '';
    other.textContent = 'Other \u2014 shown only';
    measure.append(other);
    measure.value = fieldOf(column) || '';
    measure.addEventListener('change', () => {
      column.measure = measure.value;
      // A column the store has not named takes the name of what it measures, so
      // a fresh column is not left headless. A name the store typed is theirs.
      if (!label.value.trim()) {
        label.value = MEASURES.find((m) => m.id === measure.value)?.label || 'Measurement';
        column.label = label.value;
      }
    });

    const bottom = document.createElement('div');
    bottom.className = 'col-head-bottom';
    const del = deleteButton('Remove this column', () => removeColumn(column));
    del.classList.add('col-del');
    bottom.append(measure, del);

    wrap.append(label, bottom);
    cells.push(wrap);
  });

  // The last cell lines up with each row's remove button.
  cells.push(document.createElement('span'));
  headEl.replaceChildren(...cells);
  // The table has as many number columns as the store added; the grid follows.
  tableEl.style.setProperty('--cols', String(Math.max(1, columns.length)));
}

/** The numbers on screen right now, keyed by column, so a rebuild keeps them. */
function snapshot() {
  return [...rowsEl.children].map((row) => {
    const values = {};
    for (const cell of row.querySelectorAll('.chart-num')) values[cell.dataset.col] = cell.value;
    return { key: row.querySelector('.chart-key').value, values };
  });
}

/** One row of the chart: the store's size name, then one number per column. */
function addRow({ key = '', values = {} } = {}) {
  const row = document.createElement('div');
  row.className = 'chart-row';
  row.append(input('chart-key', { value: key, placeholder: 'M', label: 'Size name', mode: null }));
  for (const column of columns) {
    const cell = input('chart-num', {
      value: values[column.id] === 0 || values[column.id] ? String(values[column.id]) : '',
      placeholder: '\u2014',
      label: `${column.label.trim() || 'Column'} for this size`,
    });
    cell.dataset.col = column.id;
    row.append(cell);
  }
  row.append(deleteButton('Remove this size', () => {
    row.remove();
    if (!rowsEl.children.length) addRow();
  }));
  rowsEl.append(row);
  return row;
}

function rebuildRows(rows) {
  rowsEl.replaceChildren();
  for (const row of rows) addRow(row);
  if (!rowsEl.children.length) addRow();
}

/**
 * A column can be added, renamed, repointed or removed, and the table follows.
 * Adding one is the point of the editor: a chart that prints a shoulder should be
 * scored on the shoulder, and a chart that also prints a body length should show
 * that length to the shopper without pretending it can read it off a body.
 */
function addColumn() {
  const rows = snapshot();
  let n = columns.length + 1;
  while (columns.some((c) => c.id === `col${n}`)) n += 1;
  const column = { id: `col${n}`, label: '', measure: '' };
  columns = [...columns, column];
  paintHead();
  rebuildRows(rows);
  headEl.querySelector(`.col-head[data-col="${column.id}"] .col-label`)?.focus();
}

function removeColumn(column) {
  if (columns.length === 1) {
    setStatus('A chart needs one column at least \u2014 edit it rather than removing it.', 'error');
    return;
  }
  const rows = snapshot();
  columns = columns.filter((c) => c !== column);
  paintHead();
  rebuildRows(rows);
}

/** What is in the form, as columns and rows to save, or the reasons it cannot be. */
function readForm() {
  const unit = unitInput.value === 'cm' ? 'cm' : 'in';
  const lo = unit === 'cm' ? 13 : 5;
  const hi = unit === 'cm' ? 305 : 120;
  const problems = [];
  // A column with no name is not a column a shopper can understand, and two
  // columns wearing one name are worse than one: say so before the AI check
  // spends a token on them.
  if (columns.some((c) => !c.label.trim())) {
    problems.push('Every column needs a name \u2014 it is what your shopper is shown.');
  }
  const names = columns.map((c) => c.label.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) {
    problems.push('Two columns have the same name \u2014 give each one its own.');
  }
  const rows = [];
  for (const rowEl of rowsEl.children) {
    const key = rowEl.querySelector('.chart-key').value.trim();
    const cells = [...rowEl.querySelectorAll('.chart-num')];
    // A row nobody has typed in is not an error: an empty line at the bottom of a
    // chart is how a chart gets longer.
    if (!key && cells.every((c) => !c.value.trim())) continue;
    if (!key) { problems.push('Every row needs a size name.'); continue; }
    if (rows.some((r) => r.key === key)) { problems.push(`"${key}" is in the chart twice.`); continue; }
    const entry = { key };
    for (const cell of cells) {
      const raw = cell.value.trim();
      if (raw === '') continue;
      const value = Number(raw);
      const column = columns.find((c) => c.id === cell.dataset.col);
      if (!Number.isFinite(value) || value < lo || value > hi) {
        problems.push(`${key}: "${raw}" is not a measurement${column?.label ? ` for ${column.label}` : ''} in ${unit === 'cm' ? 'centimetres' : 'inches'}.`);
        continue;
      }
      entry[cell.dataset.col] = value;
    }
    rows.push(entry);
  }

  // The first column this app can measure is the one a size is decided on, so a
  // chart without one, or a size missing its number, cannot answer anybody.
  const anchor = columns.find((c) => fieldOf(c));
  if (!anchor) {
    problems.push('Add a column this app can measure \u2014 it is the one a size is decided on.');
  } else if (rows.length) {
    const name = anchor.label.trim() || 'number';
    const missing = rows.filter((r) => !Number.isFinite(r[anchor.id])).map((r) => r.key);
    if (missing.length) {
      // Reported together, once: the fix is the same for all of them, and a shop
      // with five half-typed rows should not have to press Save five times.
      problems.push(missing.length === 1
        ? `${missing[0]} needs a ${name} \u2014 it is the one measurement a size is decided on.`
        : `${missing.join(', ')} need a ${name} \u2014 it is the one measurement a size is decided on.`);
    }
    // A column with a blank cell would be scored on nobody (a blank must not
    // favour the row it is missing from), so say so here rather than leave the
    // store wondering why the column never moved the answer.
    for (const c of columns) {
      if (c === anchor) continue;
      const have = rows.filter((r) => Number.isFinite(r[c.id])).length;
      if (have && have < rows.length) {
        problems.push(`${c.label.trim() || 'One column'} is filled for ${have} of ${rows.length} sizes \u2014 fill it for every size, or remove the column.`);
      }
    }
  }

  return {
    rows,
    problems,
    columns: columns.map((c) => ({
      id: c.id,
      label: (c.label.trim() || 'Column').slice(0, 24),
      measure: fieldOf(c),
    })),
  };
}

function setStatus(message, kind = '') {
  statusEl.textContent = message || '';
  statusEl.className = 'chart-status' + (kind ? ' ' + kind : '');
}

function setBusy(busy) {
  saveBtn.disabled = busy;
  saveBtn.textContent = busy ? 'Saving…' : editingId ? 'Save changes' : 'Save and get the link';
}

/** Back to a blank chart, and out of editing. */
function resetForm() {
  editingId = null;
  formTitle.textContent = 'Add a garment';
  nameInput.value = '';
  sexInput.value = 'male';
  unitInput.value = 'in';
  columns = defaultColumns('male');
  paintHead();
  rowsEl.replaceChildren();
  DEFAULT_SIZES.forEach((key) => addRow({ key }));
  cancelBtn.hidden = true;
  setBusy(false);
  setStatus('');
}

/**
 * The columns a saved chart was typed under. A chart saved before columns had
 * names is read from the keys its rows carry, so an older chart still opens with
 * every number in the right place.
 */
function columnsFromSaved(chart) {
  const saved = Array.isArray(chart.columns) ? chart.columns.filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string') : [];
  if (saved.length) {
    return saved.map((c) => ({
      id: c.id,
      label: c.label,
      measure: c.measure === 'bust' ? 'chest' : MEASURES.some((m) => m.id === c.measure) ? c.measure : '',
    }));
  }
  const order = ['chest', 'bust', 'waist', 'hips', 'height'];
  const keys = [];
  for (const row of Array.isArray(chart.rows) ? chart.rows : []) {
    for (const key of Object.keys(row || {})) if (key !== 'key' && !keys.includes(key)) keys.push(key);
  }
  keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return keys.length ? keys.map((key) => ({
    id: key,
    label: key === 'chest' ? (chart.sex === 'female' ? 'Bust' : 'Chest') : key.charAt(0).toUpperCase() + key.slice(1),
    measure: key === 'bust' ? 'chest' : MEASURES.some((m) => m.id === key) ? key : '',
  })) : defaultColumns(chart.sex);
}

/** Put an existing chart into the form. */
function startEdit(chart) {
  editingId = chart.id;
  formTitle.textContent = `Editing ${chart.name}`;
  nameInput.value = chart.name;
  sexInput.value = chart.sex;
  unitInput.value = chart.unit === 'cm' ? 'cm' : 'in';
  columns = columnsFromSaved(chart);
  paintHead();
  rowsEl.replaceChildren();
  for (const row of Array.isArray(chart.rows) ? chart.rows : []) {
    const values = {};
    for (const c of columns) values[c.id] = row?.[c.id];
    addRow({ key: String(row?.key ?? ''), values });
  }
  if (!rowsEl.children.length) addRow();
  cancelBtn.hidden = false;
  setStatus('');
  saveBtn.textContent = 'Save changes';
  workSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
  nameInput.focus();
}

/* ---------- the list of charts ---------- */

const copyText = async (text, what) => {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${what} copied.`, 'ok');
    showToast(`${what} copied to clipboard`, 'ok');
  } catch {
    // A browser that refuses the clipboard still lets a person select the text
    // that is already on screen, so say that rather than failing silently.
    setStatus(`Your browser would not copy for you — select the ${what.toLowerCase()} in the box and copy it.`, 'error');
    showToast('Could not copy — select and copy manually', 'error');
  }
};

function who(sex) {
  return sex === 'female' ? 'Women' : sex === 'male' ? 'Men' : 'Anyone';
}

/** True when every row carries a real number for this column. */
function carriedEverywhere(chart, id) {
  const rows = Array.isArray(chart.rows) ? chart.rows : [];
  return rows.length > 0 && rows.every((r) => Number.isFinite(Number(r?.[id])) && String(r?.[id] ?? '') !== '');
}

/** One garment: its link, its snippet, and the few things you can do with them. */
function card(chart) {
  const article = document.createElement('article');
  article.className = 'chart-card';
  article.dataset.code = chart.code;

  const head = document.createElement('header');
  head.className = 'chart-card-head';
  const title = document.createElement('h3');
  title.textContent = chart.name;
  const meta = document.createElement('p');
  meta.className = 'chart-meta';
  const scored = chartColumns(chart).map((c) => c.label);
  const printed = (Array.isArray(chart.columns) ? chart.columns : [])
    .filter((c) => c && c.label && !c.measure && carriedEverywhere(chart, c.id))
    .map((c) => c.label);
  const count = Array.isArray(chart.rows) ? chart.rows.length : 0;
  meta.textContent = [
    who(chart.sex),
    `${count} size${count === 1 ? '' : 's'}`,
    chart.unit === 'cm' ? 'centimetres' : 'inches',
    scored.length ? `scored on ${scored.join(', ')}` : 'no column this app can measure',
    printed.length ? `also shows ${printed.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  head.append(title, meta);

  const linkField = document.createElement('label');
  linkField.className = 'chart-field';
  const linkLabel = document.createElement('span');
  linkLabel.textContent = 'The link';
  const linkInput = document.createElement('input');
  linkInput.className = 'chart-code';
  linkInput.readOnly = true;
  linkInput.value = `${SITE}size/?g=${chart.code}`;
  linkInput.addEventListener('focus', () => linkInput.select());
  linkField.append(linkLabel, linkInput);

  const snippet = document.createElement('details');
  snippet.className = 'chart-snippet';
  const summary = document.createElement('summary');
  summary.textContent = 'Popup code for your product page';
  const snippetText = `<script src="${EMBED}" data-chart="${chart.code}" data-name="${chart.name.replace(/"/g, '&quot;')}" data-label="Find my size"></script>`;
  const snippetBox = document.createElement('textarea');
  snippetBox.className = 'chart-snippet-box';
  snippetBox.readOnly = true;
  snippetBox.rows = 3;
  snippetBox.value = snippetText;
  snippetBox.addEventListener('focus', () => snippetBox.select());
  const snippetNote = document.createElement('p');
  snippetNote.className = 'chart-hint';
  snippetNote.textContent = 'That one line is the whole integration. Paste it anywhere on the product page — head or body, it works in both — and a "Find my size" button opens the size finder in a popup over your page. Nothing else on your site is touched. Want the button in a corner instead? Add data-float="1" to the tag.';
  snippet.append(summary, snippetBox, snippetNote);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const buttons = [
    ['preview', 'Preview the popup', 'btn-primary'],
    ['copy-embed', 'Copy the popup code', 'btn-ghost'],
    ['copy-link', 'Copy the link', 'btn-ghost'],
    ['edit', 'Edit this chart', 'btn-ghost'],
    ['delete', 'Delete', 'btn-ghost chart-del'],
  ];
  for (const [act, label, className] of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.act = act;
    button.textContent = label;
    actions.append(button);
  }

  article.append(head, linkField, snippet, actions);
  return article;
}

function listMessage(text) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  const p = document.createElement('p');
  p.textContent = text;
  tile.append(p);
  return tile;
}

function filterAndSort(charts) {
  const q = searchQuery.trim().toLowerCase();
  let out = q
    ? charts.filter((c) => String(c.name || '').toLowerCase().includes(q) || String(c.sex || '').toLowerCase().includes(q))
    : charts.slice();
  if (sortBy === 'name') out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  else if (sortBy === 'newest') out.sort((a, b) => (b.id || 0) - (a.id || 0));
  else if (sortBy === 'sizes') out.sort((a, b) => (Array.isArray(b.rows) ? b.rows.length : 0) - (Array.isArray(a.rows) ? a.rows.length : 0));
  return out;
}

function renderList(charts) {
  shown = charts;
  listEl.replaceChildren();
  const visible = filterAndSort(charts);
  if (!charts.length) {
    listEl.append(listMessage('No clothing yet. Add a garment above and it will appear here with its link.'));
    return;
  }
  if (!visible.length) {
    listEl.append(listMessage(`No garments match "${searchQuery}".`));
    return;
  }
  for (const chart of visible) listEl.append(card(chart));
}

function updateStats(charts) {
  if (!statsEl) return;
  if (!charts.length) { statsEl.hidden = true; return; }
  statsEl.hidden = false;
  statGarments.textContent = charts.length;
  statSizes.textContent = charts.reduce((n, c) => n + (Array.isArray(c.rows) ? c.rows.length : 0), 0);
  const latest = charts.reduce((acc, c) => {
    const t = c.updated_at || c.created_at;
    return t && (!acc || String(t) > String(acc)) ? t : acc;
  }, null);
  statUpdated.textContent = latest ? new Date(latest).toLocaleDateString() : '—';
}

async function refresh() {
  try {
    const charts = await listCharts();
    updateStats(charts);
    renderList(charts);
  } catch (err) {
    if (notSetUp(err)) {
      setupEl.hidden = false;
      updateStats([]);
      renderList([]);
      listEl.replaceChildren(listMessage('Your charts will be listed here once the size-chart table is in your project — see the note above.'));
      return;
    }
    updateStats([]);
    renderList([]);
    listEl.replaceChildren(listMessage(`Could not load your clothing: ${err.message}`));
  }
}

/* ---------- the wiring ---------- */

cancelBtn.addEventListener('click', resetForm);
addBtn.addEventListener('click', () => {
  const row = addRow();
  row.querySelector('input').focus();
});
addColBtn.addEventListener('click', addColumn);
unitInput.addEventListener('change', paintHead);
sexInput.addEventListener('change', () => {
  // The torso column is the same tape whoever the garment is for; only the word
  // over it changes, and only when the store has not chosen a word of its own.
  const want = sexInput.value === 'female' ? 'Bust' : 'Chest';
  const other = want === 'Bust' ? 'Chest' : 'Bust';
  let changed = false;
  for (const c of columns) {
    if (fieldOf(c) === 'chest' && (!c.label || c.label === other)) {
      c.label = want;
      changed = true;
    }
  }
  if (changed) paintHead();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saveBtn.disabled) return;

  const name = nameInput.value.trim();
  if (!name) {
    setStatus('Give the garment a name — it is what your shopper is shown.', 'error');
    nameInput.focus();
    return;
  }
  const { rows, columns: savedColumns, problems } = readForm();
  // A row problem first, then the empty form: "XS needs a chest" says what to do,
  // where "type at least one size row" would be a lie about a form that is full
  // of rows and waiting for one number.
  if (problems.length) {
    setStatus(problems[0], 'error');
    return;
  }
  if (!rows.length) {
    setStatus('Type at least one size row.', 'error');
    return;
  }

  setBusy(true);
  setStatus('Checking the column names…');
  try {
    // A shopper has to understand every column, so the names get one last look
    // before anything is written. The check is tiny — the labels, not the chart
    // — and `skipped` means it could not run, which must never block a save.
    const verdict = await checkChartColumns(savedColumns.map((c) => c.label));
    if (!verdict.ok) {
      setStatus(verdict.problem, 'error');
      return;
    }
    setStatus('Saving…');
    const saved = await saveChart({
      id: editingId,
      name,
      sex: sexInput.value,
      unit: unitInput.value,
      columns: savedColumns,
      rows,
    });
    const wasEditing = Boolean(editingId);
    resetForm();
    await refresh();
    setStatus(wasEditing
      ? 'Saved. The link is unchanged — it is below.'
      : `Saved. Your link is ready below: it ends in ${saved.code}.`, 'ok');
    showToast(wasEditing ? 'Chart updated' : 'Garment saved', 'ok');
  } catch (err) {
    if (notSetUp(err)) {
      setupEl.hidden = false;
      setStatus('That needs the size-chart table, which this project does not have yet — see the note above.', 'error');
    } else {
      setStatus(err.message || 'Could not save that.', 'error');
    }
  } finally {
    setBusy(false);
  }
});

/** Everything a card can be asked to do. */
listEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const article = button.closest('.chart-card');
  const chart = shown.find((c) => c.code === article?.dataset.code);
  if (!chart) return;
  const link = `${SITE}size/?g=${chart.code}`;

  switch (button.dataset.act) {
    case 'preview': {
      button.disabled = true;
      await embedReady;
      button.disabled = false;
      if (!window.ThreeDG) {
        setStatus('The popup script did not load, so it cannot be previewed here — open the link instead.', 'error');
        return;
      }
      window.ThreeDG.open({ code: chart.code, name: chart.name });
      break;
    }
    case 'copy-embed':
      await copyText(article.querySelector('.chart-snippet-box').value, 'Popup code');
      break;
    case 'copy-link':
      await copyText(link, 'Link');
      break;
    case 'edit':
      startEdit(chart);
      break;
    case 'delete': {
      if (!window.confirm(`Delete ${chart.name}? Any product page using its link stops working.`)) return;
      button.disabled = true;
      try {
        await removeChart(chart.id);
        await refresh();
        if (editingId === chart.id) resetForm();
        setStatus(`${chart.name} deleted.`, 'ok');
        showToast(`${chart.name} deleted`, 'ok');
      } catch (err) {
        button.disabled = false;
        setStatus(err.message || 'Could not delete that.', 'error');
      }
      break;
    }
    default:
      break;
  }
});

/* ---------- search, sort, toast ---------- */
searchInput?.addEventListener('input', () => {
  searchQuery = searchInput.value;
  // Re-render from the last loaded set without refetching.
  renderList(shown);
});
sortSelect?.addEventListener('change', () => {
  sortBy = sortSelect.value;
  renderList(shown);
});

/* ---------- who is signed in ---------- */

function paint(session) {
  const account = isAccount(session);
  signInSection.hidden = account;
  workSection.hidden = !account;
  listSection.hidden = !account;
  howSection.hidden = !account;
  if (!account) return;

  if (nameEl) nameEl.textContent = session.user.user_metadata?.username || 'Your account';
  if (mailEl) mailEl.textContent = session.user.email || '';
  refresh();
}

getSession().then(paint).catch(() => paint(null));

outBtn?.addEventListener('click', async () => {
  outBtn.disabled = true;
  outBtn.textContent = 'Logging out…';
  try {
    await signOut();
  } catch {
    // Either way the session is dropped locally, which is what this page is
    // about: reload, and it paints the signed-out state.
  }
  location.reload();
});

resetForm();
