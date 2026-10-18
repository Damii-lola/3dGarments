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
import { createCalibrator } from './body-scan/calibrate.js';
import { showNote } from './body-scan/notes.js';

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
const privacy = document.getElementById('privacy');
const captureEl = document.getElementById('capture');
const captureChoice = document.getElementById('capture-choice');
const openCamera = document.getElementById('open-camera');
/** Record in the phone's camera app, or upload one already on the device. */
const inputs = [document.getElementById('video-record'), document.getElementById('video-upload')];
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

const calibCanvas = document.getElementById('calib-canvas');
const calibDotA = document.getElementById('calib-dot-a');
const calibDotB = document.getElementById('calib-dot-b');
const calibWhat = document.getElementById('calib-what');
const calibTime = document.getElementById('calib-time');
const calibStage = document.getElementById('calib-stage');
const calibNote = document.getElementById('calib-note');
const wearTop = document.getElementById('wear-top');
const wearFit = document.getElementById('wear-fit');
const wearLower = document.getElementById('wear-lower');

/**
 * What each garment adds on ONE side of the body, in inches. These are the same
 * numbers the vision prompt has always asked for (a thin tee 0.15, a hoodie 0.6,
 * a puffer 1.2), so both paths subtract the same fabric.
 */
const GARMENTS = {
  bare: { top: 'nothing', thicknessIn: 0 },
  't-shirt': { top: 'a thin t-shirt', thicknessIn: 0.15 },
  polo: { top: 'a polo shirt', thicknessIn: 0.2 },
  flannel: { top: 'a flannel shirt', thicknessIn: 0.35 },
  jumper: { top: 'a knit jumper', thicknessIn: 0.45 },
  hoodie: { top: 'a hoodie', thicknessIn: 0.6 },
  jacket: { top: 'a jacket', thicknessIn: 0.7 },
  puffer: { top: 'a puffer jacket', thicknessIn: 1.2 },
};
/** Trousers are their own thickness: they cover different rows from a top. */
const LOWER_GARMENTS = {
  bare: { lower: 'nothing', thicknessIn: 0 },
  jeans: { lower: 'jeans', thicknessIn: 0.09 },
  chinos: { lower: 'chinos', thicknessIn: 0.08 },
  joggers: { lower: 'joggers', thicknessIn: 0.16 },
  thick: { lower: 'thick trousers', thicknessIn: 0.15 },
};
/** How much more a loose garment stands off the body than a fitted one. */
const FIT_FACTOR = { fitted: 0.8, regular: 1, loose: 1.4 };

/** The clothing as the measurement engine wants it, or {} if they did not say. */
function readClothing() {
  const g = GARMENTS[wearTop.value];
  const l = LOWER_GARMENTS[wearLower.value];
  if (!g && !l) return {};
  const fit = FIT_FACTOR[wearFit.value] ? wearFit.value : 'regular';
  const out = {};
  if (g) {
    out.top = g.top;
    out.topFit = fit;
    out.density = g.thicknessIn >= 0.45 ? 'heavy' : g.thicknessIn >= 0.2 ? 'medium' : 'light';
    out.thicknessIn = Number((g.thicknessIn * FIT_FACTOR[fit]).toFixed(2));
  }
  if (l) {
    out.lower = l.lower;
    out.lowerFit = fit;
    out.lowerThicknessIn = Number((l.thicknessIn * FIT_FACTOR[fit]).toFixed(2));
  }
  return out;
}

const analysis = document.getElementById('analysis');
const factsEl = document.getElementById('facts');
const measuresLead = document.getElementById('measures-lead');
const measureGroups = document.getElementById('measure-groups');
const notesEl = document.getElementById('analysis-notes');
const tipEl = document.getElementById('tip');
const tipScrim = document.getElementById('tip-scrim');
const tipTitle = document.getElementById('tip-title');
const tipValue = document.getElementById('tip-value');
const tipWhat = document.getElementById('tip-what');
const tipWhere = document.getElementById('tip-where');
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

/**
 * The one marked object of a known size, if the user marked one. It is sent with
 * the measurements and outweighs the head ruler, so it is held here rather than
 * read off the DOM at send time.
 */
