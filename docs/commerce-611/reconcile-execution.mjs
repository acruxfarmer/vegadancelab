// Run in the existing hosted application directory. Read-only; never submits a payment.
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions} from '../../src/runtime/refund-application-database.mjs';
import {digest} from '../../src/payments.mjs';
import {visibleState} from '../../src/refund-application.mjs';
import {createSquareAdapter} from '../../src/runtime/providers/square.mjs';
const pid='547430a8-0d29-437a-920f-cd8c3e53d932',actor='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124';
const checkpoint='5cb653444cb21f92149ac609a4db7c912c9ba1328385d5ce5f0c1e4148f2837a';
const phase=process.argv[2]||'before';
assert.equal(process.env.RENDER_GIT_COMMIT,'792cf1f09998118c883b859a257210cb2264f4cc');
assert.equal(process.env.VEGA_ENV,'development');assert.equal(process.env.VEGA_EXTERNAL_EFFECTS,'disabled');
const db=new pg.Client(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
try{
 await db.connect();await db.query('begin isolation level repeatable read read only');
 await db.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[actor]);
 const role=(await db.query('select current_user as role')).rows[0].role;assert.equal(role,'vega_app_runtime');
 const assignments=(await db.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[actor])).rows;assert.equal(assignments.length,1);
 const m=assignments[0];assert.equal(m.role,'staff');assert.equal(m.tenant_id,'vega-development');assert.equal(m.business_id,'vega-dance-lab');
 const scope=[m.tenant_id,m.business_id];
 const row=(await db.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',scope)).rows[0],s=row.state;
 const p=s.purchaseDrafts.find(x=>x.id===pid);assert.ok(p);assert.equal(p.createdByStaffId,actor);assert.equal(p.buyerId,'e5946b40-9839-4a96-99d5-93262d9573f0');assert.equal(p.participantId,'vega-member-test-joe');assert.equal(p.totalMinor,6000);assert.equal(p.currency,'USD');assert.equal(p.terms.quantity,3);assert.equal(p.saleChannel,'front_desk');
 const attempt=s.paymentAttempts?.find(x=>x.purchaseId===pid),grant=s.entitlementIssuances?.find(x=>x.reference===`purchase:${pid}`);
 const units=(s.creditUnits||[]).filter(x=>grant&&x.entitlement?.issuanceId===grant.id),events=(s.creditEvents||[]).filter(x=>grant&&x.issuanceId===grant.id);
 const unrelated=structuredClone(s);
 unrelated.purchaseDrafts=unrelated.purchaseDrafts.filter(x=>x.id!==pid);
 unrelated.paymentAttempts=unrelated.paymentAttempts.filter(x=>x.purchaseId!==pid);
 unrelated.activity=unrelated.activity.filter(x=>x.subjectId!==pid);
 for(const key of ['entitlementIssuances','passes','creditUnits','creditEvents'])unrelated[key]=unrelated[key].filter(x=>!grant||(key==='entitlementIssuances'?x.id!==grant.id:key==='creditEvents'?x.issuanceId!==grant.id:x.entitlement?.issuanceId!==grant.id));
 assert.equal(digest(unrelated),checkpoint,'Unrelated business state changed from closed checkpoint');
 const receipts=(await db.query("select o.event_id,o.request_id,o.discovery_state,o.revision from vega_private.recovery_outbox o join vega_private.app_commands j using(tenant_id,business_id,actor_id,request_id) where o.tenant_id=$1 and o.business_id=$2 and o.actor_id=$3 and (j.response->>'id'=$4 or j.response->>'purchaseId'=$4) order by o.revision",[...scope,actor,pid])).rows;
 assert.ok(receipts.length);assert.ok(receipts.every(x=>x.discovery_state==='acknowledged'));
 const staffAuthority={userId:actor,tenantId:m.tenant_id,businessId:m.business_id,role:m.role,participantIds:m.participant_ids};
 const staffProjection=visibleState(s,staffAuthority).purchaseDrafts.find(x=>x.id===pid);
 // Read the customer's own existing application assignment; this is projection
 // verification, not a member login, command, or staff impersonation.
 await db.query("select set_config('vega.actor_id',$1,true)",[p.buyerId]);
 const buyerRows=(await db.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[p.buyerId])).rows;assert.equal(buyerRows.length,1);
 const b=buyerRows[0];assert.equal(b.tenant_id,m.tenant_id);assert.equal(b.business_id,m.business_id);assert.equal(b.role,'member');assert.ok(b.participant_ids.includes(p.participantId));
 const memberState=visibleState(s,{userId:p.buyerId,tenantId:b.tenant_id,businessId:b.business_id,role:b.role,participantIds:b.participant_ids});
 const memberProjection=memberState.purchaseDrafts.find(x=>x.id===pid);
 assert.deepEqual(memberProjection,staffProjection);
 assert.deepEqual(memberState.creditUnits.filter(x=>grant&&x.entitlement?.issuanceId===grant.id),units);
 let provider=null;
 if(phase==='after'){
  assert.equal(p.paymentStatus,'succeeded');assert.equal(p.fulfillmentStatus,'issued');assert.equal(s.paymentAttempts.filter(x=>x.purchaseId===pid).length,1);
  assert.equal(s.entitlementIssuances.filter(x=>x.reference===`purchase:${pid}`).length,1);assert.equal(units.length,3);assert.equal(events.length,3);assert.ok(units.every(x=>x.status==='available'));assert.ok(events.every(x=>x.type==='issue'&&x.actorId===actor));
  provider=await createSquareAdapter(process.env).inspect(attempt);assert.equal(provider.status,'succeeded');assert.equal(provider.verified,true);assert.equal(provider.paymentId,attempt.paymentId);assert.equal(provider.amount,6000);assert.equal(provider.currency,'USD');
 }else if(phase==='before'){assert.equal(p.paymentStatus,'not_started');assert.equal(p.fulfillmentStatus,'not_issued');assert.equal(attempt,undefined);assert.equal(units.length,0);}
 else if(phase==='disabled'){assert.equal(process.env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');assert.equal(p.paymentStatus,'succeeded');assert.equal(p.fulfillmentStatus,'issued');assert.equal(units.length,3);}
 const report={phase,build:process.env.RENDER_GIT_COMMIT,revision:row.revision,stateDigest:digest(s),purchase:p,attempt:attempt?{id:attempt.id,status:attempt.status,paymentId:attempt.paymentId,paymentConfirmedAt:attempt.paymentConfirmedAt}:null,grant:grant??null,units:units.map(x=>({id:x.id,status:x.status,passId:x.passId})),issuanceEventCount:events.length,audit:s.activity.filter(x=>x.subjectId===pid),receipts,staffCustomerProjectionEqual:true,customerCreditProjectionEqual:true,customerAssignmentVerified:true,memberBrowserLogin:false,unrelatedStateDigest:digest(unrelated),unrelatedMatchesRevision144:true,provider,paymentExecution:process.env.VEGA_SANDBOX_PAYMENT_EXECUTION};
 await db.query('commit');console.log(JSON.stringify(report));
}finally{await db.end();}
