import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../lib/supabase.js';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import { processGroup } from '../services/groups.js';

const UUID = /^[0-9a-f-]{36}$/i;

const limiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 40,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many garment analyses — try again later.' },
});

export const groups = Router();

/** Start (or restart) processing a photo group: 202, then the app watches the row's status. */
groups.post('/:id/process', requireUser, limiter, ah(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'Invalid group id');
  const { data, error } = await db().from('garment_groups').update({ status: 'processing', error: null })
    .eq('id', req.params.id).eq('user_id', req.user.id).select('id').maybeSingle();
  if (error) throw new HttpError(502, error.message);
  if (!data) throw new HttpError(404, 'Group not found');
  processGroup({ groupId: data.id, userId: req.user.id });
  res.status(202).json({ status: 'processing' });
}));
