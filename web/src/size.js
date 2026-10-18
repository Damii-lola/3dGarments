/**
 * /size — the scanner, behind an account.
 *
 * The landing page sends people here once they are signed in. Somebody who opens
 * this address cold is sent to the same account screen instead, rather than left
 * staring at a camera that is not for them — one door, however you arrive.
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
import { cloudConfig } from './services/config.js';
import { getSession, isAccount } from './services/auth.js';

/** A cold API can take a while to say where the cloud is; past this, the scanner opens. */
const CONFIG_WAIT = 4000;

/** `promise`, or `fallback` if it has not settled within `ms`. */
function within(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

const config = await within(cloudConfig().catch(() => null), CONFIG_WAIT, null);

if (!config) {
  await import('./main.js');
} else if (isAccount(await getSession())) {
  await import('./main.js');
} else {
  location.replace('../auth/');
}
