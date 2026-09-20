import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentServer } from '../src/runtime/web.mjs';

test('development bootstrap separates liveness from application readiness', async () => {
  const server = createDevelopmentServer({ VEGA_ENV: 'development', VEGA_EXTERNAL_EFFECTS: 'disabled' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${origin}/health/live`)).status, 200);
    assert.equal((await fetch(`${origin}/health/ready`)).status, 503);
    assert.equal((await fetch(`${origin}/participation`, { method: 'POST' })).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('bootstrap fails closed for production or enabled external effects', () => {
  assert.throws(() => createDevelopmentServer({ VEGA_ENV: 'production', VEGA_EXTERNAL_EFFECTS: 'disabled' }));
  assert.throws(() => createDevelopmentServer({ VEGA_ENV: 'development', VEGA_EXTERNAL_EFFECTS: 'enabled' }));
});
