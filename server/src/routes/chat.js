/**
 * Site help chat. Uses the same Cloudflare Workers AI path as the body scan.
 * POST /api/chat  { question: "..." }  -> { reply: "..." }
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { runModel } from '../lib/cloudflare.js';
import { config } from '../config.js';
import { HttpError, ah } from '../lib/errors.js';

export const chat = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many questions — try again in a minute.' },
});

const SYSTEM = `You are the FindMySize help assistant. Answer briefly and clearly.
FindMySize lets clothing brands add size charts and give shoppers a 360° video size recommendation.
How it works: brand adds a chart in the dashboard, pastes an embed snippet on their product page, shopper records a short video, gets a size, video is deleted.
Pricing: $150/month for unlimited charts.
Site: https://findmysize.org
Keep answers under 80 words.`;

chat.post('/', limiter, ah(async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 500);
  if (!question) throw new HttpError(400, 'No question');

  const model = config.cloudflare.textModel || config.cloudflare.visionModel;
  if (!model) throw new HttpError(503, 'Chat is not configured');

  const result = await runModel(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: question },
    ],
    max_tokens: 120,
    temperature: 0.3,
  }, { timeoutMs: 20_000 });

  const reply = result?.response || result?.description || 'Sorry, I could not answer that.';
  res.json({ reply: String(reply).slice(0, 600) });
}));
