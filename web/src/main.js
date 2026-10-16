/* Camera record — click opens camera, records video, stores Blob momentarily */

const app = document.getElementById('app');
const title = document.getElementById('title');
const instructions = document.getElementById('instructions');
const cameraBox = document.getElementById('camera-box');
const cameraView = document.getElementById('camera-view');
const cameraVideo = document.getElementById('camera-video');
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const cameraStatus = document.getElementById('camera-status');
const result = document.getElementById('result');
const resultText = document.getElementById('result-text');
const retakeBtn = document.getElementById('retake-btn');

let stream = null;
let mediaRecorder = null;
let chunks = [];
let recordedBlob = null;

function showCamera() {
  cameraBox.hidden = true;
  title.hidden = true;
  instructions.hidden = true;
  cameraView.hidden = false;
}

function showResult() {
  cameraView.hidden = true;
  result.hidden = false;
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'environment' },
      audio: false,
    });
    cameraVideo.srcObject = stream;
    await new Promise((r) => { cameraVideo.onloadedmetadata = r; });
  } catch (e) {
    cameraStatus.textContent = 'Camera access failed: ' + e.message;
    cameraStatus.style.color = '#ff5470';
  }
}

async function startRecording() {
  chunks = [];
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp8',
    videoBitsPerSecond: 2_500_000,
  });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(chunks, { type: 'video/webm' });
    cameraStatus.textContent = 'Recording saved (' + Math.round(recordedBlob.size / 1024) + ' KB)';
    showResult();
  };
  mediaRecorder.start(1000);
  recordBtn.hidden = true;
  stopBtn.hidden = false;
  cameraStatus.textContent = 'Recording…';
  cameraStatus.style.color = '#ff5470';

  // Auto-stop after 30 seconds
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }, 30_000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  recordBtn.hidden = false;
  stopBtn.hidden = true;
}

cameraBox.addEventListener('click', async () => {
  showCamera();
  await startCamera();
});

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', () => {
  stopRecording();
  showResult();
});

retakeBtn.addEventListener('click', () => {
  recordedBlob = null;
  result.hidden = true;
  cameraBox.hidden = false;
  title.hidden = false;
  instructions.hidden = false;
});
