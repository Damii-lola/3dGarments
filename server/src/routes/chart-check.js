import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import { checkChartColumns } from '../lib/cloudflare.js';

/**
 * A second opinion on a chart's column names before it is saved.
 *
 * It is signed-in only and rate limited because it spends Workers AI tokens:
 * the dashboard is behind an account, so there is no reason for this to be a
 * second open door. The body is a handful of short labels, never the chart.
 */
const checkLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many column checks — try again in a little while.' },
});

export const chartCheck = Router();
chartCheck.use(requireUser);

chartCheck.post('/', checkLimiter, ah(async (req, res) => {
  const raw = req.body?.labels;
  if (!Array.isArray(raw)) throw new HttpError(400, 'Send labels as an array.');
  const labels = raw
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
  if (!labels.length) throw new HttpError(400, 'Send at least one column label.');
  res.json(await checkChartColumns(labels));
}));
