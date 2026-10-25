import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, createAttemptLog, PASSWORD_MIN } from '../src/services/account-security.js';
import { parseAppearance, shapeSettings } from '../src/services/user-settings.js';

const user = { id: 'u1', email: 'sam@okafor.co' };

/** A fake account whose real password is `actual`; records what was stored. */
function world(actual = 'old-password') {
  const stored = [];
  return {
    stored,
    verify: async (email, password) => email === user.email && password === actual,
    update: async (id, password) => { stored.push([id, password]); },
    attempts: createAttemptLog(),
  };
}

const run = (w, current, next) => changePassword({ user, current, next, verify: w.verify, update: w.update, attempts: w.attempts });
const rejects = (promise, status, pattern) =>
  assert.rejects(promise, (err) => { assert.equal(err.status, status); if (pattern) assert.match(err.message, pattern); return true; });

test('the right current password lets the new one through', async () => {
  const w = world();
  await run(w, 'old-password', 'brand-new-pass');
  assert.deepEqual(w.stored, [['u1', 'brand-new-pass']]);
});

test('a wrong current password stores nothing', async () => {
  const w = world();
  await rejects(run(w, 'not-it', 'brand-new-pass'), 403, /not right/);
  assert.equal(w.stored.length, 0);
});

test('an empty current password is refused before anything is checked', async () => {
  const w = world();
  await rejects(run(w, '', 'brand-new-pass'), 400, /current password/);
  await rejects(run(w, undefined, 'brand-new-pass'), 400);
  assert.equal(w.stored.length, 0);
});

test('a short, long, or unchanged new password is refused', async () => {
  const w = world();
  await rejects(run(w, 'old-password', 'x'.repeat(PASSWORD_MIN - 1)), 400, /at least/);
  await rejects(run(w, 'old-password', 'x'.repeat(201)), 400, /too long/);
  await rejects(run(w, 'old-password', 'old-password'), 400, /already/);
  assert.equal(w.stored.length, 0);
});

test('five wrong guesses lock the action, even for the right password', async () => {
  const w = world();
  for (let i = 0; i < 5; i += 1) await rejects(run(w, `guess-${i}`, 'brand-new-pass'), 403);
  await rejects(run(w, 'old-password', 'brand-new-pass'), 429, /Too many/);
  assert.equal(w.stored.length, 0);
});

test('the lock lifts after its time, and a success resets the count', async () => {
  let t = 1_000_000;
  const attempts = createAttemptLog({ now: () => t });
  const w = world();
  const go = (cur) => changePassword({ user, current: cur, next: 'brand-new-pass', verify: w.verify, update: w.update, attempts });
  for (let i = 0; i < 5; i += 1) await rejects(go(`guess-${i}`), 403);
  await rejects(go('old-password'), 429);
  t += 16 * 60_000;
  await go('old-password');
  assert.equal(w.stored.length, 1);
  for (let i = 0; i < 4; i += 1) await rejects(go(`again-${i}`), 403); // count started over
});

test('an account with no email cannot be checked', async () => {
  const w = world();
  await rejects(changePassword({ user: { id: 'u2' }, current: 'a', next: 'brand-new-pass', verify: w.verify, update: w.update, attempts: w.attempts }), 400, /no email/);
});

test('appearance: only what was sent, and only valid values', () => {
  assert.deepEqual(parseAppearance({ theme: 'dark' }), { theme: 'dark' });
  assert.deepEqual(parseAppearance({ accent_colour: '#F0521F', unit: 'in' }), { accent_colour: '#f0521f', default_unit: 'in' });
  for (const bad of [{ theme: 'purple' }, { accent_colour: 'red' }, { accent_colour: '#fff' }, { unit: 'mm' }, {}, null]) {
    assert.throws(() => parseAppearance(bad), (err) => err.status === 400);
  }
});

test('settings are shaped for the page, and absent until something is saved', () => {
  assert.equal(shapeSettings(null), null);
  const shaped = shapeSettings({ user_id: 'u1', theme: 'light', accent_colour: '#f0521f', default_unit: 'cm', notify_results: true, notify_digest: false, notify_marketing: false, notify_security: true, billing_email: null, tax_id: null, updated_at: 'x' });
  assert.equal(shaped.billing_email, '');
  assert.equal('user_id' in shaped, false);
});
