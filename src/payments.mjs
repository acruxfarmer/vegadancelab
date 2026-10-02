import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {developmentOffer,selfParticipant} from './commerce.mjs';
import {bookingAccounting} from './cancellation.mjs';
import {entitlementOperations} from './entitlements.mjs';

export const PAYMENT_BINDING=Object.freeze({environment:'sandbox',tenantId:'vega-development',businessId:'vega-dance-lab',applicationId:'sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw',merchantId:'MLJGVWY9QZ66R',locationId:'L7EMFD4DPV27P',host:'connect.squareupsandbox.com',currency:'USD'});
export const HISTORICAL_DRAFTS=new Set(['87d6177e-2988-4aab-973a-5e424ee9c2db','1cdb80f7-f796-4eda-a98a-3d6419649277','b0f90447-56d3-4c3d-9225-d2d29110a69a','4f9c79e5-bbc3-4792-88ea-dbdfa0181e88','f21d3bdc-0612-447b-ab22-7bdbd61ee432']);
export function canonical(value){return JSON.stringify(sort(value));}
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function purchaseForPayment(state,a,purchaseId,fail,{staffRead=false}={}){
 const d=(state.purchaseDrafts||[]).find(d=>d.id===purchaseId&&d.tenantId===a.tenantId&&d.businessId===a.businessId);
 if(a.tenantId!==PAYMENT_BINDING.tenantId||a.businessId!==PAYMENT_BINDING.businessId||!d)fail('Purchase unavailable',404);
 if(!(staffRead&&a.role==='staff')&&(!selfParticipant(state,a)||d.buyerId!==a.userId||d.participantId!==selfParticipant(state,a)))fail('Self-purchase authority required',403);
 return d;
}
export function paymentTransition(state,command,a,{id,now},fail){
 const b=command.body,d=purchaseForPayment(state,a,b.purchaseId,fail);
 state.paymentAttempts||=[];
 const event=(action,attempt,extra={})=>state.activity.push({id:id(),action,actorId:a.userId,tenantId:a.tenantId,businessId:a.businessId,subjectId:d.id,attemptId:attempt.id,requestId:b.requestId,paymentId:attempt.paymentId??null,createdAt:now(),...extra});
 if(command.action==='payment-prepare'){
  if(HISTORICAL_DRAFTS.has(d.id))fail('Closed verification draft cannot be paid',409);
  if(!isDeepStrictEqual(d.terms,developmentOffer())||d.totalMinor!==6000||d.subtotalMinor!==6000||d.taxMinor!==0||d.currency!=='USD')fail('Immutable purchase terms mismatch',409);
  if(d.paymentStatus==='succeeded'||d.fulfillmentStatus==='issued')fail('Purchase already paid',409);
  if(!/^[a-f0-9]{64}$/.test(b.sourceDigest||''))fail('Invalid source fingerprint');
  const active=state.paymentAttempts.find(p=>p.purchaseId===d.id&&!['failed','cancelled'].includes(p.status));
  if(active){if(active.sourceDigest!==b.sourceDigest)fail('Active payment source conflict',409);return {attemptId:active.id,purchaseId:d.id};}
  const attempt={id:id(),purchaseId:d.id,buyerId:d.buyerId,participantId:d.participantId,binding:{...PAYMENT_BINDING},offerDigest:digest(d.terms),sourceDigest:b.sourceDigest,status:'pending',paymentId:null,createdAt:now(),paymentConfirmedAt:null};
  attempt.idempotencyKey=attempt.id;attempt.referenceId=attempt.id;attempt.prepareRequestId=b.requestId;
  attempt.requestDigest=digest({amount:6000,currency:'USD',binding:attempt.binding,sourceDigest:attempt.sourceDigest,referenceId:attempt.id,autocomplete:true});
  state.paymentAttempts.push(attempt);d.paymentStatus='pending';d.activeAttemptId=attempt.id;
  event('payment-intent',attempt,{idempotencyKey:attempt.idempotencyKey,requestDigest:attempt.requestDigest,offerDigest:attempt.offerDigest});
  return {attemptId:attempt.id,purchaseId:d.id};
 }
 const attempt=state.paymentAttempts.find(p=>p.id===b.attemptId&&p.purchaseId===d.id);
 if(!attempt)fail('Payment attempt unavailable',404);
 if(command.action==='payment-observe'){
  // Only the server adapter can construct these commands; HTTP routes never accept evidence.
  if(['succeeded','failed','cancelled'].includes(attempt.status))return {attemptId:attempt.id,purchaseId:d.id,status:attempt.status};
  const evidence=b.evidence;
  if(!['pending','unresolved','succeeded','failed','cancelled'].includes(evidence?.status))fail('Invalid payment evidence');
  if(evidence.paymentId&&attempt.paymentId&&attempt.paymentId!==evidence.paymentId)fail('Payment identity conflict',409);
  if(evidence.paymentId&&state.paymentAttempts.some(p=>p.id!==attempt.id&&p.paymentId===evidence.paymentId))fail('Payment already belongs to another attempt',409);
  if(evidence.status==='succeeded'&&(!evidence.paymentId||evidence.verified!==true||evidence.bindingDigest!==digest(PAYMENT_BINDING)||evidence.referenceId!==attempt.id||evidence.amount!==6000||evidence.currency!=='USD'||attempt.offerDigest!==digest(d.terms)))fail('Payment confirmation rejected',409);
  const from=attempt.status;attempt.status=evidence.status;attempt.reason=evidence.reason;attempt.evidence=structuredClone(evidence);
  if(evidence.paymentId)attempt.paymentId=evidence.paymentId;
  d.paymentStatus=attempt.status;
  if(evidence.status==='succeeded'){
   attempt.paymentConfirmedAt=now();d.paymentConfirmedAt=attempt.paymentConfirmedAt;
   d.refundWindowStartsAt=d.paymentConfirmedAt;d.fulfillmentStatus='pending';d.status='paid';
  }
  event('payment-observation',attempt,{from,to:attempt.status,evidenceDigest:digest(evidence),reason:evidence.reason});
  return {attemptId:attempt.id,purchaseId:d.id,status:attempt.status};
 }
 if(command.action==='payment-fulfill'){
  if(attempt.status!=='succeeded'||!d.paymentConfirmedAt||attempt.paymentConfirmedAt!==d.paymentConfirmedAt)fail('Verified payment required',409);
  if(d.fulfillmentStatus==='issued')return {purchaseId:d.id,issuanceId:d.issuanceId,status:'issued'};
  if(attempt.offerDigest!==digest(d.terms))fail('Immutable purchase terms mismatch',409);
  const clock={id,now:()=>d.paymentConfirmedAt},o=d.terms;
  const snapshot={id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds};
  const issuer=entitlementOperations(state,a,clock,fail,bookingAccounting(state,a,clock,fail),{paidProduct:snapshot});
  const grant=issuer.issue({productId:o.productId,participantId:d.participantId,issuanceRef:`purchase:${d.id}`,reason:'Verified Square Sandbox purchase',requestId:b.requestId});
  d.issuanceId=grant.id;d.validFrom=grant.validFrom;d.expiresAt=grant.expiresAt;d.fulfillmentStatus='issued';
  event('purchase-fulfilled',attempt,{issuanceId:grant.id,passId:grant.passId,paymentConfirmedAt:d.paymentConfirmedAt});
  return {purchaseId:d.id,issuanceId:grant.id,status:'issued'};
 }
 fail('Payment operation unavailable',404);
}
