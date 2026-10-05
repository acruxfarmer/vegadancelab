import fs from 'node:fs';
import {sha,requireThat} from '../contract.mjs';
import {qualifyRoute} from '../../scripts/qualify-development-admin-route.mjs';
import {PROPOSAL_HASH,PROJECT,developmentConnectionOptions,classifyCatalog,LOCK} from '../../src/lifecycle-migration-runner.mjs';
import {databaseTls} from '../../src/runtime/database-tls.mjs';
import {verifiedTls} from '../../scripts/qualify-development-admin-route.mjs';
import pg from 'pg';

async function inspect(manifest,secret) {
  const config = developmentConnectionOptions(secret);
  config.ssl = databaseTls(config.host);
  config.options = '-c default_transaction_read_only=on';
  config.statement_timeout = 10000; config.query_timeout = 12000;
  const client = new pg.Client(config); client.on('error',()=>{});
  try {
    await client.connect(); verifiedTls(client,config.host);
    const identity = (await client.query('SELECT current_database() AS db,current_user AS role,session_user AS session_role,pg_backend_pid() AS pid')).rows[0];
    requireThat(identity.db === 'postgres' && identity.role === 'postgres' && identity.session_role === 'postgres', 'DATABASE_IDENTITY');
    requireThat((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[LOCK])).rows[0].acquired, 'LOCK_UNAVAILABLE');
    const baselineQuery = "SELECT revision::text AS revision,encode(sha256(convert_to(state::text,'UTF8')),'hex') AS digest FROM vega_private.app_state WHERE tenant_id=$1 AND business_id=$2";
    const args = [manifest.target.tenant,manifest.target.business];
    const before = (await client.query(baselineQuery,args)).rows;
    requireThat(before.length === 1 && before[0].revision === String(manifest.expectedPreState.revision) && before[0].digest === manifest.expectedPreState.digest, 'BASELINE_MISMATCH');
    const catalog = await classifyCatalog(client,'postgres');
    const after = (await client.query(baselineQuery,args)).rows;
    requireThat(JSON.stringify(before) === JSON.stringify(after), 'BASELINE_CHANGED');
    requireThat((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid === identity.pid, 'SESSION_CHANGED');
    return {catalog,revisionUnchanged:true,backendPid:identity.pid};
  } finally { await client.end(); config.password = undefined; }
}

export async function qualifyVega(manifest,secret) {
  requireThat(manifest.target.adapter === 'vega-development/1' && manifest.target.project === PROJECT && manifest.target.database === 'postgres' && manifest.target.environment === 'development' && manifest.target.tenant === 'vega-development' && manifest.target.business === 'vega-dance-lab', 'TARGET_ADAPTER_MISMATCH');
  requireThat(manifest.payloadDigest === PROPOSAL_HASH && sha(fs.readFileSync(new URL('../../db/proposals/authorization-lifecycle-v1.sql',import.meta.url))) === PROPOSAL_HASH, 'PAYLOAD_HASH');
  if (manifest.operation === 'inspect-recovery') {
    const result = await inspect(manifest,secret);
    return {state:'reconciled_'+result.catalog.classification,evidence:{resultDigest:sha(JSON.stringify(result)),catalogDigest:result.catalog.digest,catalogClassification:result.catalog.classification,backendPid:result.backendPid,revisionUnchanged:true,tlsVerified:true,sessionAffinity:true,migrationDispatched:false}};
  }
  const pre = await inspect(manifest,secret);
  requireThat(pre.catalog.classification === manifest.expectedPreState.catalog, 'CATALOG_PRESTATE_MISMATCH');
  const result = await qualifyRoute(secret);
  if (result.status !== 'PASS') throw Error('ROUTE_NOT_QUALIFIED');
  const post = await inspect(manifest,secret);
  requireThat(pre.catalog.digest === post.catalog.digest, 'CATALOG_CHANGED');
  return {state:'qualified',evidence:{resultDigest:sha(JSON.stringify({pre,result,post})),catalogDigest:post.catalog.digest,catalogClassification:post.catalog.classification,backendPid:result.sessions[0].pid,revisionUnchanged:true,sessionAffinity:true,tlsVerified:true,lockAcquired:true,competingRejected:true,released:true,migrationDispatched:false}};
}
