/**
 * Body scan UI: record a video of yourself turning around, get AI-estimated
 * body measurements and a recommended clothing size, optionally apply to the
 * 3D mannequin.
 *
 * Flows into the fitting-room panel as a "Scan my body" card, and opens a
 * modal with camera recording + results.
 */
import { BodyRecorder } from './recorder.js';
import { chestLabel } from './size-chart.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Build the "Scan my body" card for the fitting-room panel.
 * @param o { sex, onApply(sizeKey, measurements), toast(msg, type), apiUrl }
 */
export function buildBodyScanCard({ sex, onApply, toast, apiUrl }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.cssText = 'border:1px solid var(--line-2);border-radius:var(--radius);background:var(--card);padding:16px;display:flex;flex-direction:column;gap:12px;';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
  const title = document.createElement('b');
  title.textContent = 'Scan my body';
  const sub = document.createElement('span');
  sub.style.cssText = 'font-size:11px;color:var(--muted);margin-left:auto;';
  sub.textContent = 'video → size estimate';
  head.append(title, sub);

  const desc = document.createElement('p');
  desc.style.cssText = 'font-size:12.5px;color:var(--muted);margin:0;line-height:1.4;';
  desc.textContent = 'Record yourself standing and slowly turning around. We estimate your chest, waist, hips and height, then recommend the best clothing size.';

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary grow';
  btn.textContent = 'Start body scan';
  btn.addEventListener('click', () => openScanModal({ sex, onApply, toast, apiUrl }));

  card.append(head, desc, btn);
  return card;
}

/** Open the body scan modal (camera + results). */
async function openScanModal({ sex, onApply, toast, apiUrl }) {
  const modal = document.createElement('dialog');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <b class="modal-title">Body scan</b>
        <button class="icon-btn" aria-label="Close">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;min-height:420px;">
        <div id="bs-camera" style="flex:1;background:#000;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">
          Click Start camera to begin
        </div>
        <div id="bs-controls" style="display:flex;gap:10;align-items:center;justify-content:center;flex-wrap:wrap;">
          <button id="bs-start" class="btn btn-primary">Start camera</button>
          <button id="bs-record" class="btn btn-primary" disabled>Record video</button>
          <button id="bs-stop" class="btn btn-danger" disabled hidden>Stop recording</button>
        </div>
        <div id="bs-progress" class="small" style="color:var(--muted);font-size:12px;display:none;">Processing frames…</div>
        <div id="bs-result" style="display:none;border:1px solid var(--line-2);border-radius:12px;background:var(--card);padding:14px;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <b>Estimated size</b>
            <span id="bs-size-chip" style="font-size:28px;font-weight:700;color:var(--accent);">—</span>
          </div>
          <p id="bs-measurements" style="font-size:12.5px;color:var(--muted);margin:0;"></p>
          <div id="bs-notes" style="font-size:12px;color:var(--text);"></div>
          <div id="bs-alt" style="font-size:11.5px;color:var(--muted);"></div>
          <button id="bs-apply" class="btn btn-primary grow" style="margin-top:8px;">Apply to my body</button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="bs-close">Close</button>
      </div>
    </div>
  `;

  const close = () => { modal.close(); modal.remove(); };
  modal.querySelector('#bs-close').addEventListener('click', close);
  modal.querySelector('[aria-label="Close"]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // ---- camera state ----
  let recorder = null;
  let videoEl = null;
  let recordedBlob = null;

  const cameraBox = modal.querySelector('#bs-camera');
  const startBtn = modal.querySelector('#bs-start');
  const recordBtn = modal.querySelector('#bs-record');
  const stopBtn = modal.querySelector('#bs-stop');
  const progress = modal.querySelector('#bs-progress');
  const resultBox = modal.querySelector('#bs-result');
  const sizeChip = modal.querySelector('#bs-size-chip');
  const measurementsEl = modal.querySelector('#bs-measurements');
  const notesEl = modal.querySelector('#bs-notes');
  const altEl = modal.querySelector('#bs-alt');
  const applyBtn = modal.querySelector('#bs-apply');

  const setBusy = (b) => {
    startBtn.disabled = b;
    recordBtn.disabled = b || !videoEl;
    stopBtn.disabled = b;
    progress.style.display = b ? '' : 'none';
    resultBox.style.display = 'none';
  };

  startBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      recorder = new BodyRecorder();
      videoEl = await recorder.start();
      cameraBox.innerHTML = '';
      cameraBox.appendChild(videoEl);
      startBtn.textContent = 'Restart camera';
      recordBtn.disabled = false;
      toast('Camera ready — record yourself turning around', 'info', 3000);
    } catch (e) {
      setBusy(false);
      toast('Camera access failed: ' + e.message, 'error', 6000);
      console.error(e);
    }
  });

  recordBtn.addEventListener('click', async () => {
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    stopBtn.hidden = false;
    recordBtn.textContent = 'Recording… (turn slowly)';
    try {
      recordedBlob = await recorder.stop();
    } catch (e) {
      // stop() resolves when stopped via stop button
    }
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    setBusy(true);
    recordBtn.textContent = 'Record video';
    try {
      recordedBlob = await recorder.stop();
    } catch (e) { /* already stopped */ }

    // Extract key frames
    try {
      const frames = await BodyRecorder.extractFrames(recordedBlob, 6);
      await runScan(frames, sex, apiUrl);
    } catch (e) {
      setBusy(false);
      toast('Frame extraction failed: ' + e.message, 'error', 6000);
      console.error(e);
    }
  });

  async function runScan(frames, sex, apiUrl) {
    const fd = new FormData();
    for (const f of frames) fd.append('frames', f, `frame-${Date.now()}.png`);
    fd.append('sex', sex);

    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/body-scan`, {
        method: 'POST',
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `scan failed (${res.status})`);
      showResult(body);
    } catch (e) {
      setBusy(false);
      toast('Scan failed: ' + e.message, 'error', 8000);
      console.error(e);
    }
  }

  function showResult(result) {
    setBusy(false);
    resultBox.style.display = 'flex';
    const size = result.size || '—';
    sizeChip.textContent = size;
    const m = result.measurements || {};
    const parts = [];
    if (m.chestIn) parts.push(`${chestLabel(sex)} ${m.chestIn.toFixed(0)}″`);
    if (m.waistIn) parts.push(`Waist ${m.waistIn.toFixed(0)}″`);
    if (m.hipsIn) parts.push(`Hips ${m.hipsIn.toFixed(0)}″`);
    if (m.heightIn) parts.push(`Height ${m.heightIn.toFixed(0)}″`);
    measurementsEl.textContent = parts.length ? parts.join(' · ') : 'Measurements estimated from ' + (result.frameCount || 0) + ' frames';

    const notes = (result.notes || []).map((n) => `<div style="font-size:12px;margin:2px 0;">• ${esc(n)}</div>`).join('');
    notesEl.innerHTML = notes || '<div style="font-size:12px;color:var(--muted);">No fit notes — measurements within standard range.</div>';

    const alts = (result.alternatives || []).slice(0, 2);
    altEl.innerHTML = alts.length ? `Also consider: ${alts.join(', ')}` : '';

    applyBtn.disabled = !size || size === '—';
    applyBtn.onclick = () => {
      if (!result.size) return;
      try {
        onApply(result.size, result.measurements);
        toast(`Applied size ${size} to your body`);
        close();
      } catch (e) {
        toast('Could not apply size: ' + e.message, 'error', 6000);
      }
    };
  }

  modal.showModal();
}
