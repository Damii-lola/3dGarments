import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../lib/supabase.js';
import { HttpError, ah } from '../lib/errors.js';
import { config } from '../config.js';

/**
 * POST /api/webhooks/selar
 *
 * Zapier posts a Selar sale here whenever a customer pays for the $150/month
 * unlimited plan. The body comes from Selar's webhook, forwarded by Zapier.
 *
 * We verify the shared secret (SELAR_WEBHOOK_SECRET), look the customer up by
 * email, and write a subscription row so the web app can gate chart creation.
 *
 * Open route (no bearer token) — Zapier is the caller, not a logged-in shopper —
 * so the secret header is the whole of the access control.
 */
export const selarWebhook = Router();

selarWebhook.post('/', ah(async (req, res) => {
  const secret = config.selarWebhookSecret;
  const given = String(req.get('x-selar-secret') || req.get('x-webhook-secret') || '');
  if (!secret) throw new HttpError(503, 'Selar webhook secret is not configured on the server');

  // Constant-time compare so a missing or wrong secret cannot be probed.
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !require('node:crypto').timingSafeEqual(a, b)) {
    throw new HttpError(401, 'Invalid webhook secret');
  }

  const body = req.body || {};
  // Selar's webhook payload shape depends on what Zapier mapped; accept several
  // spellings so the Zap doesn't break when Selar changes a field name.
  const email = body?.customer_email ?? body?.email ?? body?.buyer_email ?? body?.customer?.email;
  const transactionId = body?.transaction_id ?? body?.order_id ?? body?.payment_id ?? body?.id;
  const customerId = body?.customer_id ?? body?.customer?.id ?? body?.buyer_id;

  if (!email) throw new HttpError(400, 'Webhook payload has no customer email');

  // Find the user by email in Supabase auth.
  const { data: users, error: listError } = await db().auth.admin.listUsers();
  if (listError) throw new HttpError(502, 'Could not look up the customer account');
  const user = users.users.find((u) => String(u.email || '').toLowerCase() === String(email).toLowerCase());
  if (!user) throw new HttpError(404, `No account found for ${email}`);

  const now = new Date();
  const paidUntil = new Date(now);
  paidUntil.setMonth(paidUntil.getMonth() + 1); // one month from now

  const { error } = await db()
    .from('subscriptions')
    .upsert({
      user_id: user.id,
      plan: 'unlimited',
      status: 'active',
      selar_customer_id: customerId || null,
      selar_transaction_id: transactionId || null,
      paid_until: paidUntil.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id' });

  if (error) throw new HttpError(500, error.message);

  res.json({ ok: true, user_id: user.id, plan: 'unlimited', status: 'active' });
}));
