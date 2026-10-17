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
const measuresTitle = document.getElementById('measures-title');
const measureGrid = document.getElementById('measure-grid');
const measuresNote = document.getElementById('measures-note');
const mathEl = document.getElementById('math');
const mathList = document.getElementById('math-list');
const notesEl = document.getElementById('analysis-notes');
const retakeBtn = document.getElementById('retake-btn');
const startOverBtn = document.getElementById('start-over-btn');

const statusEl = document.getElementById('status');

const whoButtons = [...document.querySelectorAll('.who-btn')];

const seenEl = document.getElementById('seen');
const seenNote = document.getElementById('seen-note');
const seenFrames = document.getElementById('seen-frames');

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

/**
 * Who the video is of, as the user answered. 'unsure' until they pick: the
 * gender group decides the head-length constant (and so every centimetre), the
 * size chart, and which of the two measurement sheets is computed, and none of
 * those may be guessed from a silhouette.
 */
let chosenGender = 'unsure';

/** The frames the last measurement looked at, for "What the app saw". */
let lastSeen = [];
let lastSeenNote = '';
let lastSeenOpen = false;
/** Object URLs currently held by that section, so they can be given back. */
let seenUrls = new Set();

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

/** Analyze is only live once the group has been picked and nothing is running. */
function updateAnalyzeEnabled() {
  analyzeBtn.disabled = analyzing || chosenGender === 'unsure';
}

