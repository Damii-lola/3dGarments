/**
 * The bar at the top of every page: the brand, the four sections, and the
 * account button on the right.
 *
 * It is one component in one place because it is on five pages, and a nav that
 * drifts between pages is the fastest way for a site to look unfinished. The
 * markup itself is in each page (a static nav is a nav a crawler and a
 * no-script reader can both follow); this file is the behaviour:
 *
 *   - the section list folds into a menu on anything phone-shaped, because at
 *     189% the four names do not fit beside the brand on any phone;
 *   - the account panel says who is signed in, and is where "log out" lives;
 *   - sections arrive as they are reached (see the reveal block at the bottom).
 *
 * The account panel is filled from the session, the same way the scanner is:
 * nothing here needs a server of its own.
 */
import { getSession, isAccount, onAuthChange, signOut } from './services/auth.js';
import './theme.js';

const links = document.getElementById('nav-links');
const menu = document.getElementById('nav-menu');
const user = document.getElementById('nav-user');
const panel = document.getElementById('nav-account');
const panelName = document.getElementById('nav-account-name');
const panelNote = document.getElementById('nav-account-note');
const dashLink = document.getElementById('nav-account-dash');
const settingsLink = document.getElementById('nav-account-settings');
const inLink = document.getElementById('nav-account-in');
const outBtn = document.getElementById('nav-account-out');

/** A path in the shape two pages can be compared in: no index.html, always a directory. */
const asDirectory = (path) => path.replace(/index\.html$/, '').replace(/\/?$/, '/');

/* ---------- which section am I on? ---------- */
/* Decided here rather than by hand in five files, so a page can never point at
   itself by accident. */
if (links) {
  for (const link of links.querySelectorAll('.nav-link')) {
    const to = asDirectory(new URL(link.getAttribute('href'), window.location.href).pathname);
    if (to === asDirectory(window.location.pathname)) link.setAttribute('aria-current', 'page');
  }
}

/* ---------- the two disclosures ----------
   The section list is opened with a class, not with [hidden]: on a wide screen
   it is always there, and the class simply has no rule to answer to. The
   account panel is opened with [hidden], because it is never unconditional. */
function openMenu(open) {
  if (!links || !menu) return;
  links.classList.toggle('open', open);
  menu.setAttribute('aria-expanded', String(open));
}

function openPanel(open) {
  if (!panel || !user) return;
  panel.hidden = !open;
  user.setAttribute('aria-expanded', String(open));
}

const closeMenu = () => openMenu(false);
const closePanel = () => openPanel(false);

menu?.addEventListener('click', () => {
  closePanel();
  openMenu(!links.classList.contains('open'));
});
user?.addEventListener('click', () => {
  closeMenu();
  openPanel(panel.hidden);
});

/* A click anywhere else, or Escape, puts them away — including a click on the
   other one, which is why each opens by closing the other. */
document.addEventListener('pointerdown', (event) => {
  if (panel && !panel.hidden && !panel.contains(event.target) && !user?.contains(event.target)) closePanel();
  if (links?.classList.contains('open') && !links.contains(event.target) && !menu?.contains(event.target)) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closePanel();
  closeMenu();
});

/* ---------- who is signed in ---------- */
function paint(session) {
  if (!panel) return;
  const account = isAccount(session);
  const name = account ? session.user.user_metadata?.username || session.user.email : '';

  if (panelName) panelName.textContent = account ? name : 'Not signed in';
  panelNote.textContent = account
    ? session.user.email || ''
    : 'The scanner asks who it is measuring before it opens the camera.';
  if (dashLink) dashLink.hidden = true;
  if (settingsLink) settingsLink.hidden = !account;
  outBtn.hidden = !account;
  // On the account screen itself there is nothing to point at: the form is
  // already the way in.
  inLink.hidden = account || (inLink && inLink.pathname === window.location.pathname);
}

getSession().then(paint).catch(() => paint(null));
onAuthChange(paint);

outBtn?.addEventListener('click', async () => {
  outBtn.disabled = true;
  outBtn.textContent = 'Logging out…';
  try {
    await signOut();
  } catch {
    // Nothing to do about it: reloading below lands in the same place either
    // way, and the session is dropped locally as soon as the call returns.
  }
  // Reloaded rather than patched in place: a page that needs an account (the
  // scanner, the dashboard) has to notice, and it notices on the way in.
  location.reload();
});

/* ---------- sections arriving ----------
   The styles only hide these while the <html> element carries "js" — a flag a
   one-line script in each page sets before the first paint, so nothing is
   painted and then hidden.

   That flag is lifted here, but only once the observer has reported for the
   first time: an IntersectionObserver always lists every target in its first
   callback, so a callback arriving is proof that it is alive and will report
   again. If it never arrives — an engine without it, a document that is not
   being painted — the flag is left alone and the page's own timer lifts it a
   few seconds later. Either way a page cannot be left invisible. */
const reveals = document.querySelectorAll('[data-reveal]');
if (reveals.length) {
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        clearTimeout(window.__revealFailSafe);
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('seen');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    );
    reveals.forEach((el) => io.observe(el));
  }
}
