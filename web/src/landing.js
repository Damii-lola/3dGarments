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
 */
import './nav.js';
import { getSession, isAccount } from './services/auth.js';

const CAMERA_WAIT = 2500;
const SCANNER = 'size/';
const ACCOUNT = 'auth/';
const DEMO_EMAIL = 'findmysize.us@gmail.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const button = document.getElementById('open-camera');
const cta = button ? button.querySelector('.cam-cta') : null;

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
    session = null;
  }

  setTimeout(() => {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (cta) cta.textContent = 'Click to Record';
  }, 5000);

  location.assign(isAccount(session) ? SCANNER : ACCOUNT);
});

/* ---------- booking a demo ---------- */
const demoForm = document.getElementById('demo-form');
const demoAlert = document.getElementById('form-alert');
const demoSuccess = document.getElementById('form-success');
const demoSuccessEmail = document.getElementById('success-email');
const demoReset = document.getElementById('form-reset');

const nameInput = document.getElementById('name');
const storeInput = document.getElementById('store');
const emailInput = document.getElementById('email');
const messageInput = document.getElementById('products');

const required = [
  { input: nameInput, error: document.getElementById('name-error'), ok: (v) => v.length > 0 },
  { input: emailInput, error: document.getElementById('email-error'), ok: (v) => EMAIL_RE.test(v) },
];

function mark(field, valid) {
  if (!field.input) return;
  field.input.setAttribute('aria-invalid', String(!valid));
  if (field.error) field.error.hidden = valid;
}

function clearErrors() {
  for (const field of required) mark(field, true);
  if (demoAlert) demoAlert.hidden = true;
}

for (const field of required) {
  field.input?.addEventListener('input', () => {
    if (field.input.getAttribute('aria-invalid') === 'true') mark(field, field.ok(field.input.value.trim()));
  });
}

demoForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  clearErrors();

  let firstInvalid = null;
  for (const field of required) {
    if (!field.input) continue;
    const valid = field.ok(field.input.value.trim());
    mark(field, valid);
    if (!valid && !firstInvalid) firstInvalid = field.input;
  }
  if (firstInvalid) {
    if (demoAlert) demoAlert.hidden = false;
    firstInvalid.focus();
    return;
  }

  const name = nameInput.value.trim();
  const store = storeInput.value.trim();
  const email = emailInput.value.trim();
  const message = messageInput.value.trim();

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

  if (demoSuccessEmail) demoSuccessEmail.textContent = email;
  demoForm.hidden = true;
  if (demoSuccess) {
    demoSuccess.hidden = false;
    demoSuccess.focus();
  }
});

demoReset?.addEventListener('click', () => {
  if (!demoForm) return;
  clearErrors();
  if (demoSuccess) demoSuccess.hidden = true;
  demoForm.hidden = false;
  demoForm.closest('.form-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  nameInput?.focus({ preventScroll: true });
});

/* ---------- the menu on a phone ---------- */
const menuButton = document.getElementById('nav-menu');
if (menuButton) {
  const syncMenu = () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('is-locked', open);
  };
  new MutationObserver(syncMenu).observe(menuButton, { attributes: true, attributeFilter: ['aria-expanded'] });

  document.querySelector('.nav-demo')?.addEventListener('click', () => {
    if (menuButton.getAttribute('aria-expanded') === 'true') menuButton.click();
  });

  window.matchMedia('(min-width: 961px)').addEventListener('change', (event) => {
    if (event.matches && menuButton.getAttribute('aria-expanded') === 'true') menuButton.click();
  });
}

/* ---------- AI help chat (bottom-right) ---------- */
(function loadChat() {
  const base = import.meta.env.BASE_URL || '/';
  const chat = document.createElement('script');
  chat.src = base + 'chat.js';
  document.body.appendChild(chat);
})();