/** Record the group the user picked and show which one is on. */
function setGender(value) {
  chosenGender = value;
  for (const btn of whoButtons) {
    const on = btn.dataset.gender === value;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  updateAnalyzeEnabled();
}

function setBusy(busy) {
  analyzing = busy;
  updateAnalyzeEnabled();
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

/* ---------- what the app saw ---------- */
/** One line describing a frame, in the order the app read it. */
function seenLine(item) {
  if (item.caption) return item.caption;
  const head = `Frame ${item.i + 1} · ${fmtTime(item.t)}`;
  if (!item.person) return `${head} — nobody was found in this frame`;
  const view = item.view === 'three-quarter' ? 'three-quarter turn' : `${item.view}-on`;
  if (item.reason) return `${head} · ${view} · ${item.reason}`;
  return `${head} · ${view} · ${item.usable} rows of your torso measured`;
}

/** The per-frame widths, so one reading far off the others is visible. */
function seenWidths(item) {
  const w = item.widths || {};
  return [
    ['chest', 'chest'], ['waist', 'waist'], ['hips', 'hips'],
    ['shoulder', 'shoulder'], ['arm', 'upper arm'],
  ]
    .filter(([key]) => w[key] != null)
    .map(([key, label]) => `${label} ${w[key]}"`);
}

function clearSeenDom() {
  seenFrames.replaceChildren();
  seenNote.textContent = '';
  seenEl.hidden = true;
  seenEl.open = false;
}

/** Give back the object URLs the section was holding. */
function releaseSeen() {
  for (const url of seenUrls) URL.revokeObjectURL(url);
  seenUrls = new Set();
  clearSeenDom();
}

function renderSeen(seen, { note = '', open = false } = {}) {
  // Only the object URLs still in use survive a re-render; the rest are given
  // back, so a second analysis does not leak the first one's frames.
  const keep = new Set((seen || []).map((f) => f.url).filter(Boolean));
  for (const url of seenUrls) if (!keep.has(url)) URL.revokeObjectURL(url);
  seenUrls = keep;
  clearSeenDom();

  if (!seen || !seen.length) return;
  seenEl.hidden = false;
  seenEl.open = open;
  seenNote.textContent = note
    || 'Every frame the app sampled, with the mask it read you from, the joints it found, and the rows each width was measured at.';

  for (const item of seen) {
    const li = el('li', 'seen-frame');
    const src = item.jpeg || item.url;
    if (src) {
      const img = document.createElement('img');
      img.className = 'seen-img';
      img.src = src;
      img.alt = seenLine(item);
      li.append(img);
    }
    li.append(el('p', 'seen-cap', seenLine(item)));
    const widths = seenWidths(item);
    if (widths.length) li.append(el('p', 'seen-widths', widths.join(' · ')));
    seenFrames.append(li);
  }
}

/** Remember the frames behind a result and show them straight away. */
function setSeen(seen, note = '', open = false) {
  lastSeen = seen || [];
  lastSeenNote = note;
  lastSeenOpen = open;
  renderSeen(lastSeen, { note, open });
}

/* ---------- reset ---------- */
function resetAll() {
  releaseMedia();
  releaseSeen();
  lastSeen = [];
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
  // The group is the user's own answer, not a guess — so say which sheet is
  // being read rather than pretending the video told us.
  if (g.chosen) {
    factsEl.append(fact('Measuring for', g.guess === 'female' ? 'women' : 'men'));
  } else {
    const genderText = g.guess === 'male' ? 'Male' : g.guess === 'female' ? 'Female' : 'Not sure';
    const genderConf = g.confidence ? ` (${Math.round(g.confidence * 100)}% sure)` : '';
    factsEl.append(fact('Detected', genderText + genderConf));
  }

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

/**
 * The catalogue: every category this clip actually showed, in the group the
 * user picked. The list IS the answer, so a category the video never contained
 * is not listed at all — no blank rows, no "not measured" placeholders.
 */
function renderMeasures(data) {
  measureGrid.replaceChildren();
  const items = data.catalogue?.items || [];
  const group = data.catalogue?.group;
  measuresTitle.textContent = group === 'female' ? "What we measured (women's sheet)"
    : group === 'male' ? "What we measured (men's sheet)"
      : 'What we measured';

  for (const item of items) {
    const cell = el('div', 'measure');
    cell.append(el('span', 'measure-label', item.label), el('span', 'measure-value', `${item.in}"`));
    measureGrid.append(cell);
  }

  if (!items.length) {
    measuresNote.textContent = 'Nothing in this clip could be measured.';
    return;
  }
  const removed = data.adjusted?.bodyWidthRemovedIn;
  measuresNote.textContent = removed
    ? `Read off your video over your clothes, then widened down by ${removed}" for the body underneath. Categories your clip did not show are not listed.`
    : 'Each number was read off the landmarks in your video, over your clothes. Categories your clip did not show are simply not listed.';
}

/**
 * The working: every girth is the width the front-facing frames gave and the
 * depth the side-on frames gave, turned into a tape reading by the factor
 * ANSUR II measured for that part of the body. Showing it is the whole point —
 * these are calculations, not guesses.
 */
function renderMath(data) {
  mathList.replaceChildren();
  const g = data.geometry || {};
  const rows = [];

  // One line per measured category, straight from the engine's own working.
  for (const item of data.catalogue?.items || []) rows.push(`${item.label}: ${item.how}`);

  const h = g.height;
  if (h) {
    rows.push(`Height: ${h.in}" head-to-floor${h.headUnits ? ` (${h.headUnits} head-lengths)` : ''}, from ${h.views} full-body frame${h.views === 1 ? '' : 's'}`);
  }

  if (g.scale) {
    const anchors = (g.scale.anchors || []).join(', ');
    rows.push(`Scale: ${g.scale.cmPerImageWidth} cm per image width${anchors ? ` — anchored on ${anchors}` : ''}`);
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
  renderSeen(lastSeen, { note: lastSeenNote, open: lastSeenOpen });
  show('result');
}

async function runAnalysis() {
  if (analyzing || !recordedBlob) return;
  setBusy(true);
  lastSeen = [];
  releaseSeen();
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
        // Sample the whole turn densely. Each measurement is then a robust mean
        // over many views instead of a lucky frame, and the side-on part of the
        // turn is more likely to be caught while it is actually clean — which is
        // what stops the depth having to be modelled at all.
        const measured = await analyzePose(recordedBlob, {
          count: 16,
          from,
          to,
          maxWidth: 720,
          gender: chosenGender,
          onProgress: (msg) => setStatus(msg),
        });
        log('on-device measurement', measured);
        if (measured.frames.length) {
          // Keep the frames themselves: if the numbers look wrong, the picture
          // they came from is the only thing that can say why.
          lastSeen = measured.seen || [];
          lastSeenNote = '';
          lastSeenOpen = false;
          // A chest is the one measurement a size cannot be worked out without,
          // and the one thing a clip standing still can get wrong: arms pressed
          // against the ribs sit in front of the torso, so nothing in the picture
          // says where the torso ends. That is not guessable, so stop here and say
          // exactly what to change rather than spend a round trip on a blank.
          const anyChest = measured.frames.some((f) => f.landmarks && f.landmarks.armpitL != null);
          if (!anyChest) {
            log('no frame gave a chest measurement — asking for a retake');
            setSeen(measured.seen,
              'None of these frames could give a chest measurement, so no size could be worked out from them.', true);
            setStatus('We could not measure your chest: your arms were against your sides in every frame, so there is no way to tell your torso from your arms. Stand with your arms a little away from your body and record again — that one change is what gives you a size.', 'error');
            setBusy(false);
            return;
          }
          setStatus(`Sending ${measured.frames.length} measurements…`);
          data = await analyzeGeometry(measured, {
            gender: chosenGender,
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
      lastSeen = frames.map((f, i) => ({
        i,
        caption: `Frame ${i + 1} of ${frames.length} — sent to the server`,
        url: URL.createObjectURL(f),
      }));
      lastSeenNote = 'Nothing usable could be measured on the device, so these frames were sent to the server for the vision model to read.';
      lastSeenOpen = false;

      // The tick keeps the status moving so it never looks frozen.
      setStatus(`Analyzing ${frames.length} frames on the server… 0s`);
      data = await analyzeBody(frames, {
        gender: chosenGender,
        onTick: (s) => setStatus(`Analyzing ${frames.length} frames on the server… ${s}s`),
      });
    }

    log('analysis result', data);
    renderAnalysis(data);
    setStatus(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`, 'ok');
  } catch (e) {
    log('analyze failed:', e.message);
    setStatus(e.message || 'Something went wrong during analysis.', 'error');
    // The frames are the whole reason a measurement was refused, so show them
    // next to the reason rather than leaving the message to explain a picture
    // the user cannot see.
    if (lastSeen.length) {
      renderSeen(lastSeen, {
        note: 'These are the frames the analysis was working from.',
        open: true,
      });
    }
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
for (const btn of whoButtons) {
  btn.addEventListener('click', () => setGender(btn.dataset.gender));
}
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
    gender: { guess: 'male', confidence: 1, chosen: true },
    clothing: { items: ['t-shirt', 'jeans'], fit: 'regular', density: 'light', thicknessIn: 0.15 },
    measurements: { chest: 40.5, waist: 29.4, hips: 35.6, shoulder: 18.3, neck: 14.1, arm: 13.1, height: 71.1 },
    adjusted: { chest: 40.2, waist: 29.1, hips: 35.3, shoulder: 18.0, neck: 14.1, arm: 13.1, height: 71.1, bodyWidthRemovedIn: 0.3 },
    proportions: { build: 'average', shoulderToHip: 1.15, legToTorso: 0.95 },
    catalogue: {
      group: 'male',
      items: [
        { key: 'head', label: 'Head', in: 21.4, cm: 54.5, how: '5.9" across x 7.7" deep (1.3x width) -> a tape of 21.4" around it' },
        { key: 'neck', label: 'Neck Size', in: 14.1, cm: 35.8, how: '4.7" across x 4.3" deep (side view x2) -> a tape of 14.1" around it' },
        { key: 'chest', label: 'Chest', in: 40.2, cm: 102.1, how: '11.0" across x 9.7" deep (side view x2) -> a tape of 40.2" around it' },
        { key: 'waist', label: 'Waist', in: 29.1, cm: 74.0, how: '10.2" across x 7.3" deep (side view x2) -> a tape of 29.1" around it' },
        { key: 'hips', label: 'Hip/Seat', in: 35.3, cm: 89.7, how: '12.0" across x 8.5" deep (side view x2) -> a tape of 35.3" around it' },
        { key: 'shoulder', label: 'Shoulder', in: 18.3, cm: 46.5, how: '18.3" across the shoulders, from 3 frames' },
        { key: 'xBack', label: 'X-Back', in: 18.0, cm: 45.7, how: '18.0" across your back at armpit level, read from the frames showing your back, from 2 frames' },
        { key: 'napeToWaist', label: 'Nape to waist', in: 17.4, cm: 44.2, how: '17.4" from the nape of your neck to your waist line, from 4 frames' },
        { key: 'sleeveLength', label: 'Sleeve Length', in: 24.1, cm: 61.2, how: '24.1" from the shoulder point, through the elbow, to the wrist bone, from 3 frames' },
        { key: 'waistToKnee', label: 'Waist to Knee', in: 22.4, cm: 56.9, how: '22.4" from your waist line to your knee, from 4 frames' },
        { key: 'waistToFloor', label: 'Waist to Floor', in: 41.4, cm: 105.2, how: '41.4" from your waist line to the floor, from 4 frames' },
        { key: 'calf', label: 'Calf', in: 15.3, cm: 38.9, how: '5.0" across x 4.8" deep (0.95x width, modelled) -> a tape of 15.3" around it' },
        { key: 'ankle', label: 'Ankle', in: 9.1, cm: 23.2, how: '3.0" across x 2.9" deep (0.95x width, modelled) -> a tape of 9.1" around it' },
        { key: 'totalHeight', label: 'Total Height', in: 71.1, cm: 180.6, how: '71.1" from the crown of your head to the floor, from 4 frames' },
      ],
    },
    geometry: {
      aspect: 0.75,
      scale: { cmPerImageWidth: 185.53, anchors: ['23.5 cm head'] },
      methods: {},
      height: { in: 71.1, headUnits: 7.5, views: 4, spread: 0.4 },
    },
    notes: [
      'Read against the men\'s measurement sheet, as you chose.',
      'Clothing (t-shirt, jeans) · light density · regular fit — about 0.3 in of width subtracted from the body estimate.',
      'Depth came from the side-on frames, so the girths are measured rather than modelled.',
    ],
    views: ['front', 'three-quarter', 'side', 'back', 'side', 'front'],
  });
  setStatus('Sample result — nothing was recorded.', 'ok');
}
