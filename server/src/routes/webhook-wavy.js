import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../lib/supabase.js';
import { HttpError, ah } from '../lib/errors.js';
import { config } from '../config.js';

export const wavyWebhook = Router();

wavyWebhook.post('/', ah(async (req, res) => {
  const secret = config.wavyWebhookSecret;
  if (!secret) throw new HttpError(503, 'Wavy webhook secret is not configured');

  const signature = String(req.get('x-wavy-signature') || '');
  const givenSecret = String(req.get('x-webhook-secret') || '');
  const bodyRaw = JSON.stringify(req.body || {});
  let verified = false;
  if (signature) {
    const expected = crypto.createHmac('sha256', secret).update(bodyRaw).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    const c = Buffer.from(`sha256=${expected}`);
    verified = (a.length === b.length && crypto.timingSafeEqual(a, b)) ||
               (a.length === c.length && crypto.timingSafeEqual(a, c));
  }
  if (!verified && givenSecret) {
    const a = Buffer.from(givenSecret);
    const b = Buffer.from(secret);
    verified = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!verified) throw new HttpError(401, 'Invalid Wavy webhook signature');

  const body = req.body || {};
  const event = String(body.event || body.type || '').toLowerCase();
  if (event && !event.includes('success') && !event.includes('completed') && event !== 'payment.success') {
    return res.json({ ok: true, ignored: event });
  }

  const email = body.email ?? body.customer_email ?? body.buyer_email ?? body.customer?.email ?? body.data?.email ?? body.data?.customer_email ?? body.metadata?.email;
  if (!email) throw new HttpError(400, 'Wavy webhook has no customer email');

  const { data: users, error: listError } = await db().auth.admin.listUsers();
  if (listError) throw new HttpError(502, 'Could not look up the customer account');
  const user = users.users.find((u) => String(u.email || '').toLowerCase() === String(email).toLowerCase());
  if (!user) throw new HttpError(404, `No account found for ${email}`);

  const now = new Date();
  const paidUntil = new Date(now);
  paidUntil.setMonth(paidUntil.getMonth() + 1);

  const { error } = await db()
    .from('subscriptions')
    .upsert({
      user_id: user.id,
      plan: 'unlimited',
      status: 'active',
      wavy_transaction_id: body.transaction_id || body.id || body.reference || null,
      paid_until: paidUntil.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id' });

  if (error) throw new HttpError(500, error.message);
  res.json({ ok: true, user_id: user.id, plan: 'unlimited', status: 'active' });
  console.log(`[wavy] subscription activated for ${email}`);
}));
