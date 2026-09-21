import { connectionFailure } from './database-diagnostic.mjs';
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { databaseOptions, checkIngestionDatabase } from './runtime/database.mjs';
import { squareNotificationUrl } from './runtime/square-webhook.mjs';
const serviceId = 'srv-dao5cjbm8hqs73db51j0';
export async function handoffIngestion(input, { Client = pg.Client, fetcher = fetch } = {}) {
  let stage = 'configuration_validation'; let runtime;
  async function render(path, method = 'GET', body) {
    const r = await fetcher(`https://api.render.com/v1/services/${serviceId}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${input.renderApiKey}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error('Render request failed');
    return r.json();
  }
  try {
    const config = databaseOptions(input.databaseUrl);
    if (!input.renderApiKey || !input.squareSignature || input.squareNotificationUrl !== squareNotificationUrl || !/^[a-f0-9]{40}$/.test(input.commit)) throw new Error('Missing configuration');
    stage = 'restricted_database_connection';
    runtime = new Client(config); await runtime.connect();
    stage = 'runtime_database_privilege_verification';
    await checkIngestionDatabase((sql, values) => runtime.query(sql, values));
    stage = 'Render_development_service_identity';
    const service = await render('');
    if (service.id !== serviceId || service.name !== 'vega-development-web' || service.ownerId !== 'tea-dand3tajnfac7387vm30' || service.environmentId !== 'evm-dao55pijnfac73akca10' || service.repo?.replace(/\.git$/, '') !== 'https://github.com/acruxfarmer/vegadancelab' || service.serviceDetails?.url !== 'https://vega-development-web.onrender.com') throw new Error('Wrong service');
    stage = 'runtime_database_insert_verification';
    // Roll back the probe: verifies INSERT/RLS without leaving an intake event.
    await runtime.query('begin');
    const eventId = `vega-provision-${randomBytes(16).toString('hex')}`;
    const event = { event_id: eventId, type: 'payment.created', merchant_id: 'vega-synthetic-verification' };
    const hash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    await runtime.query('insert into vega_private.square_webhook_inbox(event_id,event_type,merchant_id,body_sha256,payload) values($1,$2,$3,$4,$5::jsonb)', [eventId,event.type,event.merchant_id,hash,JSON.stringify(event)]);
    await runtime.query('rollback');
    await runtime.end(); runtime = null;
    stage = 'Render_ingestion_environment';
    const variables = { VEGA_ENV: 'development', VEGA_EXTERNAL_EFFECTS: 'disabled', DATABASE_URL: input.databaseUrl, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_WEBHOOK_SIGNATURE_KEY: input.squareSignature, SQUARE_WEBHOOK_NOTIFICATION_URL: squareNotificationUrl };
    for (const [key,value] of Object.entries(variables)) await render(`/env-vars/${key}`, 'PUT', { value });
    stage = 'Render_build_configuration';
    await render('', 'PATCH', { autoDeploy: 'no', serviceDetails: { envSpecificDetails: { buildCommand: 'pnpm install --frozen-lockfile --ignore-scripts && node --test', startCommand: 'node scripts/start-web.mjs' } } });
    stage = 'Render_deployment_request';
    const deployment = await render('/deploys', 'POST', { commitId: input.commit });
    return { status: 'ingestion_deployment_requested', databasePrivileges: 'verified', syntheticDatabaseInsert: 'passed_and_rolled_back', deploymentId: deployment.id, commit: input.commit, squareSubscriptionChanged: false };
  } catch(error) { return { status: 'incomplete', stage, ...(stage==='restricted_database_connection'?connectionFailure(error):{}), squareSubscriptionChanged: false }; }
  finally { try { await runtime?.end(); } catch {} }
}
