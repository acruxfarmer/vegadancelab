import {boundedRefundReadiness} from '../src/bounded-refund-readiness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {digest} from '../src/payments.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const publicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
const stamp='2026-10-05T23:00:00Z';
function harness(){
 let data={state:structuredClone(fixture),revision:127,commands:[],outbox:[]},tail=Promise.resolve();
 const h={role:'staff',changed:false,failOutbox:false,queries:[]};
 const member=()=>({tenant_id:'vega-development',business_id:'vega-dance-lab',role:h.role,participant_ids:[]});
 const pool={async connect(){let local,unlock,members=0;return {release(){unlock?.();unlock=null;},async query(sql,args=[]){
  h.queries.push(sql);
  if(sql==='begin'||sql.startsWith('select set_config'))return {rows:[]};
  if(sql.startsWith('select tenant_id')){members++;return {rows:[{...member(),...(h.changed&&members>1?{role:'member'}:{})}]};}
  if(sql.startsWith('select state,revision')){assert.ok(sql.endsWith('for update'));const prior=tail;tail=new Promise(resolve=>unlock=resolve);await prior;local=structuredClone(data);return {rows:[{state:local.state,revision:local.revision}]};}
  if(sql.startsWith('select fingerprint,response'))return {rows:local.commands.filter(x=>x.actor===args[2]&&x.request===args[3]).map(x=>({fingerprint:x.fingerprint,response:x.response}))};
  if(sql.startsWith('select event_id,discovery_state'))return {rows:local.outbox.filter(x=>x.actor===args[2]&&x.request===args[3]).map(x=>({event_id:x.event,state:'acknowledged'}))};
  if(sql.startsWith('update vega_private.app_state')){local.state=JSON.parse(args[0]);local.revision++;return {rows:[]};}
  if(sql.startsWith('insert into vega_private.app_commands')){local.commands.push({actor:args[2],request:args[3],fingerprint:args[4],response:JSON.parse(args[5])});return {rows:[]};}
  if(sql.startsWith('insert into vega_private.recovery_outbox')){if(h.failOutbox)throw Error('outbox failure');local.outbox.push({event:args[0],actor:args[3],request:args[4],previous:args[5],revision:args[6]});return {rows:[]};}
  if(sql==='commit'){if(local)data=local;return {rows:[]};}
  if(sql==='rollback')return {rows:[]};
  assert.fail(sql);
 }};}};
 h.store=createApplicationStore(pool,{receiptPublicKey:publicKey,refundNow:()=>stamp,resolveIntegration:async(c,a,attempt)=>{if(h.integrationChanged)throw Error('Integration unavailable');return attempt.integrationRef;}});
 Object.defineProperty(h,'data',{get:()=>data});
 h.proof=()=>({tenantId:'vega-development',businessId:'vega-dance-lab',purchaseId:data.state.purchaseDrafts[0].id,paymentId:data.state.paymentAttempts[0].paymentId,amountMinor:6000,currency:'USD',providerClear:true,businessReadiness:boundedRefundReadiness({state:data.state,authority:{role:'staff',tenantId:'vega-development',businessId:'vega-dance-lab'},purchaseId:data.state.purchaseDrafts[0].id,at:stamp}),observedAt:stamp,paymentVersion:'v1',stateDigest:digest(data.state)});
 h.cmd=(action,request='intent',body={})=>({action,body:{requestId:request,purchaseId:data.state.purchaseDrafts[0].id,reason:'Customer request',...body}});
 return h;
}
test('store commits intent, hold, audit, command and outbox together',async()=>{const h=harness(),r=await h.store.refundCommand('staff',h.cmd('refund-intent'),h.proof());assert.equal(h.data.revision,128);assert.equal(h.data.commands.length,1);assert.equal(h.data.outbox.length,1);assert.equal(r.refund.intentReceiptId,h.data.outbox[0].event);assert.equal(h.data.state.creditUnits.filter(u=>u.status==='refund_held').length,3);});
test('actual store duplicate request replay does not advance revision',async()=>{const h=harness(),e=h.proof(),cmd=h.cmd('refund-intent');await h.store.refundCommand('staff',cmd,e);await h.store.refundCommand('staff',cmd,e);assert.equal(h.data.revision,128);assert.equal(h.data.commands.length,1);});
test('actual store serializes two dispatch claims; one is rejected',async()=>{const h=harness();const r=await h.store.refundCommand('staff',h.cmd('refund-intent'),h.proof()),e=h.proof();const calls=['a','b'].map(id=>h.store.refundCommand('staff',h.cmd('refund-dispatch',id,{operationId:r.refund.id}),e));const results=await Promise.allSettled(calls);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.data.revision,129);assert.equal(h.data.state.refundOperations[0].history.filter(e=>e.action==='refund-dispatch').length,1);});
test('recovery failure rolls back hold and all business writes',async()=>{const h=harness(),before=structuredClone(h.data);h.failOutbox=true;await assert.rejects(h.store.refundCommand('staff',h.cmd('refund-intent'),h.proof()),/outbox failure/);assert.deepEqual(h.data,before);assert.ok(h.queries.includes('rollback'));});
test('membership revoked while waiting for lock blocks intent',async()=>{const h=harness();h.changed=true;await assert.rejects(h.store.refundCommand('staff',h.cmd('refund-intent'),h.proof()),/Access changed/);assert.equal(h.data.revision,127);});
test('nonstaff denied before loading purchase state',async()=>{const h=harness();h.role='member';await assert.rejects(h.store.refundCommand('member',h.cmd('refund-intent'),h.proof()));assert.ok(!h.queries.some(q=>q.startsWith('select state')));});
test('ordinary caller cannot use refund command capability',async()=>{const h=harness();await assert.rejects(h.store.command('staff',h.cmd('refund-intent')));assert.equal(h.data.revision,127);});
test('revoked integration prevents committing refund intent',async()=>{const h=harness();h.integrationChanged=true;await assert.rejects(h.store.refundCommand('staff',h.cmd('refund-intent'),h.proof()),/Integration unavailable/);assert.equal(h.data.revision,127);});
