/* =========================================================
   3dGarments — Find your size
   1. Tap the camera icon -> the phone's NATIVE camera app records a video.
   2. Trim the clip's LENGTH to the part where you turn around.
   3. Measure ON THE DEVICE: a pose model finds the joints and the person's own
      silhouette gives every width, so nothing is recalled from an average body
      and nothing is uploaded until it is a handful of numbers. The server does
      all the arithmetic and only reports what was visible — a blank beats a
      guess. The arithmetic is shown under "How these were worked out".
      Browsers that cannot run the pose model fall back to sending JPEG frames
      for the server's vision model (?llm=1 forces that path).
   ========================================================= */

import { extractFrames, extractPoster, readDuration } from './body-scan/frames.js';
import { analyzeBody, analyzeGeometry } from './body-scan/analyze.js';
import { analyzePose } from './body-scan/pose.js';
import { createTrimmer } from './body-scan/trim.js';

/** ?llm=1 — skip the on-device measurement and use the vision model instead. */
const forceLlm = new URLSearchParams(location.search).get('llm') === '1';

/**
 * ?debug=1 — prints what the device is actually reporting. Handy when a layout
 * change appears not to apply on a real phone: it shows the viewport the browser
 * claims, the resulting root font size, whether either mobile condition matched,
 * and the exact asset filenames loaded (so a stale cache is obvious).
 */
function showDeviceReadout() {
  const asset = (sel, attr) => [...document.querySelectorAll(sel)]
    .map((el) => el[attr].split('/').pop()).join(' ') || 'none';
  const narrow = matchMedia('(max-width: 768px)').matches;
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const lines = [
    `viewport   ${window.innerWidth} x ${window.innerHeight}  @${window.devicePixelRatio}x`,
    `root font  ${getComputedStyle(document.documentElement).fontSize}   mobile scale: ${narrow || touch ? 'ON' : 'OFF'}`,
    `width<=768 ${narrow ? 'yes' : 'no'}    touch-first ${touch ? 'yes' : 'no'}`,
    `css        ${asset('link[rel="stylesheet"]', 'href')}`,
    `js         ${asset('script[src]', 'src')}`,
  ];
  const box = document.createElement('pre');
  box.className = 'debug';
  box.textContent = lines.join('\n');
  document.body.append(box);
  console.log('[3dg:debug]', lines.join(' | '));
}

if (new URLSearchParams(location.search).has('debug')) showDeviceReadout();

const intro = document.getElementById('intro');
const openCamera = document.querySelector('.open-camera');
const input = document.getElementById('video-input');
const trimStep = document.getElementById('trim');
const trimVideo = document.getElementById('trim-video');
const trimStart = document.getElementById('trim-start');
const trimEnd = document.getElementById('trim-end');
const trimStartOut = document.getElementById('trim-start-out');
const trimEndOut = document.getElementById('trim-end-out');
const timelineFill = document.getElementById('timeline-fill');
const trimNote = document.getElementById('trim-note');
const analyzeBtn = document.getElementById('analyze-btn');
const startOverTrim = document.getElementById('start-over-trim');

const analysis = document.getElementById('analysis');
const sizeValue = document.getElementById('size-value');
const sizeSub = document.getElementById('size-sub');
const factsEl = document.getElementById('facts');
const measureGrid = document.getElementById('measure-grid');
const measuresNote = document.getElementById('measures-note');
const mathEl = document.getElementById('math');
const mathList = document.getElementById('math-list');
const notesEl = document.getElementById('analysis-notes');
const retakeBtn = document.getElementById('retake-btn');
const startOverBtn = document.getElementById('start-over-btn');

const statusEl = document.getElementById('status');

const log = (...args) => console.log('[3dg]', ...args);

