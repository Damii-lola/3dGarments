/**
 * The settings page: account, security, notifications, billing, appearance and
 * the danger zone. Each panel is its own tab inside a sidebar shell.
 *
 * Signed out users see a sign-in gate; signed in users see every panel and can
 * edit anything on it. Changes are echoed to Supabase (profile metadata,
 * password, notifications) and confirmed with a toast.
 */
import { getSession, isAccount, signOut, updatePassword } from './services/auth.js';
import { api } from './services/api.js';

const gate = document.getElementById('settings-gate');
const body = document.getElementById('settings-body');

const panels = document.querySelectorAll('.settings-panel');
const navItems = document.querySelectorAll('.settings-nav-item');

/**
 * Which panel a nav button opens is written on the button (data-panel), not worked
 * out from its id: the first one is "nav-account-profile" but its panel is
 * "panel-account", so deriving one from the other left "Account" opening nothing.
 */
function showPanel(id) {
  panels.forEach((p) => p.classList.toggle('settings-panel-active', p.id === `panel-${id}`));
  navItems.forEach((n) => {
    const on = n.dataset.panel === id;
    n.classList.toggle('settings-nav-item-active', on);
    if (on) n.setAttribute('aria-current', 'true');
    else n.removeAttribute('aria-current');
  });
  // The panel, not the top of the page: the hero is tall, and this is a tab, not a new page.
  document.getElementById('settings-body')?.scrollIntoView({ block: 'start' });
}

navItems.forEach((n) => {
  n.addEventListener('click', () => showPanel(n.dataset.panel));
});

/* ---------- sign-in gating ---------- */

function paint(session) {
  const account = isAccount(session);
  gate.hidden = account;
  body.hidden = !account;
  if (!account) return;

  const name = session.user.user_metadata?.username || session.user.email || 'Account';
  const email = session.user.email || '';

  document.getElementById('settings-account-name').textContent = name;
  document.getElementById('settings-account-email').textContent = email;
  document.getElementById('settings-username').value = session.user.user_metadata?.username || '';
  document.getElementById('settings-email').value = email;

  // Avatar: first letter of username / email
  const avatar = document.getElementById('settings-avatar');
  const letter = (name.charAt(0) || '?').toUpperCase();
  avatar.textContent = letter;
}

/* ---------- profile ---------- */

async function saveProfile() {
  const username = document.getElementById('settings-username').value.trim();
  const email = document.getElementById('settings-email').value.trim();
  const fullName = document.getElementById('settings-full-name').value.trim();
  const brandName = document.getElementById('settings-brand-name').value.trim();
  const status = document.getElementById('settings-profile-status');
  const btn = document.getElementById('settings-save-profile');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/api/me/profile', {
      method: 'PATCH',
      body: { username, email, full_name: fullName, brand_name: brandName },
    });
    status.textContent = 'Saved.';
    status.className = 'settings-panel-hint settings-panel-hint-ok';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (err) {
    status.textContent = err.message || 'Could not save.';
    status.className = 'settings-panel-hint settings-panel-hint-error';
  } finally {
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}
document.getElementById('settings-save-profile')?.addEventListener('click', saveProfile);

/* ---------- password ---------- */

