/* =========================================================
   3dGarments — Find your size
   Tapping the camera box opens the phone's NATIVE camera app
   (via <input type="file" accept="video/*" capture>), records a
   video, and holds it in memory momentarily.
   ========================================================= */

const MAX_SECONDS = 30;

const openCamera = document.querySelector('.open-camera');
const input = document.getElementById('video-input');
const result = document.getElementById('result');
const preview = document.getElementById('preview');
const resultText = document.getElementById('result-text');
const retakeBtn = document.getElementById('retake-btn');
const statusEl = document.getElementById('status');

/** The recorded video, held in memory while the user is on the page. */
let recordedBlob = null;
let previewUrl = null;

function setStatus(message, kind = '') {
  statusEl.textContent = message || '';
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function showResult() {
  openCamera.hidden = true;
  result.hidden = false;
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
  openCamera.hidden = false;
  setStatus('');
}

/** Read the duration of a video blob without keeping it in the DOM. */
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

async function handleRecording(file) {
  recordedBlob = file;
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;

  const kb = Math.max(1, Math.round(file.size / 1024));
  const sizeText = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
  resultText.textContent = 'Video captured · ' + sizeText;

  showResult();
  setStatus('Loading video…');

  const seconds = await readDuration(file);
  if (seconds == null) {
    setStatus('Video captured and held in memory.', 'ok');
  } else if (seconds > MAX_SECONDS + 1) {
    setStatus(
      'That clip is ' + Math.round(seconds) + 's — over the 30s limit. Record again if you can.',
      'error'
    );
  } else {
    setStatus('Looks good — held in memory.', 'ok');
  }
}

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

retakeBtn.addEventListener('click', resetToCamera);

// Icon has role="button": let Enter / Space open the camera too.
openCamera.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    input.click();
  }
});

// If the tab is closed/navigated away, release the object URL.
window.addEventListener('pagehide', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
