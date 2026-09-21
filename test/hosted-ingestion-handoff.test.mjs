import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffIngestion } from '../src/hosted-ingestion-handoff.mjs';
const input={databaseUrl:'postgresql://vega_ingest_runtime.cjdoczrxcjynjhgpgqop:synthetic-password@aws-0-us-west-1.pooler.supabase.com:5432/postgres',adminDatabaseUrl:'postgresql://postgres.cjdoczrxcjynjhgpgqop:synthetic-admin@aws-0-us-west-1.pooler.supabase.com:5432/postgres',renderApiKey:'synthetic-render',squareSignature:'synthetic-signature',squareNotificationUrl:'https://vega-development-web.onrender.com/webhooks/square',commit:'a'.repeat(40)};
function mocks({login=false,wrongService=false,connectionError}={}) {
  const sql=[];const requests=[];
  class Client {
    constructor(config){assert.ok(config.user.startsWith('vega_ingest_runtime.'));assert.equal(config.ssl.rejectUnauthorized,true);}
    async connect(){if(connectionError)throw Object.assign(new Error('synthetic-secret-must-not-leak'),{code:connectionError});} async end(){}
    async query(text,values){
      sql.push({text,values});
      if(text.startsWith('select rolcanlogin'))return {rows:[{rolcanlogin:login}]};
      if(text.startsWith('select current_user'))return {rows:[{role:'vega_ingest_runtime',can_select:true,can_insert:true,forced_rls:true,inherits_ingest:true}]};
      return {rows:[]};
    }
  }
  const fetcher=async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.redirect,'error');
    if(options.method==='GET')return Response.json({id:'srv-dao5cjbm8hqs73db51j0',name:wrongService?'production':'vega-development-web',ownerId:'tea-dand3tajnfac7387vm30',environmentId:'evm-dao55pijnfac73akca10',repo:'https://github.com/acruxfarmer/vegadancelab',serviceDetails:{url:'https://vega-development-web.onrender.com'}});
    return Response.json({id:'synthetic-deploy'});
  };
  return {Client,fetcher,sql,requests};
}
test('handoff verifies existing restricted login and sends ingestion allowlist to one service',async()=>{
  const m=mocks();const report=await handoffIngestion(input,m);
  assert.equal(report.status,'ingestion_deployment_requested');
  assert.ok(!m.sql.some(q=>/alter role|create role/i.test(q.text)));
  assert.ok(m.sql.some(q=>q.text==='rollback'));
  const vars=m.requests.filter(r=>r.options.method==='PUT').map(r=>r.url.split('/').at(-1));
  assert.deepEqual(vars,['VEGA_ENV','VEGA_EXTERNAL_EFFECTS','DATABASE_URL','SQUARE_ENVIRONMENT','SQUARE_WEBHOOK_SIGNATURE_KEY','SQUARE_WEBHOOK_NOTIFICATION_URL']);
  assert.ok(m.requests.every(r=>r.url.startsWith('https://api.render.com/v1/services/srv-dao5cjbm8hqs73db51j0')));
  assert.doesNotMatch(JSON.stringify(report),/synthetic-password|synthetic-admin|synthetic-render|synthetic-signature/);
});
test('existing runtime login is verified without password rotation',async()=>{
  const m=mocks({login:true});assert.equal((await handoffIngestion(input,m)).status,'ingestion_deployment_requested');
  assert.ok(!m.sql.some(q=>q.text.startsWith('alter role')));
});
test('wrong Render identity stops before database or environment mutation',async()=>{
  const m=mocks({wrongService:true});const report=await handoffIngestion(input,m);
  assert.equal(report.stage,'Render_development_service_identity');assert.equal(m.sql.length,1);assert.equal(m.requests.length,1);
});
test('restricted TLS failure stops before Render or any SQL and never falls back to operator',async()=>{
  const m=mocks({connectionError:'SELF_SIGNED_CERT_IN_CHAIN'});const report=await handoffIngestion(input,m);
  assert.equal(report.stage,'restricted_database_connection');
  assert.deepEqual(report.codes,['SELF_SIGNED_CERT_IN_CHAIN']);
  assert.equal(report.authentication,'not_reached');
  assert.equal(m.sql.length,0);assert.equal(m.requests.length,0);
  assert.doesNotMatch(JSON.stringify(report),/synthetic-secret/);
});
