/* =========================================================
   3dGarments — Find your size
   1. Tap the camera icon -> the phone's NATIVE camera app records a video.
   2. Trim the clip's LENGTH to the part where you turn around.
   3. Send it. The CLIP goes to the server, and the server takes the stills out
      of it and reads them — the phone does no decoding, no seeking and no
      canvas work. Every centimetre after that is arithmetic on the server too.
      Nothing is stored: the clip is deleted the moment it has been measured.
      ?local=1 is the other way round — the pose model measures on the device
      and only numbers travel (imported dynamically, so a normal visit never
      even parses that code). ?frames=1 sends 12 stills instead of the clip.
   ========================================================= */

import { extractFrames, extractPoster, readDuration } from './body-scan/frames.js';
import { analyzeBody, analyzeGeometry, analyzeVideo } from './body-scan/analyze.js';
import { createTrimmer } from './body-scan/trim.js';
import { createCalibrator } from './body-scan/calibrate.js';
import { showNote } from './body-scan/notes.js';
import { chartByCode, chartColumns } from './services/charts.js';

const params = new URLSearchParams(location.search);

/**
 * ?local=1 — measure with the pose model on the device instead of on the server.
 * The server path is the default: a phone that has to fetch and run a 9 MB pose
 * model is a phone that hangs, and a shopper on a mid-range Android should never
 * be asked to do that. Only still frames travel, and only six of them.
 */
const local = params.get('local') === '1';

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

const garmentEl = document.getElementById('garment');
const verdictEl = document.getElementById('verdict');
const verdictEyebrow = document.getElementById('verdict-eyebrow');
const verdictSize = document.getElementById('verdict-size');
const verdictFor = document.getElementById('verdict-for');
const verdictRow = document.getElementById('verdict-row');
const verdictNote = document.getElementById('verdict-note');

const statusEl = document.getElementById('status');

const log = (...args) => console.log('[3dg]', ...args);

/* ---------- the garment in a store's link ---------- */
/**
 * ?g=CODE — the size chart of the garment this shopper followed a link to.
 *
 * The fetch starts here and is only waited on when a scan is actually sent: the
 * scanner has to be usable the moment it opens, and a chart that arrives a moment
 * later is still a chart that arrives. Until it does, the page says nothing about
 * a garment at all — it never claims to be sizing for something it has not read.
 */
const chartCode = (new URLSearchParams(location.search).get('g') || '').trim();
const garmentPromise = chartCode
  ? chartByCode(chartCode).catch((e) => {
    log('the size chart in this link could not be read:', e.message);
    return null;
  })
  : Promise.resolve(null);
/** The chart once it has arrived, or null. Read at send time, not at load time. */
let garment = null;

if (chartCode) {
  garmentPromise.then((chart) => {
    garment = chart;
    applyChartSex(chart);
    if (!garmentEl) return;
    garmentEl.hidden = false;
    garmentEl.classList.toggle('garment-missing', !chart);
    garmentEl.textContent = chart
      ? `Sizing for ${chart.name}.`
      : 'That size-chart link could not be read — you can still measure yourself.';
  });
}

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
 * Who the video is of. The scanner never asks: a store's chart says who it is
 * cut for, and where nothing says, the server reads the size off the body
 * proportions and says in so many words that it did.
 */
let chosenGender = 'unsure';

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

/** Analyze is live as soon as there is a clip to read and nothing is running. */
function updateAnalyzeEnabled() {
  analyzeBtn.disabled = analyzing || !recordedBlob;
}

/**
 * A store's chart says who it is cut for, so the chart's sex is the measuring
 * constant, the sheet and the category group — the shopper is never asked. A
 * chart with no sex (unisex) or no chart at all leaves it unset, and then the
 * server scores both built-in sheets against the body and reports the one it
 * used rather than pretending nobody chose.
 */
