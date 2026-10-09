// Development runtime role only. Every database write is rolled back, including
// command journal and encrypted outbox rows. No provider or hosted deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {buildRecoveryReceipt} from '../src/recovery-receipt.mjs';
import {digest} from '../src/payments.mjs';
import {hasDurableAccess} from '../src/fulfillment.mjs';
import {fixture,booking,durable,target} from '../test/helpers/fulfillment-fixture.mjs';
const report={slice:'L6-S8A',status:'preflight',providerRequests:0,productionUntouched:true,committedBusinessWrites:0,checks:[],baselineRestored:false};
let pool,c,baseline;
const authority=fixture().a,scope=[authority.tenantId,authority.businessId];
const read=async()=> (await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',scope)).rows[0];
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error();}
 const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 pool=new pg.Pool({...applicationDatabaseOptions(input.appDatabaseUrl),max:1});input.appDatabaseUrl=null;
 c=await pool.connect();assert.equal((await c.query('select current_user as role')).rows[0].role,'vega_app_runtime');
 await c.query('begin');await c.query("set local lock_timeout='5s'");await c.query("set local idle_in_transaction_session_timeout='30s'");
 await c.query("select set_config('vega.actor_id',$1,true)",[authority.userId]);
 const rows=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',scope)).rows;assert.equal(rows.length,1);baseline=rows[0];
 const publicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
 async function persist(state){
  const before=await read(),requestId=`l6-s8a-pg-${randomUUID()}`,command={action:'l6-s8a-rollback-proof',body:{requestId}};
  const receipt=buildRecoveryReceipt({before:before.state,after:state,revision:before.revision,authority,command,result:{fixture:true},occurredAt:new Date().toISOString(),publicKey});
  await c.query('set constraints all deferred');
  await c.query('update vega_private.app_state set state=$1,revision=revision+1 where tenant_id=$2 and business_id=$3',[JSON.stringify(state),...scope]);
  await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[...scope,authority.userId,requestId,digest(command),'{}']);
  await c.query('insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[receipt.eventId,...scope,authority.userId,requestId,receipt.previousRevision,receipt.revision,receipt.payload,receipt.payloadDigest]);
  await c.query('set constraints all immediate');
  const reloaded=(await read()).state;assert.equal(digest(reloaded),digest(state));return reloaded;
 }
 for(const [name,actions] of [['soda',[]],['video',[durable]],['class-pack',[booking]],['multi-action',[booking,durable]]]){
  report.stage=name;const h=fixture(actions);Object.assign(h.state,await persist(h.state));
  assert.equal(h.fulfill().status,'issued');Object.assign(h.state,await persist(h.state));const issued=digest(h.state);
  h.fulfill();assert.equal(digest(h.state),issued);Object.assign(h.state,await persist(h.state));
  assert.equal(h.state.creditUnits.length,actions.includes(booking)?3:0);assert.equal(h.state.accessEntitlements?.length||0,actions.includes(durable)?1:0);
  if(actions.includes(durable))assert.equal(hasDurableAccess(h.state,{principalId:authority.userId,...{tenantId:scope[0],businessId:scope[1]},target}),true);
  h.refund();Object.assign(h.state,await persist(h.state));
  assert.ok((h.state.fulfillmentActions||[]).every(a=>a.status==='revoked'));assert.ok((h.state.accessEntitlements||[]).every(e=>e.state==='revoked'));
  report.checks.push({name,planRoundTrip:true,actionRoundTrip:true,replayUnchanged:true,refundRoundTrip:true});
 }
 await c.query('rollback');await c.query('begin read only');await c.query("select set_config('vega.actor_id',$1,true)",[authority.userId]);
 const after=await read();assert.equal(after.revision,baseline.revision);assert.equal(digest(after.state),digest(baseline.state));await c.query('rollback');
 report.baselineRestored=true;report.status='passed';report.stage='complete';
}catch{
 report.status='stopped';process.exitCode=1;
 if(c)await c.query('rollback').catch(()=>{});
}finally{
 c?.release();await pool?.end();
 await fs.writeFile(new URL('../docs/layer-6/l6-s8a-postgres.local.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(report.status==='passed'?'L6-S8A PostgreSQL proof passed. All writes rolled back.':'L6-S8A PostgreSQL proof stopped. No secret details printed.');
}
