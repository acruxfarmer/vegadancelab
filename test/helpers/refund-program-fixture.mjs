import {readFileSync} from 'node:fs';
import {digest} from '../../src/payments.mjs';
import {transition} from '../../src/refund-application.mjs';
export const stamp='2026-10-06T03:00:00Z';
const original=JSON.parse(readFileSync(new URL('../fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export function programFixture(){
 let state={classes:[],participants:[],activity:[],...structuredClone(original)},n=0;
 const a={role:'staff',userId:'staff',tenantId:'vega-development',businessId:'vega-dance-lab',participantIds:[]};
 const h={a,at:stamp,extra:[],get state(){return state;},set state(s){state=s;},get p(){return state.purchaseDrafts[0];}};
 h.purchase=()=>({tenantId:a.tenantId,businessId:a.businessId,purchaseId:h.p.id,paymentId:state.paymentAttempts[0].paymentId,amountMinor:h.p.totalMinor,currency:h.p.currency,integrationRef:state.paymentAttempts[0].integrationRef});
 h.inventory=()=>{const p=h.purchase(),refunds=[...(state.refundOperations??[]).filter(o=>o.providerRefundId).map(o=>({id:o.providerRefundId,paymentId:p.paymentId,amountMinor:o.amountMinor,currency:p.currency,status:o.failureStatus??o.providerStatus??o.status,reason:`Refund ${o.id}: ${o.reason}`})),...h.extra];return {contract:'refund-provider-inventory/1',...p,integrationDigest:digest(p.integrationRef),observedAt:h.at,cutoff:h.at,payment:{id:p.paymentId,status:'COMPLETED',amountMinor:p.amountMinor,currency:p.currency,version:'v1',refundedMinor:refunds.filter(r=>r.status==='completed').reduce((n,r)=>n+r.amountMinor,0),refundIds:refunds.map(r=>r.id)},refunds,disputes:[],coverage:{paginationExhausted:true,paymentStable:true,allRefundStatuses:true}};};
 h.evidence=()=>({stateDigest:digest(state),inventory:h.inventory()});
 h.run=(action,body={},evidence=h.evidence(),authority=a)=>{const r=transition(state,{action:`refund-program-${action}`,body:{purchaseId:h.p.id,requestId:`r${++n}`,reason:'Customer request',...body}},authority,{trustedRefund:true,now:()=>h.at,id:()=>`event${++n}`,refundEvidence:evidence});state=r.state;return r.result.refund??r.result;};
 h.intent=(count=1)=>h.run('intent',{unitIds:state.creditUnits.filter(u=>u.status==='available').slice(0,count).map(u=>u.id)});
 h.dispatch=op=>h.run('dispatch',{operationId:op.id});
 h.outcome=(op,status)=>({...h.purchase(),amountMinor:op.amountMinor,operationId:op.id,status,refundId:`provider-${op.id}`,verified:true,observedAt:h.at});
 h.observe=(op,status)=>h.run('observe',{operationId:op.id},h.outcome(op,status));
 h.consume=(restore=false)=>{
  const u=state.creditUnits[0],bookingId='booking',e={id:'consume-event',type:'consume',unitId:u.id,passId:u.passId,participantId:u.participantId,bookingId,createdAt:'2026-10-03T00:00:00Z'};
  u.status='spent';u.spentByBookingId=bookingId;state.creditEvents.push(e);
  const r={id:bookingId,participantId:u.participantId,status:'cancelled',attendanceStatus:'not_recorded',creditConsumption:{unitId:u.id,passId:u.passId,eventId:e.id}};state.reservations.push(r);
  if(restore){const restored={...structuredClone(u),id:'restored',status:'available',sourceUnitId:u.id,originBookingId:bookingId};delete restored.spentByBookingId;state.creditUnits.push(restored);r.restoredCreditUnitId=restored.id;r.cancellation={classification:'early'};r.cancellationHistory=[{action:'cancel',outcome:'applied',to:'early',creditOutcome:'restored'}];state.creditEvents.push({id:'restore-event',type:'restore',unitId:restored.id,passId:u.passId,participantId:u.participantId,bookingId,createdAt:'2026-10-03T01:00:00Z'});}
 };
 return h;
}
