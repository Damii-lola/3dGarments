/**
 * Changing a password, safely.
 *
 * The settings page asks for the CURRENT password as well as the new one, and this is
 * where it is actually checked: the old flow collected the field and never looked at
 * it, so anyone holding a logged-in browser could set a new password without knowing
 * the old one.
 *
 * Everything the check needs from the outside (how to test a password, how to store a
 * new one, the clock) is passed in, so the rules can be tested without a database.
 */
import { HttpError } from '../lib/errors.js';

/** Shown on the settings page as "at least 8 characters". */
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

/**
 * Wrong guesses per account. After a handful the account is locked out of this one
 * action for a while, so a stolen session cannot be used to guess the old password.
 * (Supabase rate-limits sign-ins as well; this is the page's own, closer, limit.)
 */
export function createAttemptLog({ now = Date.now } = {}) {
  const log = new Map(); // userId -> { fails, until }

  return {
    /** Throws while the account is locked. */
    check(userId) {
      const entry = log.get(userId);
      if (!entry) return;
      if (entry.until && entry.until <= now()) {
        log.delete(userId);
        return;
      }
      if (entry.fails >= MAX_FAILS) {
        throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes.');
      }
    },
    fail(userId) {
      const entry = log.get(userId) || { fails: 0, until: 0 };
      entry.fails += 1;
      if (entry.fails >= MAX_FAILS) entry.until = now() + LOCK_MS;
      log.set(userId, entry);
      if (log.size > 5000) log.delete(log.keys().next().value);
    },
    clear(userId) {
      log.delete(userId);
    },
  };
}

/**
 * @param {object}   args
 * @param {{id: string, email?: string}} args.user
 * @param {unknown}  args.current   the password they say they have now
 * @param {unknown}  args.next      the one they want
 * @param {(email: string, password: string) => Promise<boolean>} args.verify  true when the password is right
 * @param {(userId: string, password: string) => Promise<void>}   args.update  stores the new one
 * @param {ReturnType<typeof createAttemptLog>} args.attempts
 */
export async function changePassword({ user, current, next, verify, update, attempts }) {
  if (typeof current !== 'string' || !current) throw new HttpError(400, 'Enter your current password.');
  if (typeof next !== 'string' || next.length < PASSWORD_MIN) {
    throw new HttpError(400, `A new password needs at least ${PASSWORD_MIN} characters.`);
  }
  if (next.length > PASSWORD_MAX) throw new HttpError(400, 'That password is too long.');
  if (next === current) throw new HttpError(400, 'Choose a password you are not using already.');
  if (!user?.email) throw new HttpError(400, 'This account has no email address to check a password against.');

  attempts.check(user.id);

  if (!(await verify(user.email, current))) {
    attempts.fail(user.id);
    throw new HttpError(403, 'Your current password is not right.');
  }
  attempts.clear(user.id);

  await update(user.id, next);
}
