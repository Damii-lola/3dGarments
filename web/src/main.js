/* =========================================================
   3dGarments — Find your size
   1. Tap the camera icon -> the phone's NATIVE camera app records a video.
   2. We grab key frames from that video.
   3. The AI focuses on the person, guesses gender, gauges how thick the
      clothing is, then estimates body measurements and size — subtracting
      the width the clothing adds.
   ========================================================= */

import { extractFrames } from './body-scan/frames.js';
import { analyzeBody } from './body-scan/analyze.js';

const MAX_SECONDS = 30;

const openCamera = document.querySelector('.open-camera');
const input = document.getElementById('video-input');
const result = document.getElementById('result');
const preview = document.getElementById('preview');
const resultText = document.getElementById('result-text');
const analyzeBtn = document.getElementById('analyze-btn');
const retakeBtn = document.getElementById('retake-btn');
const analysis = document.getElementById('analysis');
const sizeValue = document.getElementById('size-value');
const sizeSub = document.getElementById('size-sub');
const factsEl = document.getElementById('facts');
const measureGrid = document.getElementById('measure-grid');
const measuresNote = document.getElementById('measures-note');
const notesEl = document.getElementById('analysis-notes');
const againBtn = document.getElementById('again-btn');
const statusEl = document.getElementById('status');

/** The recorded video, held in memory while the user is on the page. */
let recordedBlob = null;
let previewUrl = null;
let analyzing = false;

/* ---------- small helpers ---------- */
function setStatus(message, kind = '') {
  statusEl.textContent = message || '';
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const fmtIn = (v) => (v == null ? '—' : `${v}"`);

/* ---------- state changes ---------- */
function showResult() {
  openCamera.hidden = true;
  analysis.hidden = true;
  result.hidden = false;
  analyzeBtn.disabled = false;
}

function resetToCamera() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  preview.removeAttribute('src');
  preview.load();
  recordedBlob = null;
  input.value = '';
  result.hidden = true;
  analysis.hidden = true;
  openCamera.hidden = false;
  analyzeBtn.disabled = false;
  setStatus('');
}

/* ---------- duration check ---------- */
function readDuration(blob) {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    const url = URL.createObjectURL(blob);
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.onloadedmetadata = () => {
      const d = probe.duration;
      done(Number.isFinite(d) ? d : null);
    };
    probe.onerror = () => done(null);
    probe.src = url;
  });
}

/* ---------- after recording ---------- */
async function handleRecording(file) {
  recordedBlob = file;
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;

  const kb = Math.max(1, Math.round(file.size / 1024));
  resultText.textContent = 'Video captured · ' + (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB');

  showResult();
  setStatus('Loading video…');

  const seconds = await readDuration(file);
  if (seconds == null) {
    setStatus('Video captured and held in memory.', 'ok');
  } else if (seconds > MAX_SECONDS + 1) {
    setStatus(`That clip is ${Math.round(seconds)}s — over the 30s limit. A shorter clip gives a steadier read.`, 'error');
  } else {
    setStatus('Looks good — tap "Analyze my size".', 'ok');
  }
}

/* ---------- the analysis ---------- */
function renderFacts(data) {
  factsEl.replaceChildren();
  const g = data.gender || {};

  const genderText =
    g.guess === 'male' ? 'Male' :
    g.guess === 'female' ? 'Female' :
    'Not sure';
  const genderConf = g.confidence != null ? ` (${Math.round(g.confidence * 100)}% sure)` : '';
  factsEl.append(fact('Detected', genderText + genderConf));

  const c = data.clothing || {};
  if (c.items?.length || c.density || c.fit) {
    const parts = [];
    if (c.items?.length) parts.push(c.items.join(', '));
    if (c.density) parts.push(`${c.density} density`);
    if (c.fit) parts.push(`${c.fit} fit`);
    factsEl.append(fact('Clothing', parts.join(' · ')));
  }

  if (data.proportions?.build) factsEl.append(fact('Build', data.proportions.build));

  const removed = data.adjusted?.bodyWidthRemovedIn;
  if (removed) factsEl.append(fact('Clothing width removed', `${fmtIn(removed)} around the body`));
}

function fact(label, value) {
  const row = el('li', 'fact');
  row.append(el('span', 'fact-label', label), el('span', 'fact-value', value));
  return row;
}

function renderMeasures(data) {
  measureGrid.replaceChildren();
  const m = data.adjusted || {};
  const female = data.sizeBasis === 'female';
  const chestLabel = female ? 'Bust' : data.sizeBasis === 'male' ? 'Chest' : 'Chest / bust';

  const items = [
    [chestLabel, fmtIn(m.chest)],
    ['Waist', fmtIn(m.waist)],
    ['Hips', fmtIn(m.hips)],
    ['Shoulder', fmtIn(m.shoulder)],
    ['Height', fmtIn(m.height)],
  ];
  for (const [label, value] of items) {
    const cell = el('div', 'measure');
    cell.append(el('span', 'measure-label', label), el('span', 'measure-value', value));
    measureGrid.append(cell);
  }

  const seenChest = data.measurements?.chest;
  const removed = m.bodyWidthRemovedIn;
  if (seenChest != null && removed) {
    measuresNote.textContent = `Measured about ${seenChest}" over the clothing, then adjusted down by ${removed}" to estimate the body itself.`;
  } else {
    measuresNote.textContent = 'Estimates from the video — treat them as a guide, not a tape measure.';
  }
}

function renderNotes(data) {
  notesEl.replaceChildren();
  for (const note of data.notes || []) {
    notesEl.append(el('li', 'note', note));
  }
}

function renderAnalysis(data) {
  sizeValue.textContent = data.size || '—';
  const basis = data.sizeBasis === 'female' ? "women's" : data.sizeBasis === 'male' ? "men's" : '';
  sizeSub.textContent = basis ? `${basis} sizing` : '';

  renderFacts(data);
  renderMeasures(data);
  renderNotes(data);

  result.hidden = true;
  analysis.hidden = false;
}

async function runAnalysis() {
  if (analyzing || !recordedBlob) return;
  analyzing = true;
  analyzeBtn.disabled = true;

  try {
    setStatus('Grabbing key frames from your video…');
    const frames = await extractFrames(recordedBlob, { count: 6 });

    setStatus(`Analyzing ${frames.length} frames — this can take up to 30s…`);
    const data = await analyzeBody(frames);

    renderAnalysis(data);
    setStatus('');
  } catch (e) {
    setStatus(e.message || 'Something went wrong during analysis.', 'error');
    analyzeBtn.disabled = false;
  } finally {
    analyzing = false;
  }
}

/* ---------- wiring ---------- */
input.addEventListener('change', () => {
  const file = input.files && input.files[0];
  if (!file) {
    setStatus('No video recorded.', 'error');
    return;
  }
  if (!file.type.startsWith('video/')) {
    setStatus('That file is not a video.', 'error');
    input.value = '';
    return;
  }
  handleRecording(file);
});

analyzeBtn.addEventListener('click', runAnalysis);
retakeBtn.addEventListener('click', resetToCamera);
againBtn.addEventListener('click', resetToCamera);

// The icon has role="button": let Enter / Space open the camera too.
openCamera.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    input.click();
  }
});

window.addEventListener('pagehide', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