let markedReference = null;
const calibrator = createCalibrator({
  video: trimVideo,
  canvas: calibCanvas,
  dotA: calibDotA,
  dotB: calibDotB,
  select: calibWhat,
  timeInput: calibTime,
  stage: calibStage,
  note: calibNote,
  onChange: (ref) => { markedReference = ref; },
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

/** The OS's own answer to "animate this?" beats any animation we can write. */
const MOTION_OK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function show(step) {
  intro.hidden = step !== 'camera';
  // The promise belongs to the landing step only; the results carry their own
  // one-line copy of it. Leaving this visible would say it twice in a row.
  privacy.hidden = step !== 'camera';
  captureEl.hidden = step !== 'camera';
  if (step !== 'camera') setChoice(false);
  trimStep.hidden = step !== 'trim';
  analysis.hidden = step !== 'result';
  // The box floats over everything, so it must not survive leaving the results.
  if (step !== 'result') hideTip();
  // A step arrives instead of appearing. The results animate their own contents
  // as a longer cascade, so only the other steps get the container move.
  const entering = step === 'trim' ? trimStep : step === 'camera' ? captureEl : null;
  if (entering && MOTION_OK) {
    entering.classList.remove('step-in');
    // Read a layout property so the browser sees the class actually go away;
    // without this the re-add is a no-op and nothing animates the second time.
    void entering.offsetWidth;
    entering.classList.add('step-in');
  }
}

/**
 * Open or close the two ways in: record in the phone's own camera app, or upload
 * a video already on the device. Closed on every step but the landing, and
 * closed again by a press anywhere else, so it can never be left hanging open.
 */
function setChoice(open) {
  const isOpen = !!open;
  if (isOpen === !captureChoice.hidden) return;
  captureChoice.hidden = !isOpen;
  openCamera.setAttribute('aria-expanded', String(isOpen));
  openCamera.classList.toggle('open', isOpen);
  if (isOpen && MOTION_OK) {
    captureChoice.classList.remove('choice-in');
    void captureChoice.offsetWidth;
    captureChoice.classList.add('choice-in');
  }
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
  for (const el of inputs) el.value = '';
  trimmer.load(0);
  calibrator.clear();
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
  calibrator.load(duration);
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
  if (data.proportions?.build) factsEl.append(fact('Build', data.proportions.build));
}

/**
 * What each number is, and where the tape goes for it, in words a child could
 * follow. No "girth", no "depth ratio", no "as modelled" — the app already did
 * that thinking; this is the part the person in front of the mirror needs.
 *
 * It matters because a tape measure reads a line somebody chose and this app
 * reads a row of pixels: "the waist" and "the hips" are different lines about
 * eight inches apart, and nobody can find them by guessing. It is how a self
 * taken 32.2" turns out to have been the waist and not the seat.
 */
const ABOUT = {
  head: { what: 'How big around your head is. Hat size.', where: 'Wrap the tape around the biggest part of your head, above your ears.' },
  neck: { what: 'How big around your neck is. Shirt collar size.', where: 'Around the bottom of your neck, one finger loose under the tape.' },
  chest: { what: 'How big around your chest is. The main number for a top.', where: 'Wrap it around the biggest part of your chest, level, just under your armpits.' },
  bust: { what: 'How big around your bust is. The main number for a top.', where: 'Wrap it around the biggest part of your bust, level, just under your armpits.' },
  waist: { what: 'How big around your middle is. The main number for trousers.', where: 'Around your middle at your tummy button — where a belt goes. Bend sideways and the crease is your waist.' },
  lowWaist: { what: 'Around your middle, a bit lower down.', where: 'About two fingers below your belt line, where a low-rise waistband sits.' },
  hips: { what: 'How big around your bottom is.', where: 'Around the biggest part of your bottom, about a hand below your belt line. Not the same line as your waist.' },
  shoulder: { what: 'How wide your shoulders are.', where: 'Straight across your back, from one shoulder corner to the other.' },
  backWidth: { what: 'How wide your back is.', where: 'Straight across your back, level with your armpits.' },
  topArm: { what: 'How big around your upper arm is.', where: 'Around the fattest part of your top arm, arm hanging loose.' },
  elbow: { what: 'How big around your elbow is.', where: 'Around your elbow with your arm straight.' },
  wrist: { what: 'How big around your wrist is.', where: 'Around your wrist bone, past the little bump.' },
  knee: { what: 'How big around your knee is.', where: 'Around your knee, leg straight and relaxed.' },
  calf: { what: 'How big around your calf is.', where: 'Around the fattest part of your calf.' },
  highAnkle: { what: 'How big around your leg is above the ankle.', where: 'Around your leg just above the ankle bone.' },
  ankle: { what: 'How big around your ankle is.', where: 'Around your ankle bone, over the bump.' },
  sleeveLength: { what: 'How long your arm is.', where: 'From your shoulder corner, over a slightly bent elbow, down to your wrist bone.' },
  napeToWaist: { what: 'How long your back is.', where: 'From the bump at the bottom of your neck, down your back, to your belt line.' },
  shoulderToWaist: { what: 'How long your front is.', where: 'From your shoulder line, down the front, to your belt line.' },
  armholeDepth: { what: 'How deep the armhole needs to be.', where: 'From your shoulder line straight down to your armpit.' },
  waistToKnee: { what: 'How long your thigh is.', where: 'From your belt line straight down to the middle of your knee.' },
  waistToHip: { what: 'How far your bottom hangs below your belt.', where: 'From your belt line down to the biggest part of your bottom.' },
  waistToFloor: { what: 'How long your legs are from your belt down.', where: 'From your belt line straight down to the floor.' },
  bodyRise: { what: 'How much room you need when you sit down.', where: 'Sit on a flat chair, then measure from your belt line down to the chair.' },
  upperbodyHeight: { what: 'How long your top half is.', where: 'From the top of your head down to your belt line.' },
  lowerbodyHeight: { what: 'How long your bottom half is.', where: 'From your belt line down to the floor.' },
  cuffShirts: { what: 'How big around a shirt cuff should be.', where: 'Your wrist, plus a little room so your hand slides through.' },
  trouserBottom: { what: 'How wide the bottom of a trouser leg is.', where: 'Across the bottom of one trouser leg, laid flat.' },
  crotchLength: { what: 'How long your trousers are at the crotch.', where: 'Sitting down: from your belt line at the front, under you, to your belt line at the back.' },
  dart: { what: 'How much the front needs shaping.', where: 'The difference between your chest and your waist.' },
};

/**
 * Show the box for one card. A message box pinned to the bottom of the screen
 * rather than a tooltip, because a tooltip on a phone lands under your thumb.
 * The card it belongs to stays marked while it is open, so it is always clear
 * which number is being explained.
 */
let tipClosing = null;
let tipCard = null;

function showTip(item, cell = null) {
  const info = ABOUT[item.key] || {};
  tipTitle.textContent = item.label;
  tipValue.textContent = `${item.in} in · ${item.cm} cm`;
  tipWhat.textContent = info.what || 'A measurement read from your video.';
  tipWhere.textContent = info.where || '';
  tipWhere.hidden = !info.where;
  // Reopening while the last one is still fading has to cancel the fade, or the
  // box would vanish underneath the new one.
  if (tipClosing) { clearTimeout(tipClosing); tipClosing = null; }
  if (tipCard && tipCard !== cell) tipCard.classList.remove('picked');
  tipCard = cell;
  if (cell) cell.classList.add('picked');
  tipEl.classList.remove('closing');
  tipScrim.classList.remove('closing');
  tipEl.hidden = false;
  tipScrim.hidden = false;
}

function hideTip() {
  if (tipEl.hidden || tipClosing) return;
  tipEl.classList.add('closing');
  tipScrim.classList.add('closing');
  tipClosing = setTimeout(() => {
    tipEl.hidden = true;
    tipScrim.hidden = true;
    tipEl.classList.remove('closing');
    tipScrim.classList.remove('closing');
    if (tipCard) tipCard.classList.remove('picked');
    tipCard = null;
    tipClosing = null;
  }, 220);
}

/**
 * Give a card its long press: hold with a mouse, or touch and hold on a phone.
 * Also Enter or Space when it is focused, so it works without a pointer.
 */
function wireCard(cell, item) {
  let timer = null;
  const open = () => { timer = null; cell.classList.remove('holding'); showTip(item, cell); };
  cell.addEventListener('pointerdown', (e) => {
    if (Number.isFinite(e.button) && e.button > 0) return;
    if (timer) clearTimeout(timer);
    // Light the card up for the whole hold: the wait for 320 ms should be
    // something you can watch, not something you have to trust.
    cell.classList.add('holding');
    timer = setTimeout(open, 320);
  });
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    cell.classList.remove('holding');
  };
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cell.addEventListener(ev, cancel);
  // A long press on a phone otherwise selects the text or opens the copy menu.
  cell.addEventListener('contextmenu', (e) => e.preventDefault());
  cell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTip(item, cell); }
  });
  // The light that follows the pointer, so the card feels like a surface under
  // the cursor rather than a picture of one.
  cell.addEventListener('pointermove', (e) => {
    const r = cell.getBoundingClientRect();
    cell.style.setProperty('--mx', `${e.clientX - r.left}px`);
    cell.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

// Tapping or clicking anywhere else closes the box. The press that OPENS it
// happens before the box exists, so this cannot swallow the opening press.
document.addEventListener('pointerdown', (e) => {
  if (!captureChoice.hidden && !captureEl.contains(e.target)) setChoice(false);
  if (tipEl.hidden || tipEl.contains(e.target)) return;
  hideTip();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  hideTip();
  setChoice(false);
});

/**
 * The order the numbers are shown in, and why: three questions a person
 * actually asks — how big around am I, how long am I, what does a pattern need.
 * A flat grid of fourteen equal cards answers none of them until you read all of
 * it.
 *
 * Round and across are one group on purpose: "how wide am I" is not a separate
 * question from "how big around am I", it is the same one answered from the
 * front instead of from the side, and splitting them made people read two
 * headings to find one body.
 */
const GROUPS = [
  {
    title: 'Around your body',
    note: 'around you, and straight across you',
    keys: ['head', 'neck', 'bust', 'chest', 'waist', 'lowWaist', 'hips', 'topArm', 'elbow', 'wrist', 'knee', 'calf', 'highAnkle', 'ankle', 'shoulder', 'backWidth'],
  },
  {
    title: 'How long things are',
    note: 'shoulder to wrist, waist to floor',
    keys: ['sleeveLength', 'napeToWaist', 'shoulderToWaist', 'armholeDepth', 'waistToKnee', 'waistToHip', 'waistToFloor', 'bodyRise', 'upperbodyHeight', 'lowerbodyHeight'],
  },
  {
    title: 'Cuffs and trouser bottoms',
    note: 'the numbers a pattern asks for',
    keys: ['cuffShirts', 'trouserBottom', 'crotchLength', 'dart'],
  },
];

/**
 * Numbers that arrive instead of appearing.
 *
 * The values are already correct on the page before this runs, and it starts on
 * the card's own entrance animation rather than on a duplicated timer, so the
 * count can never disagree with the card it belongs to. If a frame is dropped, a
 * tab is backgrounded or the browser never paints again, the safety net writes
 * the real number back: a decoration must not be able to leave a wrong one behind.
 */
function countOnEnter(cell, inNode, cmNode, item) {
  if (!MOTION_OK) return;
  const finish = () => {
    inNode.textContent = String(item.in);
    cmNode.textContent = `${item.cm} cm`;
  };
  cell.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'card-in') return;
    const dur = 700;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      inNode.textContent = (item.in * eased).toFixed(1);
      cmNode.textContent = `${(item.cm * eased).toFixed(1)} cm`;
      if (p < 1) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
    setTimeout(finish, dur + 600);
  }, { once: true });
}

