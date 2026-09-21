import pg from 'pg';
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import { databaseOptions, checkIngestionDatabase, runtimeRole } from './runtime/database.mjs';
import { squareNotificationUrl } from './runtime/square-webhook.mjs';
const serviceId = 'srv-dao5cjbm8hqs73db51j0';
// Only a SCRAM verifier crosses the operator SQL connection, never the password.
export function scramVerifier(password) {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const client = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(client).digest('base64');
  const server = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
}
export async function handoffIngestion(input, { Client = pg.Client, fetcher = fetch } = {}) {
  let stage = 'configuration_validation'; let admin; let runtime;
  async function render(path, method = 'GET', body) {
    const r = await fetcher(`https://api.render.com/v1/services/${serviceId}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${input.renderApiKey}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error('Render request failed');
    return r.json();
  }
  try {
    const config = databaseOptions(input.databaseUrl);
    const operator = databaseOptions(input.adminDatabaseUrl, { operator: true });
    if (!input.renderApiKey || !input.squareSignature || input.squareNotificationUrl !== squareNotificationUrl || !/^[a-f0-9]{40}$/.test(input.commit)) throw new Error('Missing configuration');
    stage = 'Render_development_service_identity';
    const service = await render('');
    if (service.id !== serviceId || service.name !== 'vega-development-web' || service.ownerId !== 'tea-dand3tajnfac7387vm30' || service.environmentId !== 'evm-dao55pijnfac73akca10' || service.repo?.replace(/\.git$/, '') !== 'https://github.com/acruxfarmer/vegadancelab' || service.serviceDetails?.url !== 'https://vega-development-web.onrender.com') throw new Error('Wrong service');
    stage = 'operator_database_connection';
    admin = new Client(operator); await admin.connect();
    stage = 'restricted_login_activation';
    const roles = await admin.query('select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname=$1', [runtimeRole]);
    const role = roles.rows[0];
    if (roles.rows.length !== 1 || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls) throw new Error('Role not ready');
    // Activate only the pre-created NOLOGIN role. Never reset an existing login.
    if (!role.rolcanlogin) {
      const verifier = scramVerifier(config.password);
      await admin.query(`alter role vega_ingest_runtime login password '${verifier}'`);
    }
    await admin.end(); admin = null;
    stage = 'runtime_database_privilege_verification';
    runtime = new Client(config); await runtime.connect();
    await checkIngestionDatabase((sql, values) => runtime.query(sql, values));
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
  } catch { return { status: 'incomplete', stage, squareSubscriptionChanged: false }; }
  finally { try { await runtime?.end(); } catch {} try { await admin?.end(); } catch {} }
}
