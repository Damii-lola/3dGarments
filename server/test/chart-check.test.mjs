import { test } from 'node:test';
import assert from 'node:assert/strict';

// This file runs in its own process, so clearing the credential here makes the
// suite offline: the checker skips the AI, and the assertions are about the part
// that must work on every deployment, not about a model's mood.
delete process.env.CLOUDFLARE_ACCOUNT_ID;
delete process.env.CLOUDFLARE_API_TOKEN;

/**
 * The vague-label catch runs before the AI is called, so these tests spend no
 * tokens and cannot fail because a model is slow or a key is missing. They are
 * the half of the checker that must work on every deployment.
 */
async function checker() {
  return import('../src/lib/cloudflare.js');
}

test('a bare "length" is refused, and the advice says what to write instead', async () => {
  const { checkChartColumns } = await checker();
  const verdict = await checkChartColumns(['Chest', 'length']);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problem, /body length|sleeve length/i);
});

test('the same mistake is caught whatever the case or surrounding spaces', async () => {
  const { checkChartColumns } = await checker();
  const verdict = await checkChartColumns(['  LENGTH  ']);
  assert.equal(verdict.ok, false);
});

test('a measured name is not mistaken for a vague one', async () => {
  const { checkChartColumns } = await checker();
  const verdict = await checkChartColumns(['Sleeve length', 'Body length']);
  // Either the model is configured and says yes, or it is not and the checker
  // skips; neither may be a refusal.
  assert.equal(verdict.ok, true);
});

test('no labels means nothing to check', async () => {
  const { checkChartColumns } = await checker();
  assert.deepEqual(await checkChartColumns([]), { ok: true, skipped: true });
});
