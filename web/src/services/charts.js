/**
 * Size charts: what a store keeps, and what a shopper's link reads.
 *
 * One table, two sides of it:
 *
 *   - the store's own rows (list / save / remove) go straight to the table, and
 *     RLS keeps them to their owner — `auth.uid() = user_id` and nothing else;
 *   - the shopper's side goes through `chart_by_code()`, a SECURITY DEFINER
 *     function that returns one row by its code and no listing. A shopper has no
 *     account here, so the code in the link is the only thing that opens a chart
 *     — which is also why the code is random rather than an id anyone could count
 *     up from.
 *
 * The numbers are stored exactly as they were typed, in the unit they were typed
 * in, and the sizing engine converts. A chart also carries the columns it was
 * typed under — the store's own names, and which body measurement each one
 * stands for — so that a chart with a shoulder column is scored on the shoulder,
 * and a chart with a body-length column shows that length without pretending it
 * can be read off a body. This file does not do arithmetic on any of it: it moves
 * rows.
 */
import { supabaseClient } from './auth.js';
import { api } from './api.js';

/**
 * A link code: 12 characters, lowercase, from an alphabet with no `l` and no
 * `0`/`1`, because a code that gets read out over a phone or copied off a screen
 * should not have two characters that look alike. 31^12 is far past guessable.
 */
const CODE_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function newCode(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** True when the column a JSON row carries is a real number. */
const num = (v) => Number.isFinite(Number(v)) && String(v).trim() !== '';

/**
 * The columns a saved chart is scored on: the ones this app can measure, carried
 * by every row. Decided the same way the server decides it — the first such
 * column picks the size and the rest join the same comparison — so the
 * dashboard's "scored on…" line cannot disagree with the score.
 */
export function chartColumns(chart) {
  const rows = Array.isArray(chart?.rows) ? chart.rows : [];
  const cols = Array.isArray(chart?.columns) ? chart.columns : [];
  return cols
    .filter((c) => c && typeof c.label === 'string' && c.measure)
    .filter((c) => rows.every((r) => num(r?.[c.id])));
}

/* ---------- the store's side ---------- */

/**
 * The table or function this needs is not in the project yet. Supabase answers a
 * missing table with 42P01 (Postgres) or PGRST205 (its own schema cache), and a
 * missing function with 42883 / PGRST202 — all of which mean the same thing to
 * whoever is looking at the screen: run the SQL from the README, then reload.
 */
export function notSetUp(error) {
  const code = String(error?.code || '');
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) return true;
  return /does not exist|schema cache|not find the (table|function)/i.test(String(error?.message || ''));
}

/** The charts this account owns, newest first. Signed out (or local mode) = none. */
export async function listCharts() {
  const client = await supabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('size_charts')
    .select('id, code, name, sex, unit, columns, rows, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Write one chart — a new one, or the one being edited. The code is generated
 * here rather than by the database, so the store can be handed its link the
 * moment the row lands; a collision (essentially impossible, but a unique index
 * is a unique index) is answered by asking for another code once.
 */
export async function saveChart({ id, name, sex, unit, columns, rows }) {
  const client = await supabaseClient();
  if (!client) throw new Error('cloud not configured');
  const row = { name: name.trim().slice(0, 60), sex, unit, columns, rows };
  if (id) {
    const { data, error } = await client.from('size_charts').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await client
      .from('size_charts')
      .insert({ ...row, code: newCode() })
      .select()
      .single();
    if (!error) return data;
    if (String(error.code) !== '23505') throw error;
  }
  throw new Error('could not find a free link code — please try again');
}

/**
 * Ask the server to read a chart's column names the way a shopper would: is each
 * one spelt correctly, and does it say what it measures? A bare "length" does
 * not, and a name nobody can parse is a column nobody can trust.
 *
 * `{ ok: false, problem }` is the only answer that stops a save. A checker that
 * cannot run — no Cloudflare key, no network, a model that rambles — comes back
 * as `{ ok: true, skipped: true }`, because the AI is a second opinion, not a
 * gate that can lock a store out of its own dashboard.
 */
export async function checkChartColumns(labels) {
  try {
    const result = await api('/api/chart-check', {
      method: 'POST',
      body: { labels },
      timeout: 15_000,
    });
    if (result && result.ok === false && typeof result.problem === 'string') {
      return { ok: false, problem: result.problem };
    }
    return { ok: true };
  } catch {
    return { ok: true, skipped: true };
  }
}

export async function removeChart(id) {
  const client = await supabaseClient();
  if (!client) throw new Error('cloud not configured');
  const { error } = await client.from('size_charts').delete().eq('id', id);
  if (error) throw error;
}

/**
 * The shopper's side: one chart, by code. No session, no account — the function
 * is granted to `anon`, which is the role a stranger's browser is. Returns null
 * for a code that matches nothing (a link that has been deleted, or a typo).
 */
export async function chartByCode(code) {
  const client = await supabaseClient();
  if (!client || !code) return null;
  const { data, error } = await client.rpc('chart_by_code', { candidate: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    name: typeof row.name === 'string' ? row.name : '',
    sex: row.sex === 'female' || row.sex === 'male' ? row.sex : 'unisex',
    unit: row.unit === 'cm' ? 'cm' : 'in',
    columns: Array.isArray(row.columns) ? row.columns : [],
    rows: Array.isArray(row.rows) ? row.rows : [],
  };
}
