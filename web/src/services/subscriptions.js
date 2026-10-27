/**
 * Subscriptions: whether this account has paid for the $150/month unlimited plan.
 * Reads /api/me/subscription on the Render API, which needs a signed-in session.
 */
import { api } from './api.js';

/** @returns {Promise<{ plan, status, active, paid_until, selar_transaction_id } | null>} */
export async function subscriptionStatus() {
  try {
    return await api('/api/me/subscription');
  } catch {
    return null;
  }
}

/** True only when the account has an active, paid-up unlimited plan. */
export async function isSubscribed() {
  const sub = await subscriptionStatus();
  return Boolean(sub && sub.active);
}