/**
 * The catalogue: every category this clip actually showed, in the group the
 * user picked, laid out in the order someone would measure themselves. The list
 * IS the answer, so a category the video never contained is not listed at all —
 * no blank rows, no "not measured" placeholders.
 */
function renderMeasures(data) {
  measureGroups.replaceChildren();
  const items = data.catalogue?.items || [];

  if (!items.length) {
    measuresLead.textContent = 'Nothing in this clip could be measured.';
    return;
  }
  measuresLead.textContent = `Hold any number to see what it is. ${items.length} of them came off your clip.`;

  // Only the groups this clip actually filled, in the order above, with
  // anything unrecognised kept rather than dropped.
  const buckets = [...GROUPS, { title: 'Also measured', note: '', keys: [] }]
    .map((g) => ({ ...g, items: [] }));
  for (const item of items) {
    const bucket = buckets.find((b) => b.keys.includes(item.key)) || buckets[buckets.length - 1];
    bucket.items.push(item);
  }

  let i = 0;
  let groupIndex = 0;
  for (const bucket of buckets) {
    if (!bucket.items.length) continue;

    const section = el('section', 'group');
    section.style.setProperty('--gi', String(groupIndex));
    groupIndex += 1;
    const head = el('div', 'group-head');
    // Title, count, then note: the count shares the title's row and the note
    // falls to its own — as flex the note got squeezed to one word per line.
    head.append(el('h2', 'group-title', bucket.title));
    head.append(el('span', 'group-count', `${bucket.items.length}`));
    if (bucket.note) head.append(el('span', 'group-note', bucket.note));
    section.append(head);

    const grid = el('div', 'measure-grid');
    for (const item of bucket.items) {
      const cell = el('div', 'measure');
      cell.tabIndex = 0;
      cell.style.setProperty('--i', String(i));
      i += 1;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${item.label}, ${item.in} inches. Hold for what this is.`);
      const line = el('span', 'measure-line');
      const inNode = el('span', 'measure-value', String(item.in));
      const cmNode = el('span', 'measure-cm', `${item.cm} cm`);
      line.append(inNode, el('span', 'measure-unit', 'in'));
      cell.append(el('span', 'measure-label', item.label), line, cmNode);
      wireCard(cell, item);
      countOnEnter(cell, inNode, cmNode, item);
      grid.append(cell);
    }
    section.append(grid);
    measureGroups.append(section);
  }
}

function renderNotes(data) {
  notesEl.replaceChildren();
  for (const note of data.notes || []) {
    if (!showNote(note)) continue;
    notesEl.append(el('li', 'note', note));
  }
}

function renderAnalysis(data) {
  renderFacts(data);
  renderMeasures(data);
  renderNotes(data);
  renderSeen(lastSeen, { note: lastSeenNote, open: lastSeenOpen });
  // Restart the entrance: the cards are new elements and animate on their own,
  // but the heading and the chips are the same nodes as last time, so the class
  // has to be dropped and forced back on for them to run again.
  analysis.classList.remove('results-in');
  void analysis.offsetWidth;
  analysis.classList.add('results-in');
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
            // The user's own known size, if they marked one. It is the strongest
            // anchor there is, and it is applied across the whole clip.
            references: markedReference ? [markedReference] : [],
            // Fabric does not leave the numbers unless it is named.
            clothing: readClothing(),
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
for (const el of inputs) {
  el.addEventListener('change', () => {
    const file = el.files && el.files[0];
    // Dismissing the picker is not an error: nothing was chosen, so nothing is
    // said about it.
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setStatus('That file is not a video.', 'error');
      el.value = '';
      return;
    }
    handleRecording(file);
  });
}

openCamera.addEventListener('click', () => setChoice(captureChoice.hidden));

analyzeBtn.addEventListener('click', runAnalysis);
for (const btn of whoButtons) {
  btn.addEventListener('click', () => setGender(btn.dataset.gender));
}
startOverTrim.addEventListener('click', resetAll);
retakeBtn.addEventListener('click', resetAll);
startOverBtn.addEventListener('click', resetAll);

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
        { key: 'head', label: 'Head', in: 22.2, cm: 56.3, how: '5.9" across x 8.1" deep (1.38x width) -> a tape of 22.2" around it' },
        { key: 'neck', label: 'Neck Size', in: 14.1, cm: 35.8, how: '4.7" across x 4.3" deep (side view x2) -> a tape of 14.1" around it' },
        { key: 'chest', label: 'Chest', in: 40.2, cm: 102.1, how: '11.0" across x 9.7" deep (side view x2) -> a tape of 40.2" around it' },
        { key: 'waist', label: 'Waist', in: 29.1, cm: 74.0, how: '10.2" across x 7.3" deep (side view x2) -> a tape of 29.1" around it' },
        { key: 'hips', label: 'Hip/Seat', in: 35.3, cm: 89.7, how: '12.0" across x 8.5" deep (side view x2) -> a tape of 35.3" around it' },
        { key: 'shoulder', label: 'Shoulder', in: 18.3, cm: 46.5, how: '18.3" across the shoulders, from 3 frames' },
        { key: 'backWidth', label: 'Back Width', in: 18.0, cm: 45.7, how: '18.0" across your back at armpit level, from 2 frames' },
        { key: 'napeToWaist', label: 'Nape to waist', in: 17.4, cm: 44.2, how: '17.4" from the nape of your neck to your waist line, from 4 frames' },
        { key: 'sleeveLength', label: 'Sleeve Length', in: 24.1, cm: 61.2, how: '24.1" from the shoulder point, through the elbow, to the wrist bone, from 3 frames' },
        { key: 'waistToKnee', label: 'Waist to Knee', in: 22.4, cm: 56.9, how: '22.4" from your waist line to your knee, from 4 frames' },
        { key: 'waistToFloor', label: 'Waist to Floor', in: 41.4, cm: 105.2, how: '41.4" from your waist line to the floor, from 4 frames' },
        { key: 'calf', label: 'Calf', in: 15.3, cm: 38.9, how: '5.0" across x 4.8" deep (0.95x width, modelled) -> a tape of 15.3" around it' },
        { key: 'ankle', label: 'Ankle', in: 9.1, cm: 23.2, how: '3.0" across x 2.9" deep (0.95x width, modelled) -> a tape of 9.1" around it' },
      ],
    },
    geometry: {
      aspect: 0.75,
      scale: { cmPerImageWidth: 185.53, anchors: ['23.5 cm head'] },
      methods: {},
      height: { in: 71.1, headUnits: 7.5, views: 4, spread: 0.4 },
    },
    notes: [
      'Your feet were not in shot, so nothing that needs the floor could be read.',
    ],
    views: ['front', 'three-quarter', 'side', 'back', 'side', 'front'],
  });
}
