/**
 * The landing page. It has one job: hand somebody to the scanner — by way of the
 * account screen, because a size is worth keeping and is therefore kept under a
 * name rather than under a browser tab.
 *
 * Whether that detour is necessary depends on a session, and a session depends
 * on the cloud settings the API hands out — a request that can be slow on a cold
 * start. So the wait is capped, and the account screen is the fallback: it is
 * the one screen that can also let somebody through without an account, when a
 * copy of the site has no cloud configured at all.
 */
import { getSession, isAccount } from './services/auth.js';

/** Long enough for a warm API, short enough that a tap never feels stuck. */
const CAMERA_WAIT = 2500;

/** Where the rest of the site lives, relative to this page, under any base path. */
const SCANNER = 'size/';
const ACCOUNT = 'auth/';

const button = document.getElementById('open-camera');
const cta = button.querySelector('.cam-cta');

/** `promise`, or `fallback` if it has not settled within `ms`. */
function within(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

button.addEventListener('click', async () => {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  cta.textContent = 'Opening';

  let session = null;
  try {
    session = await within(getSession(), CAMERA_WAIT, null);
  } catch {
    session = null; // no cloud, no session, no matter: the account screen decides
  }

  // A double tap must not leave the button dead if the navigation is blocked.
  setTimeout(() => {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    cta.textContent = 'Click to Record';
  }, 5000);

  location.assign(isAccount(session) ? SCANNER : ACCOUNT);
});
