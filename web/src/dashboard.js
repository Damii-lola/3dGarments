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
 * Signed out is not an error state: it is a state, with the way in beside it.
 * That is why this page does not bounce anyone to the account screen the way the
 * scanner does.
 */
import './nav.js';
import { getSession, isAccount, signOut } from './services/auth.js';
import { chartColumns, listCharts, notSetUp, removeChart, saveChart } from './services/charts.js';

const signInSection = document.getElementById('dash-anon');
const workSection = document.getElementById('dash-in');
const nameEl = document.getElementById('dash-name');
const mailEl = document.getElementById('dash-mail');
const outBtn = document.getElementById('dash-out');

const setupEl = document.getElementById('dash-setup');
const listSection = document.getElementById('dash-list-section');
const howSection = document.getElementById('dash-how');
const listEl = document.getElementById('dash-list');

const form = document.getElementById('chart-form');
const formTitle = document.getElementById('chart-form-title');
const nameInput = document.getElementById('chart-name');
const sexInput = document.getElementById('chart-sex');
const unitInput = document.getElementById('chart-unit');
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

/**
 * The three girth columns this form offers, and what each is called for a
 * garment made for a woman. The first one is the column a size is decided on
 * (the server's rule, and the reason a chart with no chest/bust sizes nobody).
 */
const COLUMNS = {
  male: ['Chest', 'Waist', 'Hips'],
  female: ['Bust', 'Waist', 'Hips'],
  unisex: ['Chest', 'Waist', 'Hips'],
};
/** Bone-stock rows to start from. Empty on purpose: these are the store's numbers. */
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** The key the first number column is saved under, from who the garment is for. */
const primaryKey = () => (sexInput.value === 'female' ? 'bust' : 'chest');

/** Which chart the form is editing, or null when it is adding a new one. */
let editingId = null;
/** The charts on screen, by code, so a button can find its own row. */
let shown = [];

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

/** The column headings, which follow the two selects. */
function paintHead() {
  const unit = unitInput.value === 'cm' ? 'cm' : 'in';
  const names = COLUMNS[sexInput.value] || COLUMNS.unisex;
  const labels = ['Size', `${names[0]} (${unit})`, `${names[1]} (${unit})`, `${names[2]} (${unit})`, ''];
  headEl.replaceChildren(...labels.map((label) => {
    const cell = document.createElement('span');
    cell.textContent = label;
    return cell;
  }));
}

/** One row of the chart: the store's size name, then the three girths. */
function addRow({ key = '', girths = ['', '', ''] } = {}) {
  const row = document.createElement('div');
  row.className = 'chart-row';
  row.append(input('chart-key', { value: key, placeholder: 'M', label: 'Size name', mode: null }));
  const names = COLUMNS[sexInput.value] || COLUMNS.unisex;
  girths.forEach((value, i) => {
    row.append(input('chart-num', { value: value === 0 || value ? String(value) : '', placeholder: '—', label: `${names[i]} for this size` }));
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'chart-row-del';
  del.setAttribute('aria-label', 'Remove this size');
  del.textContent = '\u00d7';
  del.addEventListener('click', () => {
    row.remove();
    if (!rowsEl.children.length) addRow();
  });
  row.append(del);
  rowsEl.append(row);
  return row;
}

/**
 * What is in the form, as rows to save. Rows left entirely blank are ignored —
 * an empty row at the bottom of a chart is not an error — but a row with a name
 * and no chest/bust is, because that is the column a size is decided on and a
 * number nobody typed must not be invented to fill it.
 */
function readRows() {
  const primary = primaryKey();
  const rows = [];
  const problems = [];
  // Rows with a name but no chest/bust. Reported together, once, rather than one
  // at a time: the fix is the same for all of them, and a shop with five
  // half-typed rows should not have to press Save five times to hear about it.
  const missing = [];
  for (const row of rowsEl.children) {
    const fields = [...row.querySelectorAll('input')];
    const key = fields[0].value.trim();
    const text = fields.slice(1).map((f) => f.value.trim());
    if (!key && text.every((v) => !v)) continue;
    if (!key) { problems.push('Every row needs a size name.'); continue; }
    if (rows.some((r) => r.key === key) || missing.includes(key)) { problems.push(`"${key}" is in the chart twice.`); continue; }
    const entry = { key };
    const keys = [primary, 'waist', 'hips'];
    text.forEach((raw, i) => {
      if (raw === '') return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) { problems.push(`${key}: "${raw}" is not a measurement.`); return; }
      entry[keys[i]] = value;
    });
    if (!Number.isFinite(entry[primary])) { missing.push(key); continue; }
    rows.push(entry);
  }
  if (missing.length) {
    problems.push(missing.length === 1
      ? `${missing[0]} needs a ${primary} \u2014 it is the one measurement a size is decided on.`
      : `${missing.join(', ')} need a ${primary} \u2014 it is the one measurement a size is decided on.`);
  }
  return { rows, problems };
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
  rowsEl.replaceChildren();
  DEFAULT_SIZES.forEach((key) => addRow({ key }));
  paintHead();
  cancelBtn.hidden = true;
  setBusy(false);
  setStatus('');
}

/** Put an existing chart into the form. */
function startEdit(chart) {
  editingId = chart.id;
  formTitle.textContent = `Editing ${chart.name}`;
  nameInput.value = chart.name;
  sexInput.value = chart.sex;
  unitInput.value = chart.unit === 'cm' ? 'cm' : 'in';
  rowsEl.replaceChildren();
  const primary = chart.sex === 'female' ? 'bust' : 'chest';
  const rows = Array.isArray(chart.rows) ? chart.rows : [];
  for (const row of rows) {
    addRow({ key: String(row?.key ?? ''), girths: [row?.[primary], row?.waist, row?.hips] });
  }
  if (!rowsEl.children.length) addRow();
  paintHead();
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
  } catch {
    // A browser that refuses the clipboard still lets a person select the text
    // that is already on screen, so say that rather than failing silently.
    setStatus(`Your browser would not copy for you — select the ${what.toLowerCase()} in the box and copy it.`, 'error');
  }
};

