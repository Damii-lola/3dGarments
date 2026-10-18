/**
 * The account screen: sign up with a username, an email and a password, or log
 * in with the email and the password. No codes, no second step, no email
 * round-trip to prove it is you — once this form is satisfied, the scanner opens.
 *
 * Two things about how it works are worth stating plainly:
 *   - The password never reaches us. Supabase's auth service holds it, hashed,
 *     and this page hands it over once and forgets it. There is no password
 *     column anywhere in our own tables and there must never be one.
 *   - The username rides in the signup metadata, where the database trigger
 *     (supabase/migrations/*_accounts.sql) puts it in the profile row, so an
 *     account cannot come into being without a name.
 */
import { cloudConfig } from './services/config.js';
import { getSession, isAccount, signIn, signUp, usernameTaken } from './services/auth.js';

/** Where the scanner lives. Siblings, so this holds under any base path. */
const SCANNER = '../size/';

/** Supabase's own minimum, unless the project is set stricter. */
const PASSWORD_MIN = 6;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TABS = {
  signup: {
    title: 'Create your account',
    lead: 'Your size belongs to you, so the scanner asks who it is measuring before it opens the camera. No codes, no confirmations \u2014 a name, an email, a password.',
  },
  login: {
    title: 'Welcome back',
    lead: 'Log in and the scanner opens.',
  },
};

const byId = (id) => document.getElementById(id);
const titleEl = byId('auth-title');
const leadEl = byId('auth-lead');
const tabsEl = byId('auth-tabs');
const tabSignup = byId('tab-signup');
const tabLogin = byId('tab-login');
const signupForm = byId('signup-form');
const loginForm = byId('login-form');
const signupSubmit = byId('signup-submit');
const loginSubmit = byId('login-submit');
const signupUsername = byId('signup-username');
const signupEmail = byId('signup-email');
const signupPassword = byId('signup-password');
const signupConfirm = byId('signup-confirm');
const loginEmail = byId('login-email');
const loginPassword = byId('login-password');
const usernameState = byId('username-state');
const statusEl = byId('auth-status');
const localBox = byId('auth-local');
const skipBtn = byId('auth-skip');

let busy = false;

/** One line of feedback, in the same place every time. */
function say(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function setBusy(on, message = '') {
  busy = on;
  signupSubmit.disabled = on;
  loginSubmit.disabled = on;
  if (message) say(message);
}

/** The shape of the username, before anyone is asked about it. */
function usernameProblem(name) {
  if (!name) return 'Pick a username.';
  if (!USERNAME_RE.test(name)) return 'A username is 3\u201320 characters: letters, numbers, dot, dash or underscore.';
  return '';
}

function showTab(which) {
  const tab = TABS[which];
  const signup = which === 'signup';
  signupForm.hidden = !signup;
  loginForm.hidden = signup;
  tabsEl.querySelectorAll('.auth-tab').forEach((button) => {
    button.classList.toggle('on', button.dataset.tab === which);
  });
  tabSignup.setAttribute('aria-selected', String(signup));
  tabLogin.setAttribute('aria-selected', String(!signup));
  titleEl.textContent = tab.title;
  leadEl.textContent = tab.lead;
  usernameState.textContent = '';
  say('');
}

/** Supabase's errors are accurate but written for a developer. Say the useful thing. */
function friendly(error, fallback) {
  const text = String(error?.message || error || '');
  if (/already registered|already been registered|user already/i.test(text)) return 'That email already has an account \u2014 log in instead.';
  if (/invalid login credentials/i.test(text)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(text)) return 'Confirm your email first \u2014 the link is in your inbox.';
  if (/rate limit|too many|429/i.test(text)) return 'Too many attempts just now \u2014 wait a minute and try again.';
  if (/database error|unexpected_failure|check_violation|duplicate key/i.test(text)) return 'That account could not be saved \u2014 try another username, or check that the accounts SQL in supabase/ has been applied to the project.';
  if (/failed to fetch|networkerror|load failed/i.test(text)) return 'No connection to the account service. Check the network and try again.';
  if (/should be at least/i.test(text)) return text;
  return fallback;
}

/* ---------- the two tabs ---------- */
tabSignup.dataset.tab = 'signup';
tabLogin.dataset.tab = 'login';
tabSignup.addEventListener('click', () => showTab('signup'));
tabLogin.addEventListener('click', () => showTab('login'));
// A tablist is a keyboard control: arrow keys move between the two, as they do
// in every other tab strip on the web.
tabsEl.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const signup = document.activeElement === tabLogin;
  showTab(signup ? 'signup' : 'login');
  (signup ? tabSignup : tabLogin).focus();
});

