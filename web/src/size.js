/**
 * /size — the scanner, behind an account.
 *
 * The landing page sends people here once they are signed in. Somebody who opens
 * this address cold is sent to the same account screen instead, rather than left
 * staring at a camera that is not for them — one door, however you arrive.
 *
 * The exception is the store's link (?g=CODE), which is a *shopper* following a
 * garment, not a store signing in. They have no account here and never will, so
 * that address — and anything carrying ?embed=1, which is the popup on a store's
 * own page — goes straight to the scanner.
 *
 * The scanner itself is heavy: a pose model, the silhouette pass, three.js and
 * the garment lab. So it is imported only after the door is open — somebody who
 * has merely followed a link here pays a few kilobytes, not a few megabytes.
 *
 * A copy of the site with no cloud configured has no accounts to check against,
 * and the scanner measures on the device and needs no account of its own — such
 * a copy opens. The same is true if the API that holds the settings is too slow
 * to answer: the door prefers to be open rather than to hang.
 */
import './nav.js';
import { cloudConfig } from './services/config.js';
import { getSession, isAccount } from './services/auth.js';

/** A cold API can take a while to say where the cloud is; past this, the scanner opens. */
const CONFIG_WAIT = 4000;

/** `promise`, or `fallback` if it has not settled within `ms`. */
function within(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

const params = new URLSearchParams(location.search);
/** The garment in the store's link. A scan with one is a shopper, not a store. */
const chartCode = (params.get('g') || '').trim();
/** The popup on the store's own page. No bar, no footer, no account — just the tool. */
const embedded = params.get('embed') === '1';
if (embedded) {
  // The class goes on the root as well as the body: the popup's 20% size
  // reduction is a root font-size, and CSS cannot reach an ancestor from a
  // descendant. Everything inside is in rem, so one number scales it all.
  document.documentElement.classList.add('embed');
  document.body.classList.add('embed');
  // The brand is the one piece of the bar the popup keeps, and it is there to be
  // read, not pressed: following it would open our site inside the store's popup.
  // Without an href it is a mark, not a link.
  document.querySelector('.nav-brand')?.removeAttribute('href');
}

const config = await within(cloudConfig().catch(() => null), CONFIG_WAIT, null);

if (!config || embedded || chartCode) {
  await import('./main.js');
} else if (isAccount(await getSession())) {
  await import('./main.js');
} else {
  location.replace('../auth/');
}