function who(sex) {
  return sex === 'female' ? 'Women' : sex === 'male' ? 'Men' : 'Anyone';
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
  const cols = chartColumns(chart);
  const count = Array.isArray(chart.rows) ? chart.rows.length : 0;
  meta.textContent = [
    who(chart.sex),
    `${count} size${count === 1 ? '' : 's'}`,
    chart.unit === 'cm' ? 'centimetres' : 'inches',
    cols.length ? `scored on ${cols.join(', ')}` : 'no girth column yet',
  ].join(' · ');
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
  snippetNote.textContent = 'Paste this once onto the product page. It adds a "Find my size" button that opens the size finder in a popup over your page — nothing else on your site is touched.';
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

function renderList(charts) {
  shown = charts;
  listEl.replaceChildren();
  if (!charts.length) {
    listEl.append(listMessage('No clothing yet. Add a garment above and it will appear here with its link.'));
    return;
  }
  for (const chart of charts) listEl.append(card(chart));
}

async function refresh() {
  try {
    renderList(await listCharts());
  } catch (err) {
    if (notSetUp(err)) {
      setupEl.hidden = false;
      renderList([]);
      listEl.replaceChildren(listMessage('Your charts will be listed here once the size-chart table is in your project — see the note above.'));
      return;
    }
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
sexInput.addEventListener('change', () => {
  // The first number column changes name (chest / bust) but not meaning: it is
  // still the girth the size is decided on, so the numbers stay where they are.
  paintHead();
});
unitInput.addEventListener('change', paintHead);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saveBtn.disabled) return;

  const name = nameInput.value.trim();
  if (!name) {
    setStatus('Give the garment a name — it is what your shopper is shown.', 'error');
    nameInput.focus();
    return;
  }
  const { rows, problems } = readRows();
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
  setStatus('Saving…');
  try {
    const saved = await saveChart({ id: editingId, name, sex: sexInput.value, unit: unitInput.value, rows });
    const wasEditing = Boolean(editingId);
    resetForm();
    await refresh();
    setStatus(wasEditing
      ? 'Saved. The link is unchanged — it is below.'
      : `Saved. Your link is ready below: it ends in ${saved.code}.`, 'ok');
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

/* ---------- who is signed in ---------- */

function paint(session) {
  const account = isAccount(session);
  signInSection.hidden = account;
  workSection.hidden = !account;
  listSection.hidden = !account;
  howSection.hidden = !account;
  if (!account) return;

  nameEl.textContent = session.user.user_metadata?.username || 'Your account';
  mailEl.textContent = session.user.email || '';
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
