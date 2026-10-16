/* =========================================================
   3dGarments — Find your size
   1. Tap the camera icon -> the phone's NATIVE camera app records a video.
   2. Crop the box to your body (optional) so the AI ignores the background.
   3. The AI focuses on you, guesses gender, gauges how thick the clothing is,
      then estimates body measurements and size — subtracting the clothing's
      width. A reconciliation pass tightens the final numbers.
   ========================================================= */

import { extractFrames, extractPreview } from './body-scan/frames.js';
import { analyzeBody } from './body-scan/analyze.js';
import { createCropper } from './body-scan/crop.js';

const MAX_SECONDS = 30;

const intro = document.getElementById('intro');
const openCamera = document.querySelector('.open-camera');
const input = document.getElementById('video-input');

const cropStep = document.getElementById('crop');
const cropFrame = document.getElementById('crop-frame');
const cropStage = document.getElementById('crop-stage');
const cropBox = document.getElementById('crop-box');
const cropNote = document.getElementById('crop-note');
const analyzeBtn = document.getElementById('analyze-btn');
const fullFrameBtn = document.getElementById('full-frame-btn');
const resetCropBtn = document.getElementById('reset-crop-btn');
const startOverCrop = document.getElementById('start-over-crop');

const analysis = document.getElementById('analysis');
const sizeValue = document.getElementById('size-value');
const sizeSub = document.getElementById('size-sub');
const factsEl = document.getElementById('facts');
const measureGrid = document.getElementById('measure-grid');
const measuresNote = document.getElementById('measures-note');
const notesEl = document.getElementById('analysis-notes');
const retakeBtn = document.getElementById('retake-btn');
const startOverBtn = document.getElementById('start-over-btn');

const statusEl = document.getElementById('status');

const cropper = createCropper({ stage: cropStage, box: cropBox });

/** The recorded video, held in memory while the user is on the page. */
let recordedBlob = null;
let previewImgUrl = null;
let analyzing = false;

/* ---------- helpers ---------- */
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

function setBusy(busy) {
  analyzing = busy;
  analyzeBtn.disabled = busy;
  fullFrameBtn.disabled = busy;
  resetCropBtn.disabled = busy;
  startOverCrop.disabled = busy;
}

function show(step) {
  intro.hidden = step !== 'camera';
  openCamera.hidden = step !== 'camera';
  cropStep.hidden = step !== 'crop';
  analysis.hidden = step !== 'result';
}

/* ---------- reset ---------- */
function resetAll() {
  if (previewImgUrl) {
    URL.revokeObjectURL(previewImgUrl);
    previewImgUrl = null;
  }
  cropFrame.removeAttribute('src');
  recordedBlob = null;
  input.value = '';
  cropper.reset();
  setBusy(false);
  setStatus('');
  cropNote.textContent = '';
  show('camera');
}

/* ---------- duration ---------- */
function readDuration(blob) {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    const url = URL.createObjectURL(blob);
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.onerror = () => done(null);
    probe.src = url;
  });
}

/* ---------- after recording: show the crop step ---------- */
async function handleRecording(file) {
  recordedBlob = file;
  show('crop');
  setStatus('Loading your video…');

  const kb = Math.max(1, Math.round(file.size / 1024));
  const sizeText = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  cropNote.textContent = `Video captured · ${sizeText}`;

  try {
    const preview = await extractPreview(file);
    previewImgUrl = URL.createObjectURL(preview.blob);
    cropFrame.src = previewImgUrl;
    cropStage.style.aspectRatio = `${preview.width} / ${preview.height}`;
  } catch (e) {
    cropNote.textContent = `Could not preview the video (${e.message}). You can still tap "Use whole frame".`;
  }

  const seconds = await readDuration(file);
  if (seconds != null) {
    cropNote.textContent += ` · ${Math.round(seconds)}s`;
    if (seconds > MAX_SECONDS + 1) {
      setStatus(`That clip is ${Math.round(seconds)}s — over the 30s guidance. A shorter, slower turn reads better.`, 'error');
      return;
    }
  }
  setStatus('Drag the box to cover just you, then analyze.');
}

/* ---------- analysis ---------- */
function fact(label, value) {
  const row = el('li', 'fact');
  row.append(el('span', 'fact-label', label), el('span', 'fact-value', value));
  return row;
}

function renderFacts(data) {
  factsEl.replaceChildren();
  const g = data.gender || {};
  const genderText = g.guess === 'male' ? 'Male' : g.guess === 'female' ? 'Female' : 'Not sure';
  const genderConf = g.confidence ? ` (${Math.round(g.confidence * 100)}% sure)` : '';
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

  const views = (data.views || []).filter(Boolean);
  if (views.length) factsEl.append(fact('Views read', [...new Set(views)].join(', ')));
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
  for (const note of data.notes || []) notesEl.append(el('li', 'note', note));
}

function renderAnalysis(data) {
  sizeValue.textContent = data.size || '—';
  const basis = data.sizeBasis === 'female' ? "women's" : data.sizeBasis === 'male' ? "men's" : '';
  const rec = data.reconciled ? ' · cross-checked' : '';
  sizeSub.textContent = basis ? `${basis} sizing${rec}` : rec.trim();

  renderFacts(data);
  renderMeasures(data);
  renderNotes(data);
  show('result');
}

async function runAnalysis(useCrop) {
  if (analyzing || !recordedBlob) return;
  setBusy(true);

  try {
    const crop = useCrop ? cropper.getRect() : null;

    setStatus('Cropping key frames from your video…');
    const frames = await extractFrames(recordedBlob, { count: 6, crop });

    setStatus(`Analyzing ${frames.length} frames — this can take up to 30s…`);
    const data = await analyzeBody(frames);

    renderAnalysis(data);
    setStatus('');
  } catch (e) {
    setStatus(e.message || 'Something went wrong during analysis.', 'error');
    setBusy(false);
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

analyzeBtn.addEventListener('click', () => runAnalysis(true));
fullFrameBtn.addEventListener('click', () => runAnalysis(false));
resetCropBtn.addEventListener('click', () => cropper.reset());
startOverCrop.addEventListener('click', resetAll);
retakeBtn.addEventListener('click', resetAll);
startOverBtn.addEventListener('click', resetAll);

// The icon has role="button": let Enter / Space open the camera too.
openCamera.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    input.click();
  }
});

window.addEventListener('pagehide', () => {
  if (previewImgUrl) URL.revokeObjectURL(previewImgUrl);
});
