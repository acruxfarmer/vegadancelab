// Read-only reconciliation through the existing application role. No commands or provider calls.
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions} from '../../src/runtime/refund-application-database.mjs';
import {visibleState,transition} from '../../src/refund-application.mjs';
import {digest} from '../../src/payments.mjs';
const staffId='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',memberId='e5946b40-9839-4a96-99d5-93262d9573f0';
const baseline='7325506535514b911ff8f775e8faa877cfb416d0d233db33c6da0d8d7af8baa5';
const phase=process.argv[2]||'before',actions=['profile-update','waiver-publish','waiver-accept'];
assert.equal(process.env.VEGA_ENV,'development');assert.equal(process.env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');assert.equal(process.env.VEGA_EXTERNAL_EFFECTS,'disabled');
const db=new pg.Client(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
try{
 await db.connect();await db.query('begin isolation level repeatable read read only');
 async function authority(userId){await db.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[userId]);const rows=(await db.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[userId])).rows;assert.equal(rows.length,1);const m=rows[0];return {userId,tenantId:m.tenant_id,businessId:m.business_id,role:m.role,participantIds:m.participant_ids};}
 const staff=await authority(staffId);assert.equal(staff.role,'staff');assert.equal(staff.tenantId,'vega-development');assert.equal(staff.businessId,'vega-dance-lab');
 const row=(await db.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',[staff.tenantId,staff.businessId])).rows[0],s=row.state;
 const unrelated=structuredClone(s);for(const k of ['customerProfiles','waiverVersions','waiverAcceptances'])delete unrelated[k];unrelated.activity=unrelated.activity.filter(x=>!actions.includes(x.action));assert.equal(digest(unrelated),baseline,'Unrelated business records changed');
 const member=await authority(memberId);assert.equal(member.role,'member');assert.deepEqual(member.participantIds,['vega-member-test-joe']);assert.equal(member.businessId,staff.businessId);assert.equal(member.tenantId,staff.tenantId);
 const m=visibleState(s,member),st=visibleState(s,staff),p=m.customerProfile;assert.equal(p.status,'ready');
 for(const key of ['purchaseDrafts','passes','creditUnits','reservations'])for(const owned of m[key]||[])assert.ok(st[key].some(x=>x.id===owned.id),key+' record missing from staff view');
 assert.deepEqual(m.purchaseDrafts,st.purchaseDrafts.filter(x=>x.buyerId===memberId&&x.participantId===p.participantId));
 assert.deepEqual(m.creditUnits,st.creditUnits.filter(x=>x.participantId===p.participantId));
 assert.deepEqual(m.passes,st.passes.filter(x=>x.participantId===p.participantId));
 assert.equal(st.profileAdministration.participants.find(x=>x.participantId===p.participantId).waiverStatus,p.waiverStatus);
 const foreign={...member,businessId:'foreign-business'};assert.equal(visibleState(s,foreign).customerProfile.currentWaiver,null);assert.equal(visibleState(s,foreign).customerProfile.acceptances.length,0);
 const blocked=(body,a=member)=>assert.throws(()=>transition(s,{action:'profile-update',body:{requestId:'verification-only',participantId:p.participantId,expectedRevision:p.revision,displayName:'test',contactEmail:'',phone:'',...body}},a));
 blocked({businessId:'foreign-business'});blocked({credits:999});blocked({participantId:'foreign-participant'});
 if(p.currentWaiver)assert.throws(()=>transition(s,{action:'waiver-accept',body:{requestId:'verification-only',participantId:p.participantId,waiverId:p.currentWaiver.id,contentDigest:p.currentWaiver.contentDigest,accepted:true}},foreign));
 const receipts=[];for(const actor of [staff,member]){await authority(actor.userId);receipts.push(...(await db.query("select o.event_id,o.actor_id,o.request_id,o.discovery_state,o.revision from vega_private.recovery_outbox o join vega_private.app_commands j using(tenant_id,business_id,actor_id,request_id) where o.tenant_id=$1 and o.business_id=$2 and o.actor_id=$3 and o.revision>149 order by o.revision",[actor.tenantId,actor.businessId,actor.userId])).rows);}
 assert.ok(receipts.every(r=>r.discovery_state==='acknowledged'));
 if(phase==='final'){assert.equal(p.revision,1);assert.equal(p.waiverStatus,'Accepted');assert.equal(p.acceptances.length,2);assert.equal(p.currentWaiver.version,2);assert.equal(p.fields.displayName,'Joe — Profile Test');assert.equal(s.waiverVersions.length,2);assert.equal(receipts.length,5);}
 if(phase==='reacceptance'){assert.equal(p.waiverStatus,'Acceptance required');assert.equal(p.acceptances.length,1);assert.equal(p.currentWaiver.version,2);}
 await db.query('commit');console.log(JSON.stringify({phase,build:process.env.RENDER_GIT_COMMIT,revision:row.revision,stateDigest:digest(s),profile:p,staffProfile:st.profileAdministration.participants.find(x=>x.participantId===p.participantId),recordCounts:{passes:m.passes.length,credits:m.creditUnits.length,bookings:m.reservations.length,purchases:m.purchaseDrafts.length,refunds:m.refundHistory.length},staffMemberBusinessFactsAgree:true,foreignScopeDeniedByHostedTransition:true,protectedFieldsRejectedByHostedTransition:true,unrelatedStateMatchesRevision149:true,unrelatedStateDigest:digest(unrelated),receipts,audit:s.activity.filter(x=>actions.includes(x.action)),paymentExecution:process.env.VEGA_SANDBOX_PAYMENT_EXECUTION}));
}finally{await db.end();}
