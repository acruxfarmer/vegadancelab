import {isDeepStrictEqual as equal} from 'node:util';
import {digest} from './payments.mjs';
import {financialIntent,validCompletion,validIntegration} from './payment-contract.mjs';
import {reconcileRefundInventory} from './refund-reconciliation.mjs';
import {fulfillmentPlan,reversePurchaseFulfillment} from './fulfillment.mjs';

export const REFUND_POLICY=Object.freeze({id:'whole-unused-credit-refund',version:1,allocation:'equal-whole-units-zero-tax',used:'nonrefundable',restored:'proven-single-restoration',cutoff:'exclusive',reservations:'resolve-before-refund',external:'hold-and-review'});
const scope=(x,a)=>x?.tenantId===a.tenantId&&x?.businessId===a.businessId;
const pos=n=>Number.isSafeInteger(n)&&n>0;
const time=x=>Date.parse(x);
const active=o=>!['completed','released'].includes(o.status);
function reconcileFulfillment(state,p,op,at){
 const units=state.creditUnits.filter(u=>p.issuanceId&&u.entitlement?.issuanceId===p.issuanceId);
 if(units.length&&units.every(u=>u.status==='refunded'))reversePurchaseFulfillment(state,p.id,op.id,at);
}
export const programHolding=o=>o.contract==='refund-program/1'&&active(o);

