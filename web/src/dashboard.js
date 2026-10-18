/**
 * The dashboard: your account, and an honest account of what it holds.
 *
 * There is little to show here on purpose. The scanner stores nothing — no
 * video, no measurements, no history — so a dashboard full of numbers would be
 * a dashboard full of lies. What is left is the one row we do hold (the
 * username and the email), the way out of it, and a plain answer to "so what
 * does this page become?".
 *
 * Signed out is not an error state here: it is a state, with the way in beside
 * it. That is why this page does not bounce anyone to the account screen the way
 * the scanner does.
 */
import './nav.js';
import { getSession, isAccount, signOut } from './services/auth.js';

const signedIn = document.getElementById('dash-in');
const signedOut = document.getElementById('dash-anon');
const nameEl = document.getElementById('dash-name');
const mailEl = document.getElementById('dash-mail');
const outBtn = document.getElementById('dash-out');

function paint(session) {
  const account = isAccount(session);
  signedIn.hidden = !account;
  signedOut.hidden = account;
  if (!account) return;

  nameEl.textContent = session.user.user_metadata?.username || 'Your account';
  mailEl.textContent = session.user.email || '';
}

getSession().then(paint).catch(() => paint(null));

outBtn?.addEventListener('click', async () => {
  outBtn.disabled = true;
  outBtn.textContent = 'Logging out…';
  try {
    await signOut();
  } catch {
    // Either way the session is dropped locally, which is what this page is
    // about: reload, and it paints the signed-out state.
  }
  location.reload();
});
