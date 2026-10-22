/**
 * The home page. Two jobs:
 *
 *   1. the tool itself — one tap on the camera, and somebody is on their way to
 *      the scanner (by way of the account screen, because a size is worth
 *      keeping and is therefore kept under a name rather than under a browser
 *      tab);
 *   2. the rest of the page, which is written for the brand rather than for the
 *      shopper, and ends in a way to reach us that does not need a server of
 *      ours: the form opens the visitor's own mail client.
 *
 * Whether the detour in (1) is necessary depends on a session, and a session
 * depends on the cloud settings the API hands out — a request that can be slow
 * on a cold start. So the wait is capped, and the account screen is the
 * fallback: it is the one screen that can also let somebody through without an
 * account, when a copy of the site has no cloud configured at all.
 */
import './nav.js';
import { getSession, isAccount } from './services/auth.js';

/** Long enough for a warm API, short enough that a tap never feels stuck. */
const CAMERA_WAIT = 2500;

/** Where the rest of the site lives, relative to this page, under any base path. */
const SCANNER = 'size/';
const ACCOUNT = 'auth/';

/** Where a demo request goes. Change this one line when the address changes. */
const DEMO_EMAIL = 'findmysize.us@gmail.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const button = document.getElementById('open-camera');
const cta = button ? button.querySelector('.cam-cta') : null;

/** `promise`, or `fallback` if it has not settled within `ms`. */
function within(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

if (button) button.addEventListener('click', async () => {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (cta) cta.textContent = 'Opening';

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
    if (cta) cta.textContent = 'Click to Record';
  }, 5000);

  location.assign(isAccount(session) ? SCANNER : ACCOUNT);
});

/* ---------- booking a demo ----------
   The mail client is the endpoint. It means no form service to run, no address
   harvested by a third party, and — the useful part — the reply comes back to
   the address the visitor typed, which is the one that needs the answer. */
const demoForm = document.getElementById('demo-form');
const demoStatus = document.getElementById('demo-status');

demoForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = document.getElementById('demo-name').value.trim();
  const store = document.getElementById('demo-store').value.trim();
  const email = document.getElementById('demo-email').value.trim();
  const message = document.getElementById('demo-message').value.trim();

  const field = (message) => {
    demoStatus.className = 'status error';
    demoStatus.textContent = message;
  };

  if (!name) return field('A name, please.');
  if (!EMAIL_RE.test(email)) return field('That does not look like an email address.');

  // Written out and sent, rather than sent by the form: what arrives in the
  // inbox is then something a person can read, in the order they would ask it.
  const body = [
    `Name: ${name}`,
    store ? `Store: ${store}` : null,
    `Email: ${email}`,
    '',
    message || '(no notes)',
    '',
    '- sent from the FindMySize home page',
  ]
    .filter((line) => line !== null)
    .join('\r\n');

  const subject = store ? `Demo request — ${store}` : `Demo request — ${name}`;
  window.location.href = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  demoStatus.className = 'status ok';
  demoStatus.textContent = 'Your mail app is opening with the details — send it and we will reply.';
});