export function refundProgramFacts(state,a,purchaseId,at,{holdingOperationId,dispositionOnly=false}={}){
 const base={contract:'refund-program-readiness/1',policy:REFUND_POLICY,purchaseId,stateDigest:digest(state),executionAuthorized:false,historicalCompleteness:'unknown'};
 const blocked=code=>({...base,status:'blocked',reasonCodes:[code],units:[]});
 if(a?.role!=='staff')return blocked('STAFF_REQUIRED');
 if(!['purchaseDrafts','paymentAttempts','entitlementIssuances','passes','creditUnits','creditEvents','reservations'].every(k=>Array.isArray(state[k])))return blocked('OWNED_HISTORY_UNAVAILABLE');
 const purchases=state.purchaseDrafts.filter(p=>p.id===purchaseId&&scope(p,a)),p=purchases[0],o=p?.terms;
 if(purchases.length!==1)return blocked('PURCHASE_UNAVAILABLE');
 // Whole-credit allocation has no price allocation contract for mixed outcomes.
 // Such purchases use the bounded full-purchase refund, never this credit policy.
 if(o?.fulfillmentPlan){
  try{const plan=fulfillmentPlan(p);if(plan.actions.length!==1||plan.actions[0].type!=='BOOKING_CREDITS')return blocked('FULFILLMENT_ALLOCATION_UNSUPPORTED');}catch{return blocked('FULFILLMENT_ALLOCATION_UNSUPPORTED');}
 }
 const attempts=state.paymentAttempts.filter(x=>x.id===p.activeAttemptId&&x.purchaseId===p.id),attempt=attempts[0];
 if(!o||!scope(o,a)||o.productType!=='class_pack'||!pos(o.quantity)||!pos(o.priceMinor)||p.totalMinor!==o.priceMinor||p.subtotalMinor!==o.priceMinor||p.taxMinor!==0||o.tax?.amountMinor!==0||p.currency!==o.currency||!pos(p.offerVersion)||p.offerVersion!==o.version||p.offerId!==o.id||p.totalMinor%o.quantity!==0||!Array.isArray(o.categories)||!Array.isArray(o.classIds)||o.validityStart!=='confirmed_payment'||!(o.validDays===null||pos(o.validDays))||p.amendments?.length||p.reacceptances?.length)return blocked('FROZEN_ALLOCATION_UNSUPPORTED');
 const policy=o.refundPolicy;
 if(!equal(policy,{approval:'staff',kind:'full_only',whollyUnused:true,noActiveReservations:true,requestWithinDays:policy?.requestWithinDays,windowStartsAt:'confirmed_payment_successful_purchase_completion'})||!pos(policy.requestWithinDays))return blocked('FROZEN_POLICY_UNSUPPORTED');
 if(attempts.length!==1||p.status!=='paid'||p.paymentStatus!=='succeeded'||p.fulfillmentStatus!=='issued'||attempt.status!=='succeeded'||attempt.evidence?.status!=='succeeded'||!validIntegration(attempt.integrationRef,a)||!validCompletion(attempt.evidence,attempt,attempt.integrationRef,financialIntent(p))||attempt.paymentId!==attempt.evidence.paymentId||!equal(attempt.transactionRef,attempt.evidence.transactionRef)||attempt.buyerId!==p.buyerId||attempt.participantId!==p.participantId||attempt.offerDigest!==digest(o)||!equal(attempt.financialIntent,financialIntent(p))||attempt.paymentConfirmedAt!==p.paymentConfirmedAt||p.refundWindowStartsAt!==p.paymentConfirmedAt)return blocked('PURCHASE_PAYMENT_INCONSISTENT');
 const start=time(p.refundWindowStartsAt),cutoff=start+policy.requestWithinDays*86400000,now=time(at);
 if(!Number.isFinite(now)||!Number.isFinite(start)||!Number.isSafeInteger(cutoff)||now<start)return blocked('CLOCK_INVALID');
 // New approved business policy; the closed assessment retains its old result.
 if(!dispositionOnly&&now>=cutoff)return blocked('REFUND_CUTOFF_REACHED');
 const grants=state.entitlementIssuances.filter(g=>g.reference===`purchase:${p.id}`),g=grants[0];
 const passes=state.passes.filter(x=>x.entitlement?.issuanceId===p.issuanceId),pass=passes[0];
 const ent={issuanceId:p.issuanceId,productId:o.productId,productName:o.productName,productType:o.productType,source:g?.source,membershipId:null,validFrom:p.validFrom,expiresAt:p.expiresAt,categories:o.categories,classIds:o.classIds};
 const snapshot={id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds};
 if(grants.length!==1||g.id!==p.issuanceId||g.quantity!==o.quantity||g.participantId!==p.participantId||g.productId!==o.productId||g.membershipId!==null||!g.source||!equal(g.productSnapshot,snapshot)||passes.length!==1||pass.id!==g.passId||pass.quantity!==o.quantity||pass.participantId!==p.participantId||!equal(pass.entitlement,ent)||g.validFrom!==p.validFrom||g.expiresAt!==p.expiresAt||p.validFrom!==p.paymentConfirmedAt||(o.validDays===null?p.expiresAt!==null:time(p.expiresAt)!==start+o.validDays*86400000))return blocked('ISSUANCE_INCONSISTENT');
 const units=state.creditUnits.filter(u=>u.entitlement?.issuanceId===g.id||u.passId===pass.id),events=state.creditEvents.filter(e=>e.passId===pass.id||e.issuanceId===g.id||units.some(u=>u.id===e.unitId));
 if(new Set(units.map(u=>u.id)).size!==units.length||new Set(events.map(e=>e.id)).size!==events.length||events.some(e=>typeof e.id!=='string'||!e.id||!['issue','consume','restore','refund_retire'].includes(e.type)||!units.some(u=>u.id===e.unitId)||!Number.isFinite(time(e.createdAt))||time(e.createdAt)>now||e.participantId!==p.participantId||e.passId!==pass.id)||units.some(u=>u.passId!==pass.id||u.participantId!==p.participantId||!equal(u.entitlement,ent)))return blocked('UNSUPPORTED_OR_INVALID_LINEAGE');
 const roots=units.filter(u=>!u.sourceUnitId&&!u.originBookingId);
 if(roots.length!==o.quantity)return blocked('ORIGINAL_UNITS_INCONSISTENT');
 const available=[];
 for(const root of roots){
  const issuance=events.filter(e=>e.type==='issue'&&e.unitId===root.id);
  if(issuance.length!==1||issuance[0].issuanceId!==g.id||issuance[0].source!==g.source||issuance[0].participantId!==p.participantId||!Number.isFinite(time(g.createdAt))||time(issuance[0].createdAt)<time(g.createdAt)||time(g.createdAt)<time(p.paymentConfirmedAt))return blocked('ORIGIN_PROOF_MISSING');
  const consumed=events.filter(e=>e.type==='consume'&&e.unitId===root.id),children=units.filter(u=>u.sourceUnitId===root.id);
  if(consumed.length>1||children.length>1)return blocked('COMPLEX_USAGE_UNSUPPORTED');
  let leaf=root;
  if(consumed.length){
   const c=consumed[0],reservations=state.reservations.filter(r=>r.id===c.bookingId),r=reservations[0];
   if(root.status!=='spent'||root.spentByBookingId!==c.bookingId||c.participantId!==p.participantId||c.passId!==pass.id||time(c.createdAt)<time(issuance[0].createdAt)||reservations.length!==1||r.participantId!==p.participantId||r.creditConsumption?.unitId!==root.id||r.creditConsumption?.eventId!==c.id||r.creditConsumption?.passId!==pass.id)return blocked('CONSUMPTION_LINEAGE_INVALID');
   if(children.length){
    leaf=children[0];const restores=events.filter(e=>e.type==='restore'&&e.unitId===leaf.id);
    if(leaf.originBookingId!==r.id||r.restoredCreditUnitId!==leaf.id||r.status!=='cancelled'||r.attendanceStatus!=='not_recorded'||r.attendanceHistory?.length||r.attendanceRevision>0||r.cancellation?.classification!=='early'||!r.cancellationHistory?.some(h=>h.action==='cancel'&&h.outcome==='applied'&&h.to==='early'&&h.creditOutcome==='restored')||r.cancellationHistory.some(h=>h.action==='correction')||restores.length!==1||restores[0].bookingId!==r.id||restores[0].participantId!==p.participantId||restores[0].passId!==pass.id||time(restores[0].createdAt)<time(c.createdAt)||events.some(e=>e.type==='consume'&&e.unitId===leaf.id)||units.some(u=>u.sourceUnitId===leaf.id))return blocked('RESTORATION_PROOF_UNSUPPORTED');
   }else continue; // Consumed value is never refunded or un-used.
  }else if(children.length||root.status==='spent')return blocked('CONSUMPTION_PROOF_MISSING');
  if(events.some(e=>(e.unitId===root.id&&e.type==='restore')||(e.unitId===leaf.id&&leaf!==root&&e.type==='issue')))return blocked('UNSUPPORTED_OR_INVALID_LINEAGE');
  if(leaf.status!=='refunded'&&events.some(e=>e.unitId===leaf.id&&e.type==='refund_retire'))return blocked('REFUND_DISPOSITION_UNPROVEN');
  if(leaf.status==='available'||(leaf.status==='refund_held'&&leaf.refundOperationId===holdingOperationId))available.push({unitId:leaf.id,rootUnitId:root.id,amountMinor:p.totalMinor/o.quantity,restored:leaf!==root});
  else if(leaf.status==='refunded'){
   if(!(state.refundOperations??[]).some(op=>scope(op,a)&&op.purchaseId===p.id&&op.id===leaf.refundOperationId&&op.status==='completed'&&op.unitIds?.includes(leaf.id))||events.filter(e=>e.type==='refund_retire'&&e.unitId===leaf.id&&e.operationId===leaf.refundOperationId).length!==1)return blocked('REFUND_DISPOSITION_UNPROVEN');
  }else return blocked('ENTITLEMENT_HELD_OR_UNSUPPORTED');
 }
 if(units.some(u=>u.sourceUnitId&&!roots.some(r=>r.id===u.sourceUnitId)))return blocked('RESTORATION_CHAIN_UNSUPPORTED');
 if(state.reservations.some(r=>r.participantId===p.participantId&&r.status!=='cancelled'))return blocked('ACTIVE_OR_UNRESOLVED_RESERVATION');
 const ops=state.refundOperations??[];
 if(!Array.isArray(ops)||ops.some(x=>!scope(x,a)))return blocked('OWNED_REFUND_STATE_INVALID');
 if(ops.some(op=>op.purchaseId===p.id&&op.id!==holdingOperationId&&active(op)))return blocked('REFUND_ALREADY_ACTIVE');
 return {...base,status:available.length?'ready':'blocked',reasonCodes:available.length?[]:['NO_REFUNDABLE_CREDITS'],units:available.sort((a,b)=>a.unitId.localeCompare(b.unitId)),remainingBusinessMinor:available.reduce((n,u)=>n+u.amountMinor,0),cutoff:new Date(cutoff).toISOString(),purchaseDigest:digest(p),attemptDigest:digest(attempt),frozenTermsDigest:digest(o)};
}

