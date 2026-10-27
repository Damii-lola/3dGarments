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
 *   GmailAPI      = 16-char Gmail App Password (NOT your regular password)
 *   GMAIL_IMAP_HOST = imap.gmail.com  (optional)
 *   GMAIL_IMAP_PORT = 993             (optional)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Imap = require('imap');
import { config } from '../config.js';
import { db } from '../lib/supabase.js';

/** Search terms: unread emails from Selar mentioning payment/order/purchase */
const SEARCH_CRITERIA = ['UNSEEN', ['FROM', 'selar.com']];

/** How often to poll (ms). 5 minutes. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Email regex for finding the buyer's address in the raw email text. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

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

/** Fetch raw body of a single email by UID and extract buyer email + subject. */
async function parseEmail(imap, uid) {
  return new Promise((resolve) => {
    const f = imap.fetch([uid], { bodies: ['HEADER.FIELDS (SUBJECT)', 'TEXT'], struct: true });
    let subject = '';
    let text = '';
    let gotSubject = false;
    let gotText = false;

    f.on('message', (msg, seqno) => {
      msg.on('body', (stream, info) => {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks).toString('utf-8');
          if (info.which === 'HEADER.FIELDS (SUBJECT)') {
            subject = buffer.replace(/^Subject:\s*/i, '').trim();
            gotSubject = true;
          } else if (info.which === 'TEXT') {
            text = buffer;
            gotText = true;
          }
        });
      });
      msg.on('end', () => {
        if (!gotSubject) subject = '';
        if (!gotText) text = '';
        resolve({ buyerEmail: null, subject, text });
      });
    });
    f.on('error', () => resolve({ buyerEmail: null, subject: '', text: '' }));
  }).then(async ({ subject, text }) => {
    // The buyer's email is usually in the email body text. Strip HTML tags.
    const plain = text.replace(/<[^>]*>/g, ' ');
    const emails = [...plain.matchAll(EMAIL_RE)].map((m) => m[0]);

    const storeEmail = config.gmail.user?.toLowerCase();
    // Filter out the store owner's own email — the buyer is someone else.
    const candidateEmails = emails.filter((e) => e.toLowerCase() !== storeEmail);

    return {
      buyerEmail: candidateEmails[0] || null,
      subject,
    };
  });
}

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

    // Fetch all headers/subjects at once to parse.
    const fetchResult = await new Promise((resolve, reject) => {
      const f = imap.fetch(search, { bodies: ['HEADER.FIELDS (SUBJECT)', 'TEXT'] });
      const results = [];
      f.on('message', (msg, seqno) => {
        let subject = '';
        let text = '';
        msg.on('body', (stream, info) => {
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            const buffer = Buffer.concat(chunks).toString('utf-8');
            if (info.which === 'HEADER.FIELDS (SUBJECT)') {
              subject = buffer.replace(/^Subject:\s*/i, '').trim();
            } else if (info.which === 'TEXT') {
              text = buffer;
            }
          });
        });
        msg.on('end', () => {
          results.push({ uid: seqno, subject, text });
        });
      });
      f.on('error', reject);
      f.on('end', () => resolve(results));
    });

    let activated = 0;
    const { data: users } = await db().auth.admin.listUsers();

    for (const item of fetchResult) {
      const plain = item.text.replace(/<[^>]*>/g, ' ');
      const emails = [...plain.matchAll(EMAIL_RE)].map((m) => m[0]);
      const storeEmail = config.gmail.user?.toLowerCase();
      const candidateEmails = emails.filter((e) => e.toLowerCase() !== storeEmail);
      const buyerEmail = candidateEmails[0];

      if (!buyerEmail) continue;

      // Look up the buyer by email in Supabase auth.
      const user = users?.users.find((u) => String(u.email || '').toLowerCase() === buyerEmail.toLowerCase());
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
    console.log('[gmail-poll] not configured — set GMAIL_USER and GmailAPI in Render');
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
