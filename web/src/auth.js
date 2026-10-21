/**
 * The account screen.
 *
 * Signing up asks for a username, an email and a password, then confirms the
 * address once by email. Logging in is deliberately two steps: the password,
 * and then a code sent to that address. The password alone never
 * opens the scanner — a stolen password is not enough without the inbox, and
 * the inbox alone is not enough without the password.
 *
 * Two things about how it works are worth stating plainly:
 *   - The password never reaches us. Supabase's auth service holds it, hashed,
 *     and this page hands it over once and forgets it. There is no password
 *     column anywhere in our own tables and there must never be one.
 *   - The username rides in the signup metadata, where the database trigger
 *     (supabase/migrations/*_accounts.sql) puts it in the profile row. A signup
 *     from a provider would have no username to send, so the trigger can make
 *     one from the address; there is no provider button on this page for now.
 */
import './nav.js';
import { cloudConfig } from './services/config.js';
import {
  getSession,
  isAccount,
  onAuthChange,
  requestPasswordReset,
  resendConfirmation,
  sendLoginCode,
  signIn,
  signOut,
  signUp,
  updatePassword,
  usernameTaken,
  verifyLoginCode,
} from './services/auth.js';

/** Where the scanner lives. Siblings, so this holds under any base path. */
const SCANNER = '../size/';

/** Supabase's own minimum, unless the project is set stricter. */
const PASSWORD_MIN = 6;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** How long before another email may be asked for. Supabase enforces the same. */
const RESEND_SECONDS = 60;

const TABS = {
  signup: {
    title: 'Create your account',
    lead: 'A name, an email and a password. Confirm the address once, and after that every log in is your password plus a code we email you - nothing to install.',
  },
  login: {
    title: 'Welcome back',
    lead: 'Your password, then the code we send to your inbox.',
  },
};

const byId = (id) => document.getElementById(id);
const titleEl = byId('auth-title');
const leadEl = byId('auth-lead');
const entryEl = byId('auth-entry');
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
const forgotBtn = byId('forgot-btn');

const codeStep = byId('auth-code');
const codeForm = byId('code-form');
const codeInput = byId('code-input');
const codeSubmit = byId('code-submit');
const codeResend = byId('code-resend');
const codeBack = byId('code-back');

const sentStep = byId('auth-sent');
const sentNote = byId('sent-note');
const sentResend = byId('sent-resend');
const sentBack = byId('sent-back');

const recoverStep = byId('auth-recover');
const recoveryForm = byId('recovery-form');
const recoveryPassword = byId('recovery-password');
const recoveryConfirm = byId('recovery-confirm');
const recoverySubmit = byId('recovery-submit');

let busy = false;
let activeTab = 'signup';
/** The address the last code or confirmation went to. */
let pendingEmail = '';
/**
 * Set while the password step holds a session it does not intend to keep.
 * Without it the SIGNED_IN event would bounce the page to the scanner before
 * the code was ever asked for — which would be one step, not two.
 */
let redirectBlocked = false;
/** A reset link is open: do not treat its session as a finished login. */
let recovering = false;
let cooldownTimer = null;
/** The button a resend countdown is holding disabled, so setBusy cannot undo it. */
let coolingButton = null;

/* ---------- words ---------- */