/* ---------- is that username free? ---------- */
/* Asked when the field is left, so the answer arrives while it still matters,
   and again before anything is created. */
signupUsername.addEventListener('blur', async () => {
  const name = signupUsername.value.trim();
  usernameState.className = 'auth-hint';
  if (usernameProblem(name)) {
    usernameState.textContent = '';
    return;
  }
  usernameState.textContent = 'Checking\u2026';
  try {
    const taken = await usernameTaken(name);
    usernameState.className = `auth-hint ${taken ? 'bad' : 'good'}`;
    usernameState.textContent = taken ? `${name} is taken.` : `${name} is free.`;
  } catch {
    usernameState.textContent = ''; // unknown: the submit will ask again
  }
});

/* ---------- sign up ---------- */
signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const username = signupUsername.value.trim();
  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  const confirm = signupConfirm.value;

  const shape = usernameProblem(username);
  if (shape) return say(shape, 'error');
  if (!EMAIL_RE.test(email)) return say('That does not look like an email address.', 'error');
  if (password.length < PASSWORD_MIN) return say(`A password needs at least ${PASSWORD_MIN} characters.`, 'error');
  if (password !== confirm) return say('Those two passwords do not match.', 'error');

  setBusy(true, 'Checking that username\u2026');
  try {
    // The check is a courtesy: it says "taken" while the form is still open. If
    // the check itself cannot run (an older database, a flaky line), the signup
    // below is still the thing that decides, so it goes ahead.
    let taken = false;
    try {
      taken = await usernameTaken(username);
    } catch {
      taken = false;
    }
    if (taken) {
      usernameState.className = 'auth-hint bad';
      usernameState.textContent = `${username} is taken.`;
      return say('That username is taken \u2014 try another.', 'error');
    }
    say('Creating your account\u2026');
    const created = await signUp(email, password, username);

    if (created?.session) {
      say('You are in. Opening the scanner\u2026', 'ok');
      location.assign(SCANNER);
      return;
    }

    // No session: the project is set to confirm the address by email first.
    // Not what we want (no verification step), but say what to do rather than
    // leaving someone staring at a form that seemed to work.
    loginEmail.value = email;
    showTab('login');
    say(`Account created. Confirm ${email} from the link we sent, then log in here.`, 'ok');
  } catch (error) {
    say(friendly(error, 'Could not create that account.'), 'error');
  } finally {
    setBusy(false);
  }
});

/* ---------- log in ---------- */
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!EMAIL_RE.test(email)) return say('That does not look like an email address.', 'error');
  if (!password) return say('Your password, please.', 'error');

  setBusy(true, 'Logging you in\u2026');
  try {
    await signIn(email, password);
    say('You are in. Opening the scanner\u2026', 'ok');
    location.assign(SCANNER);
  } catch (error) {
    say(friendly(error, 'That did not work \u2014 check the email and password.'), 'error');
  } finally {
    setBusy(false);
  }
});

/* ---------- arriving ---------- */
(async function arrive() {
  // A copy with no cloud has nothing to sign in to, and the scanner needs no
  // account of its own: say so and open the way through rather than leaving a
  // form that can only fail.
  const slow = setTimeout(() => say('Waking the account service\u2026'), 4000);
  const config = await cloudConfig().catch(() => null);
  clearTimeout(slow);

  if (!config) {
    titleEl.textContent = 'No accounts on this copy';
    leadEl.textContent = 'This build has no cloud configured, so there is nothing to sign in to \u2014 and the scanner measures on your own device and needs no account.';
    tabsEl.hidden = true;
    signupForm.hidden = true;
    loginForm.hidden = true;
    localBox.hidden = false;
    say('');
    return;
  }

  if (isAccount(await getSession())) {
    say('Already signed in \u2014 opening the scanner\u2026', 'ok');
    location.replace(SCANNER);
    return;
  }
  say('');
})();

skipBtn.addEventListener('click', () => location.assign(SCANNER));
