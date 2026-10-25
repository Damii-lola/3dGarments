/**
 * Keeps this device's theme and accent in step with the account's.
 *
 * public/theme-init.js applies whatever was last stored here before the page paints.
 * This is the other half: when somebody is logged in, ask the server what they chose
 * (on another device, say) and store it, so the choice follows the account. It asks at
 * most once an hour, and not at all when logged out — a visitor has no account to ask.
 */
import { getSession, isAccount } from './services/auth.js';
import { api } from './services/api.js';

const STALE_AFTER = 60 * 60 * 1000;

/** Fold the server's copy of the settings into what is stored on this device. */
export function rememberSettings(settings, uid = '') {
  const theme = window.FMSTheme;
  if (!theme || !settings) return;
  // null on the server means "never chose": stored as nothing, so the site's own look applies.
  theme.set({
    theme: settings.theme || '',
    accent: settings.accent_colour || '',
    unit: settings.default_unit || '',
    uid,
  });
}

export async function refreshAppearance({ force = false } = {}) {
  const theme = window.FMSTheme;
  if (!theme) return;
  try {
    const session = await getSession();
    if (!isAccount(session)) return;
    const uid = session.user.id;
    // What is stored belongs to the account that chose it: another account on this device asks again.
    const stored = theme.read();
    if (!force && stored.uid === uid && stored.at && Date.now() - stored.at < STALE_AFTER) return;
    const { settings } = await api('/api/me/settings');
    if (settings) rememberSettings(settings, uid);
    // Nothing saved on this account: the site's own look applies, even if another account on
    // this device had chosen otherwise. (This also records that we asked.)
    else theme.set({ theme: '', accent: '', unit: '', uid });
  } catch {
    // The API may be asleep or the table not set up; the page works as it is.
  }
}

refreshAppearance();