function say(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function setBusy(on, message = '') {
  busy = on;
  for (const button of [signupSubmit, loginSubmit, codeSubmit, recoverySubmit, sentResend, codeResend]) {
    if (button) button.disabled = on || button === coolingButton;
  }
  if (message) say(message);
}

/**
 * Supabase's errors are accurate but written for a developer. Say the useful
 * thing, and say the same thing every time the same cause arrives.
 */
function friendly(error, fallback) {
  const text = String(error?.message || error || '');
  if (/already registered|already been registered|user already/i.test(text)) return 'That email already has an account — log in instead.';
  if (/email address .* is invalid|email_address_invalid|invalid email/i.test(text)) return 'That email address cannot receive mail — use a real one.';
  if (/invalid login credentials/i.test(text)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(text)) return 'Confirm your email first — open the link in your inbox, or send it again below.';
  if (/token has expired|expired or is invalid|invalid.*token|otp.*expired/i.test(text)) return 'That code is wrong or has expired — ask for a new one.';
  if (/only request this after|rate limit|too many|429/i.test(text)) return 'That was a moment ago — wait a minute before asking for another email.';
  if (/signups not allowed|signup.*disabled|user not found/i.test(text)) return 'That address has no account here — sign up first.';
  if (/database error|unexpected_failure|check_violation|duplicate key/i.test(text)) return 'That account could not be saved — try another username.';
  if (/failed to fetch|networkerror|load failed/i.test(text)) return 'No connection to the account service. Check the network and try again.';
  if (/should be at least/i.test(text)) return text;
  return fallback;
}

/* ---------- which step is on screen ---------- */

function showStep(step) {
  entryEl.hidden = step !== 'entry';
  codeStep.hidden = step !== 'code';
  sentStep.hidden = step !== 'sent';
  recoverStep.hidden = step !== 'recover';
  if (step !== 'code' && step !== 'sent') {
    clearInterval(cooldownTimer);
    coolingButton = null;
  }
}

function startCooldown(button, label) {
  let left = RESEND_SECONDS;
  clearInterval(cooldownTimer);
  coolingButton = button;
  const paint = () => {
    if (left <= 0) {
      clearInterval(cooldownTimer);
      coolingButton = null;
      button.disabled = false;
      button.textContent = label;
      return;
    }
    button.disabled = true;
    button.textContent = `${label} (${left}s)`;
    left -= 1;
  };
  paint();
  cooldownTimer = setInterval(paint, 1000);
}

/** The shape of the username, before anyone is asked about it. */
function usernameProblem(name) {
  if (!name) return 'Pick a username.';
  if (!USERNAME_RE.test(name)) return 'A username is 3–20 characters: letters, numbers, dot, dash or underscore.';
  return '';
}

function showTab(which) {
  const tab = TABS[which];
  const signup = which === 'signup';
  activeTab = which;
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

/** Step two of a log in, with the address that was actually mailed. */
function showCodeStep(email) {
  pendingEmail = email;
  codeInput.value = '';
  showStep('code');
  titleEl.textContent = 'Check your email';
  leadEl.textContent = `We sent a code to ${email}. Enter it to finish logging in.`;
  say('');
  codeInput.focus();
  startCooldown(codeResend, 'Send a new code');
}

/** Signup finished without a session: the address has to be confirmed. */
function showSentStep(email) {
  pendingEmail = email;
  showStep('sent');
  titleEl.textContent = 'Confirm your email';
  leadEl.textContent = 'One link, one click, and the scanner opens.';
  // Built as nodes, not a template: an address is text, never markup.
  const strong = document.createElement('strong');
  strong.textContent = email;
  sentNote.replaceChildren(
    document.createTextNode('We sent a link to '),
    strong,
    document.createTextNode('. Open it on this device and you land back here, already signed in. Nothing happens until it is clicked.'),
  );
  say('The link is on its way — check spam if it is not there in a minute.', 'ok');
  startCooldown(sentResend, 'Send the email again');
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
signupUsername.addEventListener('blur', async () => {
  const name = signupUsername.value.trim();
  usernameState.className = 'auth-hint';
  if (usernameProblem(name)) {
    usernameState.textContent = '';
    return;
  }
  usernameState.textContent = 'Checking…';
  try {
    const taken = await usernameTaken(name);
    usernameState.className = `auth-hint ${taken ? 'bad' : 'good'}`;
    usernameState.textContent = taken ? `${name} is taken.` : `${name} is free.`;
  } catch {
    usernameState.textContent = '';
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

  setBusy(true, 'Checking that username…');
  try {
    // The check is a courtesy: it says "taken" while the form is still open. If
    // the check itself cannot run, the signup below is still the thing that
    // decides, so it goes ahead.
    let taken = false;
    try {
      taken = await usernameTaken(username);
    } catch {
      taken = false;
    }
    if (taken) {
      usernameState.className = 'auth-hint bad';
      usernameState.textContent = `${username} is taken.`;
      return say('That username is taken — try another.', 'error');
    }
    say('Creating your account…');
    const created = await signUp(email, password, username);

    if (created?.session) {
      say('You are in. Opening the scanner…', 'ok');
      location.assign(SCANNER);
      return;
    }

    // No session: the project confirms addresses by email first. That is the
    // flow we want, so say what to do rather than treating it as an error.
    loginEmail.value = email;
    showSentStep(email);
  } catch (error) {
    say(friendly(error, 'Could not create that account.'), 'error');
  } finally {
    setBusy(false);
  }
});

/* ---------- log in: password, then the code ---------- */
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!EMAIL_RE.test(email)) return say('That does not look like an email address.', 'error');
  if (!password) return say('Your password, please.', 'error');

  setBusy(true, 'Logging you in…');
  redirectBlocked = true;
  try {
    await signIn(email, password);
    // The password is right. The session it just made is not the one we keep:
    // it only proves the password, and this login has two proofs.
    say('Sending your code…');
    try {
      await sendLoginCode(email);
    } finally {
      await signOut('local');
    }
    loginPassword.value = '';
    showCodeStep(email);
  } catch (error) {
    if (/email not confirmed/i.test(String(error?.message || ''))) {
      // The address was never confirmed, so the password alone cannot finish.
      // The confirmation email is what is missing, so offer it again.
      loginEmail.value = email;
      showSentStep(email);
    } else {
      say(friendly(error, 'That did not work — check the email and password.'), 'error');
    }
  } finally {
    redirectBlocked = false;
    setBusy(false);
  }
});

/* ---------- the code ---------- */
// The length is the project's choice (6 to 10 digits, set in Supabase), so this
// takes whatever digits arrive rather than guessing. Typing six and firing early
// would eat a wrong attempt on a project set to eight.
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 10);
});

codeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const code = codeInput.value.trim();
  if (!/^\d{6,10}$/.test(code)) return say('Paste the whole code from the email — six to ten digits.', 'error');

  setBusy(true, 'Checking the code…');
  try {
    await verifyLoginCode(pendingEmail, code);
    say('You are in. Opening the scanner…', 'ok');
    location.assign(SCANNER);
  } catch (error) {
    say(friendly(error, 'That code did not work.'), 'error');
    codeInput.select();
  } finally {
    setBusy(false);
  }
});

codeResend.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true, 'Sending a new code…');
  try {
    await sendLoginCode(pendingEmail);
    say(`A new code is on its way to ${pendingEmail}.`, 'ok');
    startCooldown(codeResend, 'Send a new code');
  } catch (error) {
    say(friendly(error, 'Could not send another code just now.'), 'error');
  } finally {
    setBusy(false);
  }
});

codeBack.addEventListener('click', () => {
  clearInterval(cooldownTimer);
  showStep('entry');
  showTab('login');
  loginEmail.value = pendingEmail;
  loginPassword.focus();
});

/* ---------- the confirmation email, again ---------- */
sentResend.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true, 'Sending the email again…');
  try {
    await resendConfirmation(pendingEmail);
    say(`Sent again to ${pendingEmail}.`, 'ok');
    startCooldown(sentResend, 'Send the email again');
  } catch (error) {
    say(friendly(error, 'Could not send that email again just now.'), 'error');
  } finally {
    setBusy(false);
  }
});

sentBack.addEventListener('click', () => {
  clearInterval(cooldownTimer);
  showStep('entry');
  showTab('login');
  loginEmail.value = pendingEmail;
  loginPassword.focus();
});

/* ---------- forgot the password ---------- */
forgotBtn.addEventListener('click', async () => {
  if (busy) return;
  const email = loginEmail.value.trim();
  if (!EMAIL_RE.test(email)) {
    say('Type your email above first, then tap “Forgot password?”.', 'error');
    loginEmail.focus();
    return;
  }
  setBusy(true, 'Sending a reset link…');
  try {
    await requestPasswordReset(email);
    // The same sentence whether or not the address has an account: the form is
    // not the place to find out who shops here.
    say(`If ${email} has an account, a reset link is on its way. Open it on this device.`, 'ok');
  } catch (error) {
    say(friendly(error, 'Could not send a reset link just now.'), 'error');
  } finally {
    setBusy(false);
  }
});

