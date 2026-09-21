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
test('ingestion readiness requires live database verification and stays separate from application readiness', async () => {
  let databaseReady=true;
  const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',SQUARE_ENVIRONMENT:'sandbox',SQUARE_WEBHOOK_SIGNATURE_KEY:'synthetic',SQUARE_WEBHOOK_NOTIFICATION_URL:'https://vega-development-web.onrender.com/webhooks/square'},async()=> 'stored',async()=>{if(!databaseReady)throw new Error('Unavailable');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${origin}/health/ingestion`)).status,200);
    assert.equal((await fetch(`${origin}/health/ready`)).status,503);
    databaseReady=false;
    assert.equal((await fetch(`${origin}/health/ingestion`)).status,503);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
