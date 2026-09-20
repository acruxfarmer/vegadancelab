import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { squareNotificationUrl, verifySquareSignature } from '../src/runtime/square-webhook.mjs';
import { createDevelopmentServer } from '../src/runtime/web.mjs';

test('Square signature binds exact raw body and subscription URL', () => {
  const body = Buffer.from('{ "event_id": "test" }');
  const key = 'synthetic-test-key';
  const signature = createHmac('sha256', key).update(squareNotificationUrl).update(body).digest('base64');
  assert.equal(verifySquareSignature(body, signature, key), true);
  assert.equal(verifySquareSignature(Buffer.from('{"event_id":"test"}'), signature, key), false);
  assert.equal(verifySquareSignature(body, signature, 'wrong-key'), false);
  assert.equal(verifySquareSignature(body, 'bad', key), false);
});

test('webhook rejects unsigned requests and never acknowledges unstored events', async () => {
  const key = 'synthetic-test-key';
  const server = createDevelopmentServer({ VEGA_ENV: 'development', VEGA_EXTERNAL_EFFECTS: 'disabled', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_WEBHOOK_SIGNATURE_KEY: key });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/webhooks/square`;
    const body = JSON.stringify({ event_id: 'synthetic-event', type: 'payment.updated' });
    assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
    const headers = { 'x-square-hmacsha256-signature': createHmac('sha256', key).update(squareNotificationUrl).update(body).digest('base64'), 'square-environment': 'Sandbox' };
    assert.equal((await fetch(url, { method: 'POST', body, headers })).status, 503);
    headers['square-environment'] = 'Production';
    assert.equal((await fetch(url, { method: 'POST', body, headers })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