async function changePassword() {
  const current = document.getElementById('settings-current-password').value;
  const newPass = document.getElementById('settings-new-password').value;
  const confirm = document.getElementById('settings-confirm-password').value;
  const status = document.getElementById('settings-password-status');
  const btn = document.getElementById('settings-save-password');
  btn.disabled = true; btn.textContent = 'Changing…';
  try {
    if (newPass !== confirm) throw new Error('The two new passwords do not match.');
    await updatePassword(newPass);
    status.textContent = 'Password changed.';
    status.className = 'settings-panel-hint settings-panel-hint-ok';
    document.getElementById('settings-current-password').value = '';
    document.getElementById('settings-new-password').value = '';
    document.getElementById('settings-confirm-password').value = '';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (err) {
    status.textContent = err.message || 'Could not change password.';
    status.className = 'settings-panel-hint settings-panel-hint-error';
  } finally {
    btn.disabled = false; btn.textContent = 'Change password';
  }
}
document.getElementById('settings-save-password')?.addEventListener('click', changePassword);

/* ---------- notifications ---------- */

async function saveNotifications() {
  const prefs = {
    results: document.getElementById('settings-notify-results').checked,
    digest: document.getElementById('settings-notify-digest').checked,
    marketing: document.getElementById('settings-notify-marketing').checked,
    security: document.getElementById('settings-notify-security').checked,
  };
  const status = document.getElementById('settings-notifications-status');
  const btn = document.getElementById('settings-save-notifications');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/api/me/notifications', { method: 'PATCH', body: prefs });
    status.textContent = 'Notification preferences saved.';
    status.className = 'settings-panel-hint settings-panel-hint-ok';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (err) {
    status.textContent = err.message || 'Could not save.';
    status.className = 'settings-panel-hint settings-panel-hint-error';
  } finally {
    btn.disabled = false; btn.textContent = 'Save notification preferences';
  }
}
document.getElementById('settings-save-notifications')?.addEventListener('click', saveNotifications);

/* ---------- billing ---------- */

async function saveBilling() {
  const billingEmail = document.getElementById('settings-billing-email').value.trim();
  const taxId = document.getElementById('settings-tax-id').value.trim();
  const status = document.getElementById('settings-billing-status');
  const btn = document.getElementById('settings-save-billing');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/api/me/billing', { method: 'PATCH', body: { billing_email: billingEmail, tax_id: taxId } });
    status.textContent = 'Billing details saved.';
    status.className = 'settings-panel-hint settings-panel-hint-ok';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (err) {
    status.textContent = err.message || 'Could not save.';
    status.className = 'settings-panel-hint settings-panel-hint-error';
  } finally {
    btn.disabled = false; btn.textContent = 'Save billing details';
  }
}
document.getElementById('settings-save-billing')?.addEventListener('click', saveBilling);

/* ---------- appearance ---------- */

async function saveAppearance() {
  const theme = document.getElementById('settings-theme').value;
  const accent = document.getElementById('settings-accent-colour').value;
  const unit = document.getElementById('settings-unit').value;
  const status = document.getElementById('settings-appearance-status');
  const btn = document.getElementById('settings-save-appearance');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/api/me/appearance', { method: 'PATCH', body: { theme, accent_colour: accent, unit } });
    status.textContent = 'Appearance saved.';
    status.className = 'settings-panel-hint settings-panel-hint-ok';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (err) {
    status.textContent = err.message || 'Could not save.';
    status.className = 'settings-panel-hint settings-panel-hint-error';
  } finally {
    btn.disabled = false; btn.textContent = 'Save appearance';
  }
}
document.getElementById('settings-save-appearance')?.addEventListener('click', saveAppearance);

/* ---------- danger zone ---------- */

document.getElementById('settings-delete-account')?.addEventListener('click', async () => {
  if (!confirm('This permanently deletes your account, charts and billing history. It cannot be undone. Continue?')) return;
  const status = document.getElementById('settings-danger-status');
  const btn = document.getElementById('settings-delete-account');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await api('/api/me/account', { method: 'DELETE' });
    status.textContent = 'Account deleted.';
    status.className = 'settings-panel-hint settings-panel-hint-ok';
    setTimeout(() => { signOut(); }, 1200);
  } catch (err) {
    status.textContent = err.message || 'Could not delete account.';
    status.className = 'settings-panel-hint settings-panel-hint-error';
    btn.disabled = false; btn.textContent = 'Delete account';
  }
});

/* ---------- boot ---------- */

getSession().then(paint).catch(() => paint(null));

/* ---------- the page around the panels ----------
   The account file at the top says who is logged in (its name and email are filled
   in by paint() above, which is the one place that reads the session); this adds
   the words around them, and the menu on a phone. */
getSession().then((session) => {
  const account = isAccount(session);
  const label = document.getElementById('af-session');
  if (label) label.textContent = account ? 'Live session' : 'Not logged in';
  const foot = document.getElementById('af-foot')?.querySelector('span');
  if (foot && !account) {
    foot.replaceChildren('No account on this browser \u00b7 ');
    const link = document.createElement('a');
    link.href = new URL('../auth/', location.href).href;
    link.textContent = 'Log in';
    foot.append(link);
  }
}).catch(() => {});

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
