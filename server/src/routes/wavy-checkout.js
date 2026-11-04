import { Router } from 'express';
import { HttpError, ah } from '../lib/errors.js';
import { config } from '../config.js';

export const wavyCheckout = Router();

wavyCheckout.post('/', ah(async (req, res) => {
  const secret = config.wavySecretKey;
  if (!secret) throw new HttpError(503, 'Wavy secret key is not configured');

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new HttpError(400, 'Enter a valid email');

  const amount = Number(req.body?.amount) || 15000;
  const reference = `fms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const origin = String(req.get('origin') || 'https://findmysize.org').replace(/\/$/, '');

  const response = await fetch(`${config.wavyApiBase}/api/gateway/v1/checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      description: 'FindMySize Unlimited',
      email,
      merchant_reference: reference,
      success_url: `${origin}/pricing/?paid=1`,
      cancel_url: `${origin}/pricing/?cancel=1`,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status || 502, data.message || data.error || 'Wavy checkout failed');

  const url = data.authorization_url || data.checkout_url || data.url || data.data?.authorization_url;
  if (!url) throw new HttpError(502, 'Wavy did not return a checkout URL');

  res.json({ url, reference });
}));
