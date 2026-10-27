/**
 * Email monitoring for Selar payment notifications.
 *
 * Selar has no webhooks, so after a customer pays on Selar they get an email
 * receipt, and you (the store owner) get a payment notification email too.
 * This service polls your Gmail inbox via IMAP, finds Selar payment emails,
 * parses the buyer's email from them, and activates their subscription.
 *
 * Runs on a timer inside the API server (started in src/index.js).
 *
 * Format of env vars:
 *   GMAIL_USER    = findmysize.us@gmail.com
 *   GMAIL_API     = 16-char Gmail App Password (NOT your regular password)
 *   GMAIL_IMAP_HOST = imap.gmail.com  (optional)
 *   GMAIL_IMAP_PORT = 993             (optional)
 */
import { simpleParser } from 'mailparser';
import { Imap } from 'imap';
import { config } from '../config.js';
import { db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

/** Search terms: unread emails from Selar mentioning payment/order/purchase */
const SEARCH_CRITERIA = ['UNSEEN', ['FROM', 'selar.com']];

/** How often to poll (ms). 5 minutes. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** A Selar payment email typically contains the buyer's email and the amount paid. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

let pollTimer = null;
let polling = false;

/** Open an IMAP connection to Gmail. */
function connectImap() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.gmail.user,
      password: config.gmail.pass,
      host: config.gmail.imapHost,
      port: config.gmail.imapPort,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });
    imap.once('error', reject);
    imap.once('ready', () => resolve(imap));
    imap.connect();
  });
}

/** Parse a single email: return { buyerEmail, amount, subject } or null. */
async function parseEmail(imap, seqno) {
  return new Promise((resolve) => {
    const f = imap.fetch(seqno, { bodies: '', struct: true });
    let emailHtml = '';
    let emailText = '';
    let subject = '';

    f.on('message', (msg, seqno) => {
      msg.on('body', (stream, info) => {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (info.which === 'TEXT') {
            emailText = buffer.toString('utf-8');
          } else if (info.which === 'HTML') {
            emailHtml = buffer.toString('utf-8');
          }
        });
      });
      msg.on('attributes', (attrs) => {
        subject = (attrs.subject || '');
      });
      msg.on('end', async () => {
        // Try parsing the full raw email with mailparser for better structure.
        const raw = emailHtml || emailText || '';
        try {
          const parsed = await simpleParser(raw);
          const text = parsed.text || '';
          const html = parsed.html || '';
          const subjectLine = parsed.subject || '';

          const searchText = `${text} ${html} ${subjectLine}`.replace(/<[^>]*>/g, ' ');
          const emails = searchText.match(EMAIL_RE) || [];

          // The buyer's email is usually a different address than the store owner's.
          const storeEmail = config.gmail.user?.toLowerCase();
          const candidateEmails = emails.filter((e) => e.toLowerCase() !== storeEmail);

          resolve({
            buyerEmail: candidateEmails[0] || null,
            amount: null, // we don't strictly need the amount
            subject: subjectLine,
          });
        } catch {
          resolve({ buyerEmail: null, amount: null, subject });
        }
      });
    });
    f.on('error', () => resolve({ buyerEmail: null, amount: null, subject: '' }));
  });
}

/** Mark an email as read (remove \\Seen flag). Not needed; we just mark seen by fetching. */

/** Poll Gmail once: find unread Selar emails, parse them, activate subscriptions. */
export async function pollGmailOnce() {
  if (polling) return;
  if (!config.gmail.user || !config.gmail.pass) return; // not configured

  polling = true;
  let imap;
  try {
    imap = await connectImap();

    await new Promise((resolve, reject) => {
      imap.once('error', reject);
      imap.openBox('INBOX', false, (err) => (err ? reject(err) : resolve()));
    });

    const search = await new Promise((resolve, reject) => {
      imap.search(SEARCH_CRITERIA, (err, uids) => (err ? reject(err) : resolve(uids || [])));
    });

    if (!search.length) {
      imap.end();
      return { checked: 0, found: 0, activated: 0 };
    }

    let activated = 0;
    for (const uid of search) {
      const parsed = await parseEmail(imap, uid);
      if (!parsed.buyerEmail) continue;

      // Look up the buyer by email in Supabase auth.
      const { data: users } = await db().auth.admin.listUsers();
      const user = users?.users.find((u) => String(u.email || '').toLowerCase() === parsed.buyerEmail.toLowerCase());
      if (!user) continue;

      // Check if already active.
      const { data: existing } = await db().from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
      if (existing?.status === 'active' && new Date(existing.paid_until) > new Date()) continue;

      // Activate their plan.
      const now = new Date();
      const paidUntil = new Date(now);
      paidUntil.setMonth(paidUntil.getMonth() + 1);

      await db().from('subscriptions').upsert({
        user_id: user.id,
        plan: 'unlimited',
        status: 'active',
        selar_customer_id: null,
        selar_transaction_id: null,
        paid_until: paidUntil.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: 'user_id' });

      activated += 1;
    }

    imap.end();
    return { checked: search.length, found: search.length, activated };
  } catch (e) {
    console.error('[gmail-poll] error:', e.message);
    try { imap?.end(); } catch { /* ignore */ }
    throw e;
  } finally {
    polling = false;
  }
}

/** Start the recurring poll timer. */
export function startGmailPoll() {
  if (!config.gmail.user || !config.gmail.pass) {
    console.log('[gmail-poll] not configured — set GMAIL_USER and GMAIL_API in Render');
    return;
  }
  // Do an immediate poll, then repeat.
  pollGmailOnce().then((r) => console.log('[gmail-poll]', r)).catch(() => {});
  pollTimer = setInterval(() => {
    pollGmailOnce().then((r) => console.log('[gmail-poll]', r)).catch(() => {});
  }, POLL_INTERVAL_MS);
  console.log(`[gmail-poll] started for ${config.gmail.user}, polling every ${POLL_INTERVAL_MS / 1000}s`);
}

/** Stop the poll timer (for tests/shutdown). */
export function stopGmailPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
