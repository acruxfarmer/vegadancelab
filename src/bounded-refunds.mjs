import {reversePurchaseFulfillment} from './fulfillment.mjs';
import {digest} from './payments.mjs';
import {boundedRefundReadiness} from './bounded-refund-readiness.mjs';

const held = new Set(['intent','dispatching','pending','unknown','failed','rejected']);
export const refundHolding = op => held.has(op.status);
export const refundId = (a,p) => digest(['full-refund/1',a.tenantId,a.businessId,p]).slice(0,40);
const sameScope=(x,a)=>x?.tenantId===a.tenantId&&x?.businessId===a.businessId;
const fresh=(e,at)=>Number.isFinite(Date.parse(e?.observedAt))&&Date.parse(at)>=Date.parse(e.observedAt)&&Date.parse(at)-Date.parse(e.observedAt)<=30000;

// Only the server coordinator may supply evidence. HTTP input is never evidence.
export function refundTransition(state,command,a,{now,id,evidence},fail){
 if(a.role!=='staff')fail('Staff access required',403);
 const b=command.body,p=state.purchaseDrafts?.find(p=>p.id===b.purchaseId&&sameScope(p,a));
 if(!p)fail('Purchase unavailable',404);
 const at=now(),operations=state.refundOperations??[], existing=operations.find(o=>o.purchaseId===p.id&&sameScope(o,a));
 const audit=(op,kind,extra={})=>{
  const event={id:id(),action:kind,subjectId:p.id,operationId:op.id,tenantId:a.tenantId,businessId:a.businessId,actorId:a.userId,requestId:b.requestId,createdAt:at,...extra};
  (op.history??=[]).push(event);(state.activity??=[]).push(structuredClone(event));
 };
 const output=op=>({refund:structuredClone(op),executionAuthorized:false});
 if(command.action==='refund-intent'){
  if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>120)fail('Refund reason required');
  if(existing){if(existing.reason!==b.reason.trim())fail('Refund already exists with different intent',409);return output(existing);}
  if(!evidence||evidence.stateDigest!==digest(state)||!fresh(evidence,at)||evidence.businessReadiness?.contract!=='bounded-full-refund-readiness/1'||evidence.businessReadiness?.stateDigest!==digest(state)||evidence.businessReadiness?.purchaseId!==p.id||!sameScope(evidence.businessReadiness,a)||evidence.providerClear!==true||evidence.purchaseId!==p.id||!sameScope(evidence,a))fail('Fresh refund evidence unavailable',409);
  const checked=boundedRefundReadiness({state,authority:a,purchaseId:p.id,at});
  if(checked.status!=='ready')fail(checked.reasonCodes.join(', '),409);
  if(evidence.businessReadiness.status!=='ready')fail('Fresh refund evidence unavailable',409);
  const assessment=checked.assessment;
  if(assessment.status!=='eligible')fail(assessment.reasonCodes.join(', '),409);
  const attempt=state.paymentAttempts.find(x=>x.id===p.activeAttemptId);
  if(evidence.paymentId!==attempt.paymentId||evidence.amountMinor!==p.totalMinor||evidence.currency!==p.currency||!evidence.paymentVersion)fail('Provider evidence mismatch',409);
  const units=state.creditUnits.filter(u=>p.issuanceId&&u.entitlement?.issuanceId===p.issuanceId);
  const op={id:refundId(a,p.id),contract:'bounded-full-refund/1',tenantId:a.tenantId,businessId:a.businessId,purchaseId:p.id,paymentId:attempt.paymentId,attemptId:attempt.id,integrationRef:structuredClone(attempt.integrationRef),actorId:a.userId,reason:b.reason.trim(),amountMinor:p.totalMinor,currency:p.currency,participantId:p.participantId,issuanceId:p.issuanceId,unitIds:units.map(u=>u.id).sort(),status:'intent',createdAt:at,intentRequestId:b.requestId,providerKey:refundId(a,p.id),readiness:structuredClone(evidence),assessment,history:[]};
  op.purchaseDigest=digest(p);op.attemptDigest=digest(attempt);op.quantity=units.length;
  state.refundOperations=[...operations,op];
  for(const u of units){u.status='refund_held';u.refundOperationId=op.id;}
  audit(op,'refund-intent',{reason:op.reason,evidenceDigest:digest(evidence)});
  return output(op);
 }
 if(!existing||existing.id!==b.operationId)fail('Refund unavailable',404);
 const op=existing;
 const units=state.creditUnits.filter(u=>op.unitIds.includes(u.id));
 const checkHold=()=>{if(units.length!==op.unitIds.length||units.some(u=>u.status!=='refund_held'||u.refundOperationId!==op.id||u.entitlement?.issuanceId!==op.issuanceId))fail('Refund hold inconsistent',409);};
 if(command.action==='refund-dispatch'){
  if(op.status!=='intent')fail('Submission already claimed; reconcile only',409);
  checkHold();
  if(digest(p)!==op.purchaseDigest||digest(state.paymentAttempts.find(x=>x.id===op.attemptId)??null)!==op.attemptDigest)fail('Purchase changed after refund intent',409);
  const deadline=Date.parse(p.refundWindowStartsAt)+p.terms.refundPolicy.requestWithinDays*86400000;
  if(Date.parse(at)===deadline)fail('REFUND_CUTOFF_POLICY_UNRESOLVED',409);
  if(!Number.isFinite(deadline)||Date.parse(at)>deadline)fail('REFUND_WINDOW_EXPIRED',409);
  if(!fresh(evidence,at)||evidence?.providerClear!==true||evidence.paymentId!==op.paymentId||evidence.amountMinor!==op.amountMinor||evidence.currency!==op.currency||!sameScope(evidence,a)||!evidence.paymentVersion)fail('Fresh provider readiness unavailable',409);
  if(state.reservations.some(r=>r.participantId===op.participantId&&r.status!=='cancelled'))fail('Reservation conflicts with refund',409);
  op.paymentVersion=evidence.paymentVersion;op.status='dispatching';op.dispatchedAt=at;
  audit(op,'refund-dispatch',{evidenceDigest:digest(evidence)});return output(op);
 }
 if(command.action==='refund-observe'){
  if(!['dispatching','unknown','pending','completed','failed','rejected'].includes(op.status))fail('Refund has not been dispatched',409);
  if(!evidence||!sameScope(evidence,a)||evidence.operationId!==op.id||evidence.paymentId!==op.paymentId||!fresh(evidence,at))fail('Refund observation binding invalid',409);
  const status=evidence.status;
  if(!['unknown','pending','completed','failed','rejected'].includes(status))fail('Unsupported outcome',409);
  if(['completed','failed','rejected'].includes(op.status)){
   if(status!==op.status||evidence.refundId!==op.providerRefundId)fail('Conflicting terminal refund evidence',409);
   return output(op);
  }
  if(status!=='unknown'&&(!evidence.refundId||evidence.amountMinor!==op.amountMinor||evidence.currency!==op.currency||evidence.verified!==true))fail('Unproven provider outcome',409);
  if(op.providerRefundId&&evidence.refundId&&op.providerRefundId!==evidence.refundId)fail('Conflicting provider refund',409);
  checkHold();op.status=status;if(evidence.refundId)op.providerRefundId=evidence.refundId;
  if(status==='completed'){
   for(const u of units){u.status='refunded';(state.creditEvents??=[]).push({id:id(),type:'refund_retire',unitId:u.id,passId:u.passId,issuanceId:op.issuanceId,participantId:u.participantId,operationId:op.id,actorId:a.userId,createdAt:at,requestId:b.requestId});}
  }
  audit(op,'refund-observation',{status,providerRefundId:op.providerRefundId??null,evidence:structuredClone(evidence)});
  if(status==='completed')reversePurchaseFulfillment(state,p.id,op.id,at);
  return output(op);
 }
 if(command.action==='refund-release'){
  if(op.status==='released')return output(op);
  if(!['failed','rejected'].includes(op.status))fail('Only a conclusive failed refund permits release',409);
  checkHold();
  if(!fresh(evidence,at)||evidence?.verified!==true||evidence.status!==op.status||evidence.refundId!==op.providerRefundId||evidence.operationId!==op.id||evidence.paymentId!==op.paymentId||evidence.amountMinor!==op.amountMinor||evidence.currency!==op.currency||!sameScope(evidence,a))fail('Fresh failure confirmation required',409);
  for(const u of units){u.status='available';delete u.refundOperationId;}
  op.failureStatus=op.status;op.status='released';audit(op,'refund-hold-released',{evidenceDigest:digest(evidence)});return output(op);
 }
 fail('Unsupported refund command',400);
}

// Called before ordinary business transitions. Prevent even no-credit bookings
// from committing a new reservation while this participant's refund is held.
export function guardRefundBooking(state,command,fail){
 const participant=command.body?.participantId??state.reservations?.find(r=>r.id===command.id)?.participantId;
 if(['reserve','promote'].includes(command.action)&&state.refundOperations?.some(o=>refundHolding(o)&&o.participantId===participant))fail('Refund pending: booking is held',409);
}
