// Read-only database snapshot; replay application reducers in memory only.
// No provider adapters, HTTP clients, or database mutation calls.
import fs from 'node:fs/promises';
import pg from 'pg';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {fulfillPurchase,reversePurchaseFulfillment} from '../src/fulfillment.mjs';
import {refundTransition} from '../src/bounded-refunds.mjs';
import {canonical,digest} from '../src/payments.mjs';
const purchaseId='6f6e63d4-2a76-4f13-9f54-1a967a6ccb24';
const report={status:'preflight',providerRequests:0,databaseMutations:0,replayMode:'actual preserved state, application reducers in memory',productionUntouched:true};
let pool,c;
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));c=await pool.connect();await c.query('begin read only');await c.query("select set_config('vega.actor_id',$1,true)",['4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124']);
 const row=(await c.query("select state,revision from vega_private.app_state where tenant_id='vega-development' and business_id='vega-dance-lab'")).rows[0];
 const state=row.state,p=state.purchaseDrafts.find(p=>p.id===purchaseId),refund=state.refundOperations.find(r=>r.purchaseId===purchaseId);
 assert.equal(refund.status,'completed');assert.equal(p.fulfillmentStatus,'revoked');
 const before=canonical(state),now=()=>new Date().toISOString(),id=()=>{throw Error('Unexpected new history identity');},fail=m=>{throw Error(m);};
 const authority={userId:p.buyerId,role:'member',participantIds:[p.participantId],tenantId:p.tenantId,businessId:p.businessId};
 for(let i=0;i<3;i++){
  assert.throws(()=>fulfillPurchase(state,p.id,authority,{id,now,requestId:'closure-read-only-replay'}),/refund prevents fulfillment/);
  reversePurchaseFulfillment(state,p.id,refund.id,now());
  const evidence={...refund.history.findLast(h=>h.evidence?.status==='completed').evidence,observedAt:now()};
  const result=refundTransition(state,{action:'refund-observe',body:{purchaseId:p.id,operationId:refund.id,requestId:'closure-read-only-replay'}},{...authority,userId:refund.actorId,role:'staff'},{id,now,evidence},fail);
  assert.equal(result.executionAuthorized,false);assert.equal(canonical(state),before);
 }
 report.status='preserved-state-replay-stable';report.repetitions=3;report.revision=row.revision;report.beforeDigest=digest(JSON.parse(before));report.afterDigest=digest(state);
 report.fulfillmentReplay='rejected after completed refund without mutation';report.reversalReplay='no-op';report.terminalRefundObservation='no-op';
 report.counts={paymentAttempts:state.paymentAttempts.filter(x=>x.purchaseId===p.id).length,entitlements:state.accessEntitlements.filter(x=>x.purchaseId===p.id).length,fulfillmentActions:state.fulfillmentActions.filter(x=>x.purchaseId===p.id).length,refunds:state.refundOperations.filter(x=>x.purchaseId===p.id).length};
 const members=(await c.query("select md5(coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'role',role,'participant_ids',participant_ids) order by user_id)::text,'[]')) as digest from vega_private.app_members where tenant_id='vega-development' and business_id='vega-dance-lab'")).rows[0].digest;
 report.membersBaselineMatches=members==='18ac701b1fe9e8ca843b5c31190a2486';assert.equal(report.membersBaselineMatches,true);
 await c.query("select set_config('vega.actor_id',$1,true)",['01d4a4c0-9758-4bf4-8561-56232b9c9e4a']);
 const prior=JSON.parse(await fs.readFile(new URL('../docs/layer-6/l6-s8b-ordinary-delivery-verified.json',import.meta.url),'utf8'));
 const resource=(await c.query('select document from media_private.resources where id=$1',[prior.resourceId])).rows[0].document;
 const binding=(await c.query('select document from media_private.provider_bindings where id=$1',[prior.bindingId])).rows[0].document;
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 report.originalPersonalResourceMatches=hash(resource)===prior.original.resource;report.originalPersonalBindingMatches=hash(binding)===prior.original.binding;
 assert.equal(report.originalPersonalResourceMatches,true);assert.equal(report.originalPersonalBindingMatches,true);
 await c.query('rollback');
}catch{report.status='verification-stopped';await c?.query('rollback').catch(()=>{});}
finally{c?.release();await pool?.end().catch(()=>{});await fs.writeFile(new URL('../docs/layer-6/l6-s8b-closure-replay.local.json',import.meta.url),JSON.stringify(report,null,2));console.log('Read-only closure replay evidence saved. Tell Astra done.');}

