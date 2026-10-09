import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {financialIntent,validIntegration,sameIntegration,validCompletion,qualifiedTransaction} from './payment-contract.mjs';
import {fulfillPurchase} from './fulfillment.mjs';

export const HISTORICAL_DRAFTS=new Set(['87d6177e-2988-4aab-973a-5e424ee9c2db','1cdb80f7-f796-4eda-a98a-3d6419649277','b0f90447-56d3-4c3d-9225-d2d29110a69a','4f9c79e5-bbc3-4792-88ea-dbdfa0181e88','f21d3bdc-0612-447b-ab22-7bdbd61ee432']);
export function canonical(value){return JSON.stringify(sort(value));}
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function purchaseForPayment(state,a,purchaseId,fail,{staffRead=false}={}){
 const d=(state.purchaseDrafts||[]).find(d=>d.id===purchaseId&&d.tenantId===a.tenantId&&d.businessId===a.businessId);
 if(!d)fail('Purchase unavailable',404);
 if(d.saleChannel==='front_desk'){
  if(a.role!=='staff'||!d.createdByStaffId||state.participants.filter(p=>p.id===d.participantId).length!==1)fail('Front-desk staff access required',403);
  return d;
 }
 if(!(staffRead&&a.role==='staff')&&(a.role!=='member'||a.participantIds?.length!==1||d.buyerId!==a.userId||d.participantId!==a.participantIds[0]||!state.participants.some(p=>p.id===d.participantId)))fail('Self-purchase authority required',403);
 return d;
}
export function paymentTransition(state,command,a,{id,now,integrationRef,legacyIntegrationRefs},fail){
 const b=command.body,d=purchaseForPayment(state,a,b.purchaseId,fail);
 if(!validIntegration(integrationRef,a))fail('Payment integration scope mismatch',403);
 state.paymentAttempts||=[];
 const event=(action,attempt,extra={})=>state.activity.push({id:id(),action,actorId:a.userId,tenantId:a.tenantId,businessId:a.businessId,subjectId:d.id,attemptId:attempt.id,requestId:b.requestId,integrationRef:structuredClone(integrationRef),transactionRef:attempt.transactionRef??null,paymentId:attempt.paymentId??null,createdAt:now(),...extra});
 if(command.action==='payment-prepare'){
  if(HISTORICAL_DRAFTS.has(d.id))fail('Closed verification draft cannot be paid',409);
  if(!isDeepStrictEqual(d.terms,(state.commerceOffers||[]).find(o=>o.id===d.offerId&&o.version===d.offerVersion))||!Number.isSafeInteger(d.totalMinor)||d.totalMinor<=0||d.totalMinor!==d.subtotalMinor+d.taxMinor||d.subtotalMinor!==d.terms.priceMinor||d.taxMinor!==d.terms.tax.amountMinor||d.currency!==d.terms.currency)fail('Immutable purchase terms mismatch',409);
  if(d.paymentStatus==='succeeded'||d.fulfillmentStatus==='issued')fail('Purchase already paid',409);
  if(b.sourceDigest!==null&&!/^[a-f0-9]{64}$/.test(b.sourceDigest||''))fail('Invalid source fingerprint');
  const active=state.paymentAttempts.find(p=>p.purchaseId===d.id&&!['failed','cancelled'].includes(p.status));
  if(active){if(active.integrationRef&&!sameIntegration(active.integrationRef,integrationRef))fail('Active attempt integration conflict',409);if(active.sourceDigest!==b.sourceDigest)fail('Active payment source conflict',409);return {attemptId:active.id,purchaseId:d.id};}
  const attempt={id:id(),purchaseId:d.id,buyerId:d.buyerId,participantId:d.participantId,integrationRef:structuredClone(integrationRef),financialIntent:financialIntent(d),offerDigest:digest(d.terms),sourceDigest:b.sourceDigest,status:'pending',paymentId:null,createdAt:now(),paymentConfirmedAt:null};
  attempt.idempotencyKey=attempt.id;attempt.referenceId=attempt.id;attempt.prepareRequestId=b.requestId;
  if(b.sourceDigest===null){attempt.prepareSourceDigest=null;attempt.reason='prepared_execution_disabled';}
  attempt.requestDigest=digest({intent:attempt.financialIntent,integrationRef,sourceDigest:attempt.sourceDigest,referenceId:attempt.id});
  state.paymentAttempts.push(attempt);d.paymentStatus='pending';d.activeAttemptId=attempt.id;
  event('payment-intent',attempt,{idempotencyKey:attempt.idempotencyKey,requestDigest:attempt.requestDigest,offerDigest:attempt.offerDigest});
  return {attemptId:attempt.id,purchaseId:d.id};
 }
 const attempt=state.paymentAttempts.find(p=>p.id===b.attemptId&&p.purchaseId===d.id);
 if(!attempt)fail('Payment attempt unavailable',404);
 if(attempt.integrationRef&&!sameIntegration(attempt.integrationRef,integrationRef))fail('Attempt integration mismatch',409);
 if(attempt.financialIntent&&!isDeepStrictEqual(attempt.financialIntent,financialIntent(d)))fail('Immutable financial intent mismatch',409);
 if(command.action==='payment-bind-source'){
  if(!/^[a-f0-9]{64}$/.test(b.sourceDigest||'')||attempt.prepareSourceDigest!==null)fail('Invalid source binding',409);
  if(attempt.sourceDigest!==null){if(attempt.sourceDigest!==b.sourceDigest)fail('Active payment source conflict',409);return {attemptId:attempt.id,purchaseId:d.id};}
  if(attempt.status!=='pending'||attempt.paymentId||attempt.offerDigest!==digest(d.terms))fail('Attempt cannot bind payment source',409);
  attempt.sourceDigest=b.sourceDigest;attempt.executionStartedAt=now();attempt.reason='source_bound_awaiting_provider';
  attempt.executionRequestDigest=digest({intent:attempt.financialIntent||financialIntent(d),integrationRef,sourceDigest:attempt.sourceDigest,referenceId:attempt.id});
  event('payment-source-bound',attempt,{executionRequestDigest:attempt.executionRequestDigest});
  return {attemptId:attempt.id,purchaseId:d.id};
 }
 if(command.action==='payment-observe'){
  // Only the server adapter can construct these commands; HTTP routes never accept evidence.
  if(['succeeded','failed','cancelled'].includes(attempt.status))return {attemptId:attempt.id,purchaseId:d.id,status:attempt.status};
  const evidence=b.evidence;
  if(evidence?.integrationRef&&!sameIntegration(evidence.integrationRef,integrationRef))fail('Provider evidence integration mismatch',409);
  if(evidence?.paymentId&&!isDeepStrictEqual(evidence.transactionRef,qualifiedTransaction(integrationRef,evidence.paymentId)))fail('Provider transaction scope mismatch',409);
  if(!['pending','unresolved','succeeded','failed','cancelled'].includes(evidence?.status))fail('Invalid payment evidence');
  if(evidence.paymentId&&attempt.paymentId&&attempt.paymentId!==evidence.paymentId)fail('Payment identity conflict',409);
  if(evidence.paymentId&&state.paymentAttempts.some(p=>p.id!==attempt.id&&p.paymentId===evidence.paymentId&&sameIntegration(p.integrationRef??legacyIntegrationRefs?.[p.id],integrationRef)))fail('Payment already belongs to another attempt',409);
  if(evidence.status==='succeeded'&&(!validCompletion(evidence,attempt,integrationRef,attempt.financialIntent||financialIntent(d))||attempt.offerDigest!==digest(d.terms)))fail('Payment confirmation rejected',409);
  const from=attempt.status;attempt.status=evidence.status;attempt.reason=evidence.reason;attempt.evidence=structuredClone(evidence);
  if(evidence.paymentId){attempt.paymentId=evidence.paymentId;if(evidence.transactionRef)attempt.transactionRef=structuredClone(evidence.transactionRef);}
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
  if(d.fulfillmentStatus==='issued'&&!d.terms.fulfillmentPlan)return {purchaseId:d.id,issuanceId:d.issuanceId,status:'issued'};
  if(attempt.offerDigest!==digest(d.terms))fail('Immutable purchase terms mismatch',409);
  const previousStatus=d.fulfillmentStatus;
  const result=fulfillPurchase(state,d.id,a,{id,now,requestId:b.requestId});
  const fulfilled=state.purchaseDrafts.find(x=>x.id===d.id);
  if(result.status==='issued'&&previousStatus!=='issued')event('purchase-fulfilled',attempt,{issuanceId:fulfilled.issuanceId,passId:state.entitlementIssuances?.find(g=>g.id===fulfilled.issuanceId)?.passId,paymentConfirmedAt:fulfilled.paymentConfirmedAt});
  return d.terms.fulfillmentPlan?result:{purchaseId:d.id,issuanceId:fulfilled.issuanceId,status:result.status};
 }
 fail('Payment operation unavailable',404);
}
