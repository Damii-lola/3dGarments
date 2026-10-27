import { db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

const cache = new Map(); // token -> { user, exp }
const TTL = 60_000;

/** Verifies the Supabase access token sent by the web client. Sets req.user. */
export async function requireUser(req, _res, next) {
  try {
    const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) throw new HttpError(401, 'Missing bearer token');
    const token = m[1];
    const hit = cache.get(token);
    if (hit && hit.exp > Date.now()) { req.user = hit.user; return next(); }

    const { data, error } = await db().auth.getUser(token);
    if (error || !data?.user) throw new HttpError(401, 'Invalid or expired session');

    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    cache.set(token, { user: data.user, exp: Date.now() + TTL });
    req.user = data.user;
    next();
  } catch (err) {
    next(err);
  }
}
