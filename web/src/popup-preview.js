/**
 * The popup, as seen from the dashboard's "Preview & Customise Popup".
 *
 * The frame is this same page with ?embed=1&preview=...; the dashboard sends it the
 * settings being edited (not the saved ones) as the store drags a slider, and this draws
 * them with the very code a shopper's popup uses. It is loaded only in that frame.
 */
import { applyPopupConfig } from './popup-config.js';

export function startPreview(phase) {
  document.body.classList.add('pu-preview');

  // A picture of the popup: pressing "Click to Record" in it must not open a camera or a file picker.
  document.addEventListener('click', (event) => {
    if (event.target.closest('label, input[type="file"], .capture-btn, #open-camera, #capture-choice button')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.source !== '3dg-preview') return;
    if (message.type === 'config') applyPopupConfig(message.config);
  });

  // The dashboard waits for this before it sends anything.
  window.parent.postMessage({ source: '3dg-preview', type: 'ready', phase }, location.origin);
}