function applyChartSex(chart) {
  const sex = chart && chart.sex;
  if (sex === 'male' || sex === 'female') chosenGender = sex;
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

/* ---------- reset ---------- */
function resetAll() {
  releaseMedia();
  recordedBlob = null;
  updateAnalyzeEnabled();
  for (const el of inputs) el.value = '';
  trimmer.load(0);
  calibrator.clear();
  setBusy(false);
  setStatus('');
  trimNote.textContent = '';
  if (verdictEl) verdictEl.hidden = true;
  show('camera');
}

/* ---------- after recording: show the trim step ---------- */
async function handleRecording(file) {
  recordedBlob = file;
  updateAnalyzeEnabled();
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
  sleeveLength: { what: 'How long a sleeve has to be.', where: 'From the nape of your neck, out over your shoulder point, down through a slightly bent elbow, to your wrist bone. This is how a shirt chart measures it.' },
  armLength: { what: 'How long your arm is, without the shoulder.', where: 'From your shoulder point, through a slightly bent elbow, down to your wrist bone. Shorter than the sleeve length by the run across your shoulder.' },
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
    keys: ['sleeveLength', 'armLength', 'napeToWaist', 'shoulderToWaist', 'armholeDepth', 'waistToKnee', 'waistToHip', 'waistToFloor', 'bodyRise', 'upperbodyHeight', 'lowerbodyHeight'],
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

/**
 * The size the shopper came for, when the scan was scored against a store's own
 * chart.
 *
 * It is not shown on the plain scanner at all: that page is a tape measure, and a
 * size off a chart the visitor never asked about would be an answer to a question
 * nobody put. When a chart WAS read and still no size came back, the card says so
 * plainly rather than leaving the shopper to notice a missing row.
 */
function renderVerdict(data) {
  if (!verdictEl) return;
  if (!garment) {
    verdictEl.hidden = true;
    return;
  }
  const size = data.sizeSource === 'store' ? data.size : null;
  const name = data.sizeName || garment.name || '';
  const cols = chartColumns(garment);
  const from = cols.length ? `your ${cols.map((c) => c.label.toLowerCase()).join(', ')}` : 'your measurements';

  verdictEl.hidden = false;
  verdictEl.classList.toggle('verdict-none', !size);
  verdictEyebrow.textContent = size ? 'Your size' : 'No size from this clip';
  verdictSize.textContent = size || '';
  verdictFor.textContent = name ? `for ${name}` : '';
  verdictNote.textContent = size
    ? `Worked out from ${from} against this garment's own chart, not a standard one.`
    : `This clip did not show a straight-on front view with your arms clear of your sides, so there was nothing to work a size out from${name ? ` for ${name}` : ''}.`;

  // The row that was handed to them, in the store's own numbers and words. The
  // extra columns a store added are the reason this line exists: a shoulder or a
  // body length it prints belongs beside the size, whether or not it was scored.
  if (verdictRow) {
    const typed = size && Array.isArray(garment.rows)
      ? garment.rows.find((r) => String(r?.key) === String(size))
      : null;
    const stored = data.sizeChart || {};
    const unit = typed ? (garment.unit === 'cm' ? 'cm' : 'in') : 'in';
    const printed = (Array.isArray(garment.columns) ? garment.columns : [])
      .map((column) => ({
        label: column?.label || '',
        value: typed && Number.isFinite(Number(typed[column.id])) ? typed[column.id] : stored[column?.id],
      }))
      .filter((c) => c.label && Number.isFinite(Number(c.value)) && String(c.value ?? '') !== '');
    verdictRow.hidden = !printed.length;
    verdictRow.textContent = printed.map((c) => `${c.label} ${Number(c.value)} ${unit}`).join(' \u00b7 ');
  }
}

function renderAnalysis(data) {
  renderFacts(data);
  renderMeasures(data);
  renderNotes(data);
  renderVerdict(data);
  // Restart the entrance: the cards are new elements and animate on their own,
  // but the heading and the chips are the same nodes as last time, so the class
  // has to be dropped and forced back on for them to run again.
  analysis.classList.remove('results-in');
  void analysis.offsetWidth;
  analysis.classList.add('results-in');
  show('result');
}

/** Milliseconds on the clock, for the status line. */
const since = (t0) => `${Math.max(0, Math.round((Date.now() - t0) / 1000))}s`;

/**
 * ?local=1 only. The on-device stack is ~9 MB of weights plus the wasm runtime,
 * fetched from two CDNs, and starting it takes seconds even on a fast phone —
 * which is exactly why it is no longer the default. When it has been asked for,
 * it is started while the shopper is still recording rather than at Analyze.
 *
 * The module is imported here, not at the top of the file, so a normal visit
 * never downloads, parses or holds any of it.
 */
let warmPose = null;
function warmMeasurement() {
  if (warmPose) return warmPose;
  warmPose = import('./body-scan/pose.js')
    .then(({ loadPoseEngine }) => loadPoseEngine({ onProgress: (m) => log(m) }))
    .then((engine) => { log('measurement model ready:', engine.model); return engine; })
    .catch((e) => { log('measurement model could not be warmed:', e.message); return null; });
  return warmPose;
}

async function runAnalysis() {
  if (analyzing || !recordedBlob) return;
  setBusy(true);
  setStatus('Starting the measurement…', 'busy');
  const startedAt = Date.now();
  /** Where the numbers were read, said on the results line. */
  let measuredOn = 'the server';

  try {
    const { from, to, fromSec, toSec } = trimmer.getSpan();
    log('analyze start', { bytes: recordedBlob.size, type: recordedBlob.type, from: fromSec, to: toSec });

    // The store's own chart, if a scan is going to be scored against one. Waited
    // for here rather than at page load: it has had the whole recording to arrive,
    // so this costs nothing in practice.
    const chart = garment || (await garmentPromise);
    if (chartCode) log('sizing against', chart ? `${chart.name} (${chart.rows.length} sizes)` : 'the reference chart — the link could not be read');

    // 1. The default: still frames for the server's vision model, which reads
    //    the joints off them and hands them to the same deterministic engine.
    //    Nothing but a few JPEGs runs on the phone.
    //
    //    ?local=1 is the other way round — the pose model measures on the device
    //    and only numbers travel. It is opt-in, because fetching and running a
    //    9 MB model is a lot to ask of the phone a shopper is holding.
    let data = null;
    if (local) {
      measuredOn = 'this phone';
      try {
        const { analyzePose } = await import('./body-scan/pose.js');
        // A full turn in twelve views at 640 px: the widths that matter are
        // still seen from every side, and the server checks the frames against
        // each other, so this is a little coarser sampling for a much shorter
        // wait than sixteen at 720.
        const measured = await analyzePose(recordedBlob, {
          count: 12,
          from,
          to,
          maxWidth: 640,
          gender: chosenGender,
          onProgress: (msg) => setStatus(`${msg} · ${since(startedAt)}`, 'busy'),
        });
        log('on-device measurement', measured);
        if (measured.frames.length) {
          // A chest is the one measurement a size cannot be worked out without,
          // and the one thing a clip standing still can get wrong: arms pressed
          // against the ribs sit in front of the torso, so nothing in the picture
          // says where the torso ends. That is not guessable, so stop here and say
          // exactly what to change rather than spend a round trip on a blank.
          const anyChest = measured.frames.some((f) => f.landmarks && f.landmarks.armpitL != null);
          if (!anyChest) {
            log('no frame gave a chest measurement — asking for a retake');
            setStatus('We could not measure your chest: your arms were against your sides in every frame, so there is no way to tell your torso from your arms. Stand with your arms a little away from your body and record again — that one change is what gives you a size.', 'error');
            setBusy(false);
            return;
          }
          setStatus(`Sending ${measured.frames.length} measurements… · ${since(startedAt)}`, 'busy');
          data = await analyzeGeometry(measured, {
            gender: chosenGender,
            // The garment the shopper followed a link to, when there is one: the
            // size they are shown is the size of the thing they want to buy.
            chart,
            // The user's own known size, if they marked one. It is the strongest
            // anchor there is, and it is applied across the whole clip.
            references: markedReference ? [markedReference] : [],
            // Nothing is said about what was worn, so nothing is taken off for
            // it: better a number with the t-shirt still in it than a guess
            // subtracted from every girth.
            clothing: {},
            onTick: (s) => setStatus(`Working out your measurements… ${s}s`, 'busy'),
          });
        } else {
          log('on-device measurement found no usable frame — falling back to the vision model');
        }
      } catch (e) {
        log('on-device measurement failed — falling back to the vision model:', e.message);
      }
    }

    // 2. The default: the clip itself goes to the server, which takes the stills
    //    out of it and reads them. The phone does nothing here — no decode, no
    //    seek, no canvas — which is exactly what a WebView is worst at and a
    //    server is best at. `?frames=1` forces the old still-frame path (and is
    //    the automatic fallback if the clip cannot be uploaded or read).
    if (!data) {
      measuredOn = 'the server';

      // A phone's own camera writes 30-40 MB for half a minute — ten times what
      // the same clip becomes on WhatsApp — and on a shopper's uplink that is
      // minutes, not seconds. One real scan spent 215 s with the bar still
      // climbing, so the clip is now only offered when it can plausibly be up
      // in a few seconds. `analyzeVideo` measures the upload as it goes and
      // abandons it when it cannot finish inside UPLOAD_BUDGET_MS; a dozen key
      // frames (about 600 KB) then go instead: the same turn, the same
      // measurement, a fraction of the wire.
      const UPLOAD_LIMIT = 80 * 1024 * 1024;
      const UPLOAD_BUDGET_MS = 10000;
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const slowLink = Boolean(conn) && (conn.saveData === true || /(^|-)(2g|3g)$/.test(String(conn.effectiveType || '')));
      const worthSending = recordedBlob.size <= UPLOAD_LIMIT && !(slowLink && recordedBlob.size > 3 * 1024 * 1024);
      const mb = (recordedBlob.size / 1048576).toFixed(1);
      if (!params.has('frames') && worthSending) {
        try {
          setStatus(`Sending your clip (${mb} MB)… · ${since(startedAt)}`, 'busy');
          data = await analyzeVideo(recordedBlob, {
            from: fromSec,
            to: toSec,
            gender: chosenGender,
            chart,
            uploadBudgetMs: UPLOAD_BUDGET_MS,
            onProgress: (f) => setStatus(`Sending your clip (${mb} MB)… ${Math.round(f * 100)}% · ${since(startedAt)}`, 'busy'),
            onUploaded: () => setStatus(`Clip sent — reading it on the server… · ${since(startedAt)}`, 'busy'),
            onTick: (s) => setStatus(`Reading your clip on the server… ${s}s`, 'busy'),
          });
        } catch (e) {
          if (e.slowUpload) {
            log(`the clip is too big for this connection (${(e.bps / 1024).toFixed(0)} KB/s) — sending key frames instead`);
            setStatus('This connection cannot take the whole clip quickly, so key frames are going instead — the same turn, the same measurement.', 'busy');
          } else {
            log('the clip could not be read — falling back to still frames:', e.message);
            // A spent allowance or a rejected key is not a reason to try the
            // same service twelve more times; it is the answer, and it is worth
            // saying now rather than a minute later.
            if (/^The measuring service/.test(e.message)) throw e;
          }
          data = null;
        }
      }
      if (!data) {
        setStatus(`Grabbing key frames from your clip… · ${since(startedAt)}`, 'busy');
        let frames;
        try {
          // Eight, and not twelve, because the server reads eight at a time:
          // a twelfth frame is a SECOND wave of vision calls, which doubles the
          // wait to buy 7° of angle the cos-correction already handles. Eight
          // samples over a turn are 45° apart, worst case 22.5° off square-on,
          // and the frame carries its own turn angle for the geometry to undo.
          frames = await extractFrames(recordedBlob, { count: 8, from, to });
        } catch (e) {
          log('frame extraction failed — falling back to a single frame:', e.message);
          const poster = await extractPoster(recordedBlob, { maxWidth: 900, grid: true });
          frames = [new File([poster.blob], 'frame-0.jpg', { type: 'image/jpeg' })];
        }
        log('frames ready', frames.length, frames.reduce((s, f) => s + f.size, 0), 'bytes');

        // The tick keeps the status moving so it never looks frozen.
        setStatus(`Analyzing ${frames.length} frames on the server… ${since(startedAt)}`, 'busy');
        data = await analyzeBody(frames, {
          gender: chosenGender,
          chart,
          onTick: (s) => setStatus(`Analyzing ${frames.length} frames on the server… ${s}s`, 'busy'),
        });
      }
    }

    log('analysis result', data);
    renderAnalysis(data);
    setStatus(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s · measured on ${measuredOn}`, 'ok');
  } catch (e) {
    log('analyze failed:', e.message);
    setStatus(e.message || 'Something went wrong during analysis.', 'error');
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
startOverTrim.addEventListener('click', resetAll);
retakeBtn.addEventListener('click', resetAll);
startOverBtn.addEventListener('click', resetAll);

window.addEventListener('pagehide', releaseMedia);

// ?local=1 only: fetch and start the on-device measurement stack while the
// shopper is still reading the screen and recording, rather than at Analyze.
// The default path runs no model here at all, so there is nothing to warm.
if (local && !params.has('demo')) {
  setTimeout(warmMeasurement, 700);
}

/**
 * ?demo=1 — render a canned analysis so the results screen can be seen and
 * checked without recording a video. Local only; it touches no network.
 */
if (new URLSearchParams(location.search).has('demo')) {
  // ?demo=1&store=1 — the same results screen with a store's own chart behind it
  // and a size card on it, so that half of the page can be checked without a
  // link, a video, or a cloud.
  const demoStore = new URLSearchParams(location.search).has('store');
  if (demoStore) {
    garment = {
      name: 'Oxford Shirt',
      sex: 'male',
      unit: 'in',
      columns: [
        { id: 'col1', label: 'Chest', measure: 'chest' },
        { id: 'col2', label: 'Waist', measure: 'waist' },
        { id: 'col3', label: 'Hips', measure: 'hips' },
      ],
      rows: [
        { key: 'S', col1: 36, col2: 30, col3: 38 },
        { key: 'M', col1: 40, col2: 34, col3: 40 },
        { key: 'L', col1: 44, col2: 38, col3: 44 },
      ],
    };
    if (garmentEl) {
      garmentEl.hidden = false;
      garmentEl.textContent = 'Sizing for Oxford Shirt.';
    }
  }
  renderAnalysis({
    size: 'M',
    sizeBasis: 'male',
    sizeSource: demoStore ? 'store' : 'reference',
    sizeName: demoStore ? 'Oxford Shirt' : null,
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
        { key: 'sleeveLength', label: 'Sleeve Length', in: 33.3, cm: 84.6, how: '33.3" from the nape of your neck, out over your shoulder point, through your elbow, to your wrist bone, from 3 frames' },
        { key: 'armLength', label: 'Arm (shoulder to wrist)', in: 24.1, cm: 61.2, how: '24.1" from your shoulder point, through your elbow, to your wrist bone, from 3 frames' },
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
