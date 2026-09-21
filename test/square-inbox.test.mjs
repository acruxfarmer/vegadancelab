import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { createDevelopmentServer } from '../src/runtime/web.mjs';
import { squareNotificationUrl } from '../src/runtime/square-webhook.mjs';
import { createSquareInboxWriter } from '../src/runtime/square-inbox.mjs';

test('inbox detects a conflicting body for the same event without overwriting it', async () => {
  const event = { event_id: 'e', merchant_id: 'm', type: 'payment.created' };
  const body = Buffer.from(JSON.stringify(event));
  const digest = createHash('sha256').update(body).digest('hex');
  const query = async (sql) => ({ rows: sql.startsWith('insert') ? [] : [{ body_sha256: digest }] });
  const save = createSquareInboxWriter(query);
  assert.equal(await save(event, body), 'duplicate');
  assert.equal(await save(event, Buffer.from(JSON.stringify({ ...event, unexpected: true }))), 'conflict');
});

test('verified webhook acknowledges only successful storage and retries database outages', async () => {
  const key = 'synthetic-key';
  let outcome = 'stored';
  const server = createDevelopmentServer({ VEGA_ENV: 'development', VEGA_EXTERNAL_EFFECTS: 'disabled', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_WEBHOOK_SIGNATURE_KEY: key }, async () => { if (outcome === 'outage') throw new Error('Synthetic outage'); return outcome; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = JSON.stringify({ event_id: 'e', type: 'payment.created', merchant_id: 'm' });
    const options = { method: 'POST', body, headers: { 'square-environment': 'Sandbox', 'x-square-hmacsha256-signature': createHmac('sha256', key).update(squareNotificationUrl).update(body).digest('base64') } };
    const url = `http://127.0.0.1:${server.address().port}/webhooks/square`;
    for (const [value, status] of [['stored',200],['duplicate',200],['conflict',409],['outage',503]]) {
      outcome = value;
      assert.equal((await fetch(url, options)).status, status);
    }
    options.headers['x-square-hmacsha256-signature'] = 'invalid';
    assert.equal((await fetch(url, options)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
