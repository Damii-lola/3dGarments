/**
 * The store page behind the customiser's "Phase 0": a plain product page with the
 * FindMySize button on it, drawn by the real embed.js from the settings the dashboard
 * sends as they are edited — so the button seen here is the one a store ships.
 *
 * A module rather than an inline script because the site's content-security policy
 * (script-src 'self') blocks inline ones, and the script's address is built from the
 * site's base path because the site is served from /3dGarments/ on GitHub Pages.
 */
import { buttonAttributes, normalizePopup } from './popup-config.js';

const inlineSlot = document.getElementById('inline-slot');

let embed = null;
const ready = new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = `${import.meta.env.BASE_URL}embed.js`;
  script.onload = () => resolve(window.ThreeDG);
  script.onerror = () => resolve(null);
  document.body.appendChild(script);
});

/** Draw the button the way `popup.button` says (and nowhere else: the page is a picture). */
async function draw(rawConfig) {
  embed = embed || await ready;
  if (!embed) return;
  const { button } = normalizePopup(rawConfig);
  // Only what the snippet would carry: the default button is drawn by embed.js's own default.
  const attrs = buttonAttributes(rawConfig);
  document.querySelectorAll('.threeDG-float').forEach((el) => el.remove());
  inlineSlot.replaceChildren();
  embed.mount(button.float ? null : inlineSlot, {
    // no code: pressing it does nothing here (the popup is previewed in the other two phases)
    code: '',
    label: button.label,
    color: attrs['data-color'] || '',
    textColor: attrs['data-text-color'] || '',
    radius: attrs['data-radius'] || '',
    side: button.side,
    float: button.float,
  });
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const message = event.data;
  if (message && message.source === '3dg-preview' && message.type === 'config') draw(message.config);
});

// Drawn once with the defaults, so the page is never empty while the dashboard catches up.
draw({});
if (window.parent !== window) window.parent.postMessage({ source: '3dg-preview', type: 'ready', phase: 'button' }, location.origin);