export function refundProgramTransition(state,command,a,{now,id,evidence},fail){
 if(a.role!=='staff')fail('Staff access required',403);
 const b=command.body,at=now(),p=state.purchaseDrafts?.find(p=>p.id===b.purchaseId&&scope(p,a));
 if(!p)fail('Purchase unavailable',404);
 const attempt=state.paymentAttempts?.find(x=>x.id===p.activeAttemptId&&x.purchaseId===p.id);
 if(!attempt)fail('Payment unavailable',409);
 const purchase={tenantId:a.tenantId,businessId:a.businessId,purchaseId:p.id,paymentId:attempt.paymentId,amountMinor:p.totalMinor,currency:p.currency,integrationRef:attempt.integrationRef};
 const operations=state.refundOperations??[];
 const op=operations.find(o=>o.id===b.operationId&&o.purchaseId===p.id&&scope(o,a));
 const audit=(o,action,extra={})=>{const e={id:id(),action,operationId:o.id,subjectId:p.id,tenantId:a.tenantId,businessId:a.businessId,actorId:a.userId,requestId:b.requestId,createdAt:at,...extra};o.history.push(e);(state.activity??=[]).push(structuredClone(e));};
 const output=o=>({refund:structuredClone(o),executionAuthorized:false});
 const inventory=()=>{if(!evidence||evidence.stateDigest!==digest(state))fail('Fresh business state required',409);return reconcileRefundInventory({purchase,operations:operations.filter(o=>o.purchaseId===p.id),evidence:evidence.inventory,at});};
 const selected=(facts,ids)=>{
  if(facts.status!=='ready')fail(facts.reasonCodes.join(', '),409);
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(x=>typeof x!=='string'))fail('Select whole refundable credits',400);
  const items=ids.map(key=>facts.units.find(u=>u.unitId===key));if(items.some(x=>!x))fail('Selected credits no longer refundable',409);return items;
 };
 const holdUnits=o=>{const units=state.creditUnits.filter(u=>o.unitIds.includes(u.id));if(units.length!==o.unitIds.length||units.some(u=>u.status!=='refund_held'||u.refundOperationId!==o.id))fail('Refund hold inconsistent',409);return units;};
 if(command.action==='refund-program-intent'){
  if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>120)fail('Refund reason required');
  const operationId=digest(['refund-program/1',a.tenantId,a.businessId,p.id,a.userId,b.requestId]).slice(0,40);
  const prior=operations.find(o=>o.id===operationId);
  if(prior){if(prior.reason!==b.reason.trim()||digest(prior.unitIds)!==digest([...(b.unitIds??[])].sort()))fail('Refund request conflict',409);return output(prior);}
  const report=inventory();if(report.status!=='reconciled')fail(report.reasonCodes.join(', '),409);
  if(!pos(evidence.inventory.remainingOperationCapacity))fail('Provider refund operation capacity unavailable',409);
  const facts=refundProgramFacts(state,a,p.id,at),items=selected(facts,b.unitIds),amount=items.reduce((n,u)=>n+u.amountMinor,0);
  if(amount>report.remainingProviderMinor)fail('Remaining provider amount exceeded',409);
  const o={id:operationId,providerKey:operationId,contract:'refund-program/1',...purchase,attemptId:attempt.id,integrationRef:structuredClone(attempt.integrationRef),actorId:a.userId,participantId:p.participantId,issuanceId:p.issuanceId,amountMinor:amount,paymentAmountMinor:p.totalMinor,quantity:items.length,unitIds:items.map(u=>u.unitId).sort(),allocation:items,policy:structuredClone(REFUND_POLICY),frozenTermsDigest:facts.frozenTermsDigest,purchaseDigest:facts.purchaseDigest,attemptDigest:facts.attemptDigest,reason:b.reason.trim(),status:'intent',createdAt:at,history:[]};
  state.refundOperations=operations;operations.push(o);for(const unit of state.creditUnits.filter(u=>o.unitIds.includes(u.id))){unit.status='refund_held';unit.refundOperationId=o.id;}
  audit(o,'refund-intent',{evidenceDigest:report.evidenceDigest,policyVersion:REFUND_POLICY.version});return output(o);
 }
 if(command.action==='refund-program-external'){
  const report=inventory();
  if(report.reasonCodes.some(c=>!['UNMATCHED_EXTERNAL_REFUND','PROVIDER_PENDING','UNRESOLVED_DISPATCH','UNBOUND_PROVIDER_CANDIDATE','OWNED_INTENT_PENDING','BUSINESS_OBSERVATION_REQUIRED'].includes(c)))fail('External evidence conflicting or incomplete',409);
  if(!report.external.length)return {externalRecorded:0,executionAuthorized:false};
  // An unmatched reason can be a lost response. Never adopt it as a completed
  // business operation or grant authority to re-submit.
  state.refundOperations=operations;
  for(const r of report.external){
   const key=digest(['external-refund/1',a.tenantId,a.businessId,attempt.integrationRef,r.refundId]).slice(0,40);
   if(operations.some(o=>o.id===key))continue;
   const units=state.creditUnits.filter(u=>u.entitlement?.issuanceId===p.issuanceId&&u.participantId===p.participantId&&u.status==='available');
   const ext={id:key,contract:'refund-program/1',origin:'external',...purchase,actorId:a.userId,participantId:p.participantId,issuanceId:p.issuanceId,attemptId:attempt.id,paymentAmountMinor:p.totalMinor,amountMinor:r.amountMinor,providerRefundId:r.refundId,providerStatus:r.status,status:'needs-review',unitIds:units.map(u=>u.id).sort(),createdAt:at,policy:structuredClone(REFUND_POLICY),history:[]};
   operations.push(ext);for(const u of units){u.status='refund_held';u.refundOperationId=ext.id;}
   audit(ext,'refund-external-recorded',{providerStatus:r.status,evidenceDigest:report.evidenceDigest});
  }
  return {externalRecorded:report.external.length,executionAuthorized:false};
 }
 if(!op||op.contract!=='refund-program/1')fail('Refund unavailable',404);
 if(command.action==='refund-program-external-resolve'){
  if(op.origin!=='external')fail('External refund required',409);
  if(['completed','released'].includes(op.status))return output(op);
  if(!evidence||evidence.stateDigest!==digest(state))fail('Fresh business state required',409);
  const report=reconcileRefundInventory({purchase,operations:operations.filter(o=>o.purchaseId===p.id&&o.id!==op.id),evidence:evidence.inventory,at});
  if(report.reasonCodes.some(c=>c!=='UNMATCHED_EXTERNAL_REFUND')||report.external.length!==1||report.external[0].refundId!==op.providerRefundId)fail('External outcome requires further review',409);
  const r=report.external[0];if(r.amountMinor!==op.amountMinor)fail('External amount changed',409);
  if(r.status==='pending')fail('Provider pending; retain hold',409);
  const held=holdUnits(op);
  if(['failed','rejected'].includes(r.status)){
   for(const u of held){u.status='available';delete u.refundOperationId;}op.status='released';op.failureStatus=r.status;
   audit(op,'refund-hold-released',{evidenceDigest:report.evidenceDigest});return output(op);
  }
  if(r.status!=='completed')fail('External completion unproven',409);
  const facts=refundProgramFacts(state,a,p.id,at,{holdingOperationId:op.id,dispositionOnly:true});
  const items=selected(facts,b.unitIds);
  if(items.reduce((n,u)=>n+u.amountMinor,0)!==op.amountMinor)fail('Exact external entitlement allocation required',409);
  const selectedIds=new Set(items.map(x=>x.unitId));
  for(const u of held){if(selectedIds.has(u.id)){u.status='refunded';state.creditEvents.push({id:id(),type:'refund_retire',unitId:u.id,passId:u.passId,issuanceId:op.issuanceId,participantId:u.participantId,operationId:op.id,actorId:a.userId,requestId:b.requestId,createdAt:at});}else{u.status='available';delete u.refundOperationId;}}
  op.heldUnitIds=op.unitIds;op.unitIds=[...selectedIds].sort();op.allocation=items;op.status='completed';
  audit(op,'refund-observation',{status:'completed',external:true,evidenceDigest:report.evidenceDigest});reconcileFulfillment(state,p,op,at);return output(op);
 }
 if(op.origin==='external')fail('External refunds require reviewed disposition; never dispatch',409);
 if(command.action==='refund-program-bind'){
  if(!['dispatching','unknown','pending'].includes(op.status)||op.providerRefundId)fail('Only unresolved dispatch may bind an outcome',409);
  const report=inventory();
  if(report.reasonCodes.some(c=>!['UNRESOLVED_DISPATCH','UNBOUND_PROVIDER_CANDIDATE','UNMATCHED_EXTERNAL_REFUND'].includes(c)))fail('Conflicting recovery evidence',409);
  const candidates=evidence.inventory.refunds.filter(r=>r.reason===`Refund ${op.id}: ${op.reason}`&&r.amountMinor===op.amountMinor);
  if(candidates.length!==1||operations.some(o=>o.providerRefundId===candidates[0].id))fail('Unique reviewed provider match required',409);
  op.providerRefundId=candidates[0].id;
  audit(op,'refund-provider-bound',{providerRefundId:op.providerRefundId,evidenceDigest:report.evidenceDigest});return output(op);
 }
 if(command.action==='refund-program-dispatch'){
  if(op.status!=='intent')fail('Submission already claimed; reconcile only',409);
  holdUnits(op);
  if(digest(p)!==op.purchaseDigest||digest(attempt)!==op.attemptDigest)fail('Purchase changed after intent',409);
  const facts=refundProgramFacts(state,a,p.id,at,{holdingOperationId:op.id});selected(facts,op.unitIds);
  if(!evidence||evidence.stateDigest!==digest(state))fail('Fresh business state required',409);
  const report=reconcileRefundInventory({purchase,operations:operations.filter(o=>o.purchaseId===p.id&&o.id!==op.id),evidence:evidence.inventory,at});
  if(report.status!=='reconciled'||op.amountMinor>report.remainingProviderMinor)fail('Provider readiness changed',409);
  if(!pos(evidence.inventory.remainingOperationCapacity))fail('Provider refund operation capacity unavailable',409);
  op.paymentVersion=evidence.inventory.payment.version;op.status='dispatching';op.dispatchedAt=at;
  audit(op,'refund-dispatch',{evidenceDigest:report.evidenceDigest});return output(op);
 }
 if(['refund-program-observe','refund-program-release'].includes(command.action)){
  if(!['dispatching','unknown','pending','completed','failed','rejected','released'].includes(op.status))fail('Refund has not been dispatched',409);
  if(!scope(evidence,a)||evidence.purchaseId!==p.id||evidence.operationId!==op.id||evidence.paymentId!==op.paymentId||!Number.isFinite(time(evidence.observedAt))||time(at)<time(evidence.observedAt)||time(at)-time(evidence.observedAt)>30000)fail('Observation binding invalid',409);
  const status=evidence.status;
  if(!['unknown','pending','completed','failed','rejected'].includes(status))fail('Outcome unsupported',409);
  if(status!=='unknown'&&(evidence.verified!==true||!evidence.refundId||evidence.amountMinor!==op.amountMinor||evidence.currency!==op.currency))fail('Outcome not proven',409);
  if(op.providerRefundId&&evidence.refundId&&op.providerRefundId!==evidence.refundId)fail('Provider identity conflict',409);
  if(command.action==='refund-program-release'){
   if(op.status==='released')return output(op);
   if(!['failed','rejected'].includes(op.status)||status!==op.status||evidence.refundId!==op.providerRefundId)fail('Conclusive fresh failure required',409);
   for(const u of holdUnits(op)){u.status='available';delete u.refundOperationId;}op.failureStatus=op.status;op.status='released';audit(op,'refund-hold-released',{evidenceDigest:digest(evidence)});return output(op);
  }
  if(['completed','failed','rejected','released'].includes(op.status)){
   if(status!==(op.failureStatus??op.status)||evidence.refundId!==op.providerRefundId)fail('Terminal evidence conflicts',409);return output(op);
  }
  const units=holdUnits(op);op.status=status;if(evidence.refundId)op.providerRefundId=evidence.refundId;
  if(status==='completed')for(const u of units){u.status='refunded';state.creditEvents.push({id:id(),type:'refund_retire',unitId:u.id,passId:u.passId,issuanceId:op.issuanceId,participantId:u.participantId,operationId:op.id,actorId:a.userId,requestId:b.requestId,createdAt:at});}
  audit(op,'refund-observation',{status,providerRefundId:op.providerRefundId??null,evidence:structuredClone(evidence)});if(status==='completed')reconcileFulfillment(state,p,op,at);return output(op);
 }
 fail('Unsupported refund program command',400);
}