/* ---------- the reset link, opened ---------- */
function showRecover() {
  showStep('recover');
  titleEl.textContent = 'Set a new password';
  leadEl.textContent = 'Choose the password you will use from now on. The old one stops working the moment this is saved.';
  say('');
  recoveryPassword.focus();
}

recoveryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const password = recoveryPassword.value;
  const confirm = recoveryConfirm.value;
  if (password.length < PASSWORD_MIN) return say(`A password needs at least ${PASSWORD_MIN} characters.`, 'error');
  if (password !== confirm) return say('Those two passwords do not match.', 'error');

  setBusy(true, 'Saving the new password…');
  try {
    await updatePassword(password);
    recovering = false;
    say('Password changed. Opening the scanner…', 'ok');
    location.assign(SCANNER);
  } catch (error) {
    say(friendly(error, 'That link has expired — request a new one from the log in form.'), 'error');
  } finally {
    setBusy(false);
  }
});

/* ---------- arriving ---------- */

/**
 * A confirmation or reset link, read from the address bar.
 *
 * This is parsed before Supabase is even created: the client consumes the
 * tokens in the URL as it initialises, so by the time a session exists the
 * reason it exists is no longer in the address bar.
 */
function linkArrival() {
  const params = new URLSearchParams(`${window.location.search.replace(/^\?/, '')}&${window.location.hash.replace(/^#/, '')}`);
  return {
    recovery: params.get('type') === 'recovery' || (params.get('reset') === '1' && Boolean(params.get('code'))),
    problem: (() => {
      const said = `${params.get('error_code') || ''} ${params.get('error') || ''} ${params.get('error_description') || ''}`.trim();
      if (!said) return '';
      if (/expired|invalid|otp/i.test(said)) return 'That link has expired or has already been used. Log in below, or ask for a new one.';
      return 'That link could not be used. Log in below, or ask for a new one.';
    })(),
  };
}

const arrival = linkArrival();
recovering = arrival.recovery;

(async function arrive() {
  // A copy with no cloud has nothing to sign in to, and the scanner needs no
  // account of its own: say so and open the way through rather than leaving a
  // form that can only fail.
  const slow = setTimeout(() => say('Waking the account service…'), 4000);
  const config = await cloudConfig().catch(() => null);
  clearTimeout(slow);

  if (!config) {
    titleEl.textContent = 'No accounts on this copy';
    leadEl.textContent = 'This build has no cloud configured, so there is nothing to sign in to — and the scanner measures on your own device and needs no account.';
    entryEl.hidden = true;
    codeStep.hidden = true;
    sentStep.hidden = true;
    recoverStep.hidden = true;
    localBox.hidden = false;
    say('');
    return;
  }

  // A reset link outranks everything else: it carries a session that is good
  // for exactly one thing, and treating it as a login would skip the reset.
  if (recovering) {
    showRecover();
    return;
  }

  if (isAccount(await getSession())) {
    say('Already signed in — opening the scanner…', 'ok');
    location.replace(SCANNER);
    return;
  }

  if (arrival.problem) {
    showTab('login');
    say(arrival.problem, 'error');
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  say('');
})();

/**
 * A session can arrive without the form being touched: a confirmation link
 * signs the tab in as it loads, and if the project still wants email
 * confirmation, that link is the only way through. Watch for a session turning
 * up and open the scanner - except while
 * the password step holds a session it is about to give back, or while a reset
 * link is being used.
 */
onAuthChange((session, event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recovering = true;
    showRecover();
    return;
  }
  if (redirectBlocked || recovering) return;
  if (isAccount(session)) location.replace(SCANNER);
});

skipBtn.addEventListener('click', () => location.assign(SCANNER));