const fmtTime = (s) => {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const trimmer = createTrimmer({
  video: trimVideo,
  startInput: trimStart,
  endInput: trimEnd,
  fill: timelineFill,
  onChange: ({ start, end, duration }) => {
    trimStartOut.textContent = fmtTime(start);
    trimEndOut.textContent = fmtTime(end);
    trimNote.textContent = duration
      ? `Keeping ${fmtTime(start)} to ${fmtTime(end)} · ${Math.max(0, end - start).toFixed(0)}s`
      : 'Using the whole clip';
  },
});

/** The recorded video, held in memory while the user is on the page. */
let recordedBlob = null;
let videoUrl = null;
let posterUrl = null;
let analyzing = false;

/* ---------- helpers ---------- */
function setStatus(message, kind = '') {
  statusEl.textContent = message || '';
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  if (kind === 'error') {
    try { statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
  }
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
  startOverTrim.disabled = busy;
}

function show(step) {
  intro.hidden = step !== 'camera';
  openCamera.hidden = step !== 'camera';
  trimStep.hidden = step !== 'trim';
  analysis.hidden = step !== 'result';
}

function releaseMedia() {
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
  if (posterUrl) { URL.revokeObjectURL(posterUrl); posterUrl = null; }
  try { trimVideo.pause(); } catch { /* ignore */ }
  trimVideo.removeAttribute('src');
  trimVideo.removeAttribute('poster');
  try { trimVideo.load(); } catch { /* ignore */ }
}

/* ---------- reset ---------- */
function resetAll() {
  releaseMedia();
  recordedBlob = null;
  input.value = '';
  trimmer.load(0);
  setBusy(false);
  setStatus('');
  trimNote.textContent = '';
  show('camera');
}

/* ---------- after recording: show the trim step ---------- */
async function handleRecording(file) {
  recordedBlob = file;
  show('trim');
  setStatus('Loading your video…');
  log('recorded', { name: file.name, type: file.type, bytes: file.size });

  releaseMedia();
  videoUrl = URL.createObjectURL(file);
  trimVideo.src = videoUrl;

  const duration = await readDuration(file);
  trimmer.load(duration);
  log('duration', duration);

  try {
    const poster = await extractPoster(file);
    posterUrl = URL.createObjectURL(poster.blob);
    trimVideo.poster = posterUrl;
  } catch (e) {
    log('poster failed:', e.message);
  }

  if (!duration) {
    setStatus('Could not read the clip length — the whole clip will be used.', 'error');
  } else if (duration > 30) {
    setStatus(`Your clip is ${Math.round(duration)}s — trimmed to the first 30s. Adjust the sliders if you like.`, 'ok');
  } else {
    setStatus('Scrub the sliders to trim, then analyze.', 'ok');
  }
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
    ['Neck', fmtIn(m.neck)],
    ['Upper arm', fmtIn(m.arm)],
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
    measuresNote.textContent = `Measured about ${fmtIn(seenChest)} over the clothing, then widened down by ${removed}" to estimate the body itself.`;
  } else {
    measuresNote.textContent = 'Computed from the visible landmarks in your video — not a tape measure.';
  }
}

/**
 * The working: every number is the perimeter of an ellipse whose width came
 * from the front-facing frames and whose depth came from the side-on ones.
 * Showing it is the whole point — these are calculations, not guesses.
 */
function renderMath(data) {
  mathList.replaceChildren();
  const g = data.geometry || {};
  const methods = g.methods || {};
  const rows = [];

  for (const key of ['chest', 'waist', 'hips', 'neck', 'arm', 'shoulder']) {
    const m = methods[key];
    if (!m) continue;
    if (m.girthIn != null) {
      rows.push(`${m.label}: ${m.widthIn}" wide × ${m.depthIn}" deep (${m.depthSource}) → perimeter ${m.girthIn}"`);
    } else {
      rows.push(`${m.label}: ${m.widthIn}" across (${m.widthView ?? m.widthViews} view${(m.widthViews ?? 1) === 1 ? '' : 's'})`);
    }
  }

  const h = g.height;
  if (h) {
    rows.push(`Height: ${h.in}" head-to-floor${h.headUnits ? ` (${h.headUnits} head-lengths)` : ''}, from ${h.views} full-body frame${h.views === 1 ? '' : 's'}`);
  }

  if (g.scale) {
    const anchors = (g.scale.anchors || []).join(', ');
    rows.push(`Scale: ${g.scale.cmPerImageWidth} cm per image width${anchors ? ` — anchored on ${anchors}` : ''}`);
  }

  if (g.dropped?.length) {
    rows.push(`Left blank (not measurable from this clip): ${g.dropped.join(', ')}`);
  }
  if (g.scale?.headUnitsCorrection && Math.abs(g.scale.headUnitsCorrection - 1) > 0.02) {
    rows.push(`Head-length correction: ×${g.scale.headUnitsCorrection} (adult proportions are 7.1–7.9 heads tall)`);
  }

  for (const row of rows) mathList.append(el('li', 'math-item', row));
  mathEl.hidden = rows.length === 0;
}

function renderNotes(data) {
  notesEl.replaceChildren();
  for (const note of data.notes || []) notesEl.append(el('li', 'note', note));
}

function renderAnalysis(data) {
  sizeValue.textContent = data.size || '—';
  const basis = data.sizeBasis === 'female' ? "women's" : data.sizeBasis === 'male' ? "men's" : '';
  const rec = data.reconciled ? 'cross-checked' : '';
  sizeSub.textContent = [basis ? `${basis} sizing` : '', rec].filter(Boolean).join(' · ');

  renderFacts(data);
  renderMeasures(data);
  renderMath(data);
  renderNotes(data);
  show('result');
}

async function runAnalysis() {
  if (analyzing || !recordedBlob) return;
  setBusy(true);
  const startedAt = Date.now();

  try {
    const { from, to } = trimmer.getSpan();
    log('analyze start', { bytes: recordedBlob.size, type: recordedBlob.type, from, to });

    // 1. Measure ON THE DEVICE first. The pose model finds the joints and the
    //    person's own silhouette gives every width, so nothing is recalled from
    //    an average body and nothing is uploaded until it is a few numbers.
    //    Anything that fails here falls through to the vision path below.
    let data = null;
    if (!forceLlm) {
      try {
        const measured = await analyzePose(recordedBlob, {
          count: 6,
          from,
          to,
          maxWidth: 720,
          onProgress: (msg) => setStatus(msg),
        });
        log('on-device measurement', measured);
        if (measured.frames.length) {
          setStatus(`Sending ${measured.frames.length} measurements…`);
          data = await analyzeGeometry(measured, {
            onTick: (s) => setStatus(`Working out your measurements… ${s}s`),
          });
        } else {
          log('on-device measurement found no usable frame — falling back to the vision model');
        }
      } catch (e) {
        log('on-device measurement failed — falling back to the vision model:', e.message);
      }
    }

    // 2. Fallback: JPEG frames for the vision model. Also the only path when the
    //    browser cannot run the pose model at all.
    if (!data) {
      setStatus('Grabbing key frames from your clip…');
      let frames;
      try {
        frames = await extractFrames(recordedBlob, { count: 6, from, to });
      } catch (e) {
        log('frame extraction failed — falling back to a single frame:', e.message);
        const poster = await extractPoster(recordedBlob, { maxWidth: 900, grid: true });
        frames = [new File([poster.blob], 'frame-0.jpg', { type: 'image/jpeg' })];
      }
      log('frames ready', frames.length, frames.reduce((s, f) => s + f.size, 0), 'bytes');

      // The tick keeps the status moving so it never looks frozen.
      setStatus(`Analyzing ${frames.length} frames on the server… 0s`);
      data = await analyzeBody(frames, {
        onTick: (s) => setStatus(`Analyzing ${frames.length} frames on the server… ${s}s`),
      });
    }

    log('analysis result', data);
    renderAnalysis(data);
    setStatus(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`, 'ok');
  } catch (e) {
    log('analyze failed:', e.message);
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

analyzeBtn.addEventListener('click', runAnalysis);
startOverTrim.addEventListener('click', resetAll);
retakeBtn.addEventListener('click', resetAll);
startOverBtn.addEventListener('click', resetAll);

// The icon has role="button": let Enter / Space open the camera too.
openCamera.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    input.click();
  }
});

window.addEventListener('pagehide', releaseMedia);

/**
 * ?demo=1 — render a canned analysis so the results screen can be seen and
 * checked without recording a video. Local only; it touches no network.
 */
if (new URLSearchParams(location.search).has('demo')) {
  renderAnalysis({
    size: 'M',
    sizeBasis: 'male',
    reconciled: true,
    frameCount: 6,
    gender: { guess: 'male', confidence: 0.82 },
    clothing: { items: ['t-shirt', 'jeans'], fit: 'regular', density: 'light', thicknessIn: 0.15 },
    measurements: { chest: 41.2, waist: 36.4, hips: 40.2, shoulder: 18.3, neck: 14.6, arm: 13.1, height: 71.1 },
    adjusted: { chest: 40.9, waist: 36.1, hips: 39.9, shoulder: 18.0, neck: 14.6, arm: 13.1, height: 71.1, bodyWidthRemovedIn: 0.3 },
    proportions: { build: 'average', shoulderToHip: 1.15, legToTorso: 0.95 },
    geometry: {
      aspect: 0.75,
      scale: { cmPerImageWidth: 185.53, anchors: ['23.5 cm head'] },
      methods: {
        chest: { label: 'Chest', girthIn: 41.2, widthIn: 15.0, depthIn: 10.6, depthSource: 'side view x2', widthViews: 3, widthView: 3, confidence: 0.86 },
        waist: { label: 'Waist', girthIn: 36.4, widthIn: 13.0, depthIn: 9.8, depthSource: 'side view x2', widthViews: 3, widthView: 3, confidence: 0.84 },
        hips: { label: 'Hips', girthIn: 40.2, widthIn: 14.2, depthIn: 11.0, depthSource: 'side view x2', widthViews: 3, widthView: 3, confidence: 0.83 },
        neck: { label: 'Neck', girthIn: 14.6, widthIn: 4.7, depthIn: 4.3, depthSource: 'side view x2', widthViews: 4, widthView: 4, confidence: 0.8 },
        arm: { label: 'Upper arm', girthIn: 13.1, widthIn: 4.3, depthIn: 3.9, depthSource: 'side view x2', widthViews: 4, widthView: 4, confidence: 0.75 },
        shoulder: { label: 'Shoulder', girthIn: null, widthIn: 18.3, widthViews: 3, widthView: 3, depthSource: '', confidence: 0.8 },
      },
      height: { in: 71.1, headUnits: 7.5, views: 4, spread: 0.4 },
      dropped: [],
    },
    notes: [
      'Measured from what is visible in the clip: chest, waist, hips and full height.',
      'Clothing (t-shirt, jeans) · light density · regular fit — about 0.3 in of width subtracted from the body estimate.',
      'Depth came from the side-on frames, so the girths are measured rather than modelled.',
    ],
    views: ['front', 'three-quarter', 'side', 'back', 'side', 'front'],
  });
  setStatus('Sample result — nothing was recorded.', 'ok');
}
