import {digest} from './payments.mjs';

const scope=(x,a)=>x?.tenantId===a?.tenantId&&x?.businessId===a?.businessId;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const statuses=new Set(['pending','completed','failed','rejected']);

// Pure comparison of server-acquired evidence. This does not authorize a refund,
// change an entitlement, or turn a matching reason string into business authority.
export function reconcileRefundInventory({purchase,operations,evidence,at}){
 const base={contract:'refund-reconciliation/1',purchaseId:purchase?.purchaseId,executionAuthorized:false,historicalCompleteness:'unknown',readOnly:true};
 const problems=new Set(),matches=[],external=[];
 const add=code=>problems.add(code);
 const done=extra=>({...base,status:problems.size?'needs-review':'reconciled',reasonCodes:[...problems].sort(),matches,external,...extra});
 if(!purchase||!positive(purchase.amountMinor)||!purchase.paymentId||!purchase.currency||!Array.isArray(operations)){
  add('BUSINESS_BINDING_INVALID');return done();
 }
 if(!evidence||evidence.contract!=='refund-provider-inventory/1'||!scope(evidence,purchase)||evidence.purchaseId!==purchase.purchaseId||evidence.paymentId!==purchase.paymentId||evidence.integrationDigest!==digest(purchase.integrationRef)){
  add('PROVIDER_BINDING_INVALID');return done();
 }
 const time=Date.parse(at),observed=Date.parse(evidence.observedAt),cutoff=Date.parse(evidence.cutoff);
 if(!Number.isFinite(time)||!Number.isFinite(observed)||!Number.isFinite(cutoff)||observed>time||cutoff>observed||time-cutoff>30000){add('PROVIDER_EVIDENCE_STALE');return done();}
 if(evidence.coverage?.paginationExhausted!==true||evidence.coverage?.paymentStable!==true||evidence.coverage?.allRefundStatuses!==true||!Array.isArray(evidence.refunds)||!Array.isArray(evidence.disputes)){
  add('PROVIDER_COVERAGE_INCOMPLETE');return done();
 }
 const p=evidence.payment;
 if(p?.id!==purchase.paymentId||p.status!=='COMPLETED'||p.amountMinor!==purchase.amountMinor||p.currency!==purchase.currency||!p.version||!Array.isArray(p.refundIds)||!Number.isSafeInteger(p.refundedMinor)||p.refundedMinor<0){add('PAYMENT_BINDING_CONFLICT');return done();}
 if(evidence.disputes.length)add('PROVIDER_DISPUTE');
 const rows=new Map(),owned=new Map(),used=new Set();
 for(const r of evidence.refunds){
  if(!r||typeof r.id!=='string'||!r.id||r.paymentId!==purchase.paymentId||r.currency!==purchase.currency||!positive(r.amountMinor)||!statuses.has(r.status)){add('REFUND_EVIDENCE_INVALID');continue;}
  if(rows.has(r.id)){add(digest(rows.get(r.id))===digest(r)?'DUPLICATE_PROVIDER_REFUND':'CONFLICTING_PROVIDER_REFUND');continue;}
  rows.set(r.id,r);
 }
 for(const id of p.refundIds)if(typeof id!=='string'||!rows.has(id))add('PAYMENT_REFUND_COVERAGE_GAP');
 if(new Set(p.refundIds).size!==p.refundIds.length)add('DUPLICATE_PAYMENT_REFUND_ID');
 for(const o of operations){
  if(!scope(o,purchase)||o.purchaseId!==purchase.purchaseId||o.paymentId!==purchase.paymentId||o.currency!==purchase.currency||!positive(o.amountMinor)||!o.id){add('OWNED_REFUND_BINDING_CONFLICT');continue;}
  if(owned.has(o.id)){add('DUPLICATE_OWNED_OPERATION');continue;}owned.set(o.id,o);
  if(o.providerRefundId){
   const r=rows.get(o.providerRefundId);
   if(!r){add('OWNED_PROVIDER_REFUND_MISSING');continue;}
   if(used.has(r.id)){add('PROVIDER_REFUND_LINKED_TWICE');continue;}used.add(r.id);
   if(r.amountMinor!==o.amountMinor){add('REFUND_AMOUNT_CONFLICT');continue;}
   const expected=o.status==='released'?o.failureStatus:o.status;
   if(['completed','failed','rejected'].includes(expected)&&expected!==r.status)add('TERMINAL_STATUS_CONFLICT');
   if(o.status==='intent')add('UNDISPATCHED_PROVIDER_REFUND');
   if(o.origin==='external'&&o.status==='needs-review')add('EXTERNAL_DISPOSITION_REQUIRED');
   else if(!['intent','dispatching','unknown','pending','completed','failed','rejected','released'].includes(o.status))add('OWNED_STATUS_UNSUPPORTED');
   if(expected!==r.status&& !['completed','failed','rejected'].includes(expected))add('BUSINESS_OBSERVATION_REQUIRED');
   if(r.status==='pending')add('PROVIDER_PENDING');
   matches.push({operationId:o.id,refundId:r.id,ownedStatus:o.status,providerStatus:r.status,amountMinor:r.amountMinor});
  }else if(['dispatching','unknown','pending','completed','failed','rejected','released'].includes(o.status)){
   add('UNRESOLVED_DISPATCH');
   // Reason is only a search clue. A dashboard user can copy it.
   const candidates=[...rows.values()].filter(r=>r.reason===`Refund ${o.id}: ${o.reason}`&&r.amountMinor===o.amountMinor);
   if(candidates.length)add(candidates.length===1?'UNBOUND_PROVIDER_CANDIDATE':'AMBIGUOUS_PROVIDER_CANDIDATES');
  }else if(o.status==='intent')add('OWNED_INTENT_PENDING');else add('OWNED_STATUS_UNSUPPORTED');
 }
 for(const r of rows.values())if(!used.has(r.id)){
  external.push({refundId:r.id,status:r.status,amountMinor:r.amountMinor,currency:r.currency});add('UNMATCHED_EXTERNAL_REFUND');
 }
 const completedMinor=[...rows.values()].filter(r=>r.status==='completed').reduce((n,r)=>n+r.amountMinor,0);
 const pendingMinor=[...rows.values()].filter(r=>r.status==='pending').reduce((n,r)=>n+r.amountMinor,0);
 if(!Number.isSafeInteger(completedMinor+pendingMinor)||completedMinor+pendingMinor>purchase.amountMinor)add('OVER_REFUND_EVIDENCE');
 // Square's payment total and refund objects are independent observations. A
 // disagreement blocks; never repair either from the other.
 if(p.refundedMinor!==completedMinor)add('PAYMENT_REFUND_TOTAL_CONFLICT');
 return done({completedMinor,pendingMinor,remainingProviderMinor:problems.size?null:purchase.amountMinor-completedMinor-pendingMinor,evidenceDigest:digest(evidence),cutoff:evidence.cutoff,
  recovery:problems.has('UNRESOLVED_DISPATCH')?'reconcile-before-any-reviewed-retry':'no-submission',automaticRetry:false});
}

// Safe projections only: no provider identifiers, evidence payload, actor IDs,
// reason text, credentials, internal request IDs or private command receipts.
export function refundHistory(state,authority){
 if(!['staff','member'].includes(authority?.role))return [];
 const purchases=(state.purchaseDrafts??[]).filter(p=>scope(p,authority)&&(authority.role==='staff'||(p.buyerId===authority.userId&&authority.participantIds?.includes(p.participantId))));
 const permitted=new Map(purchases.map(p=>[p.id,p]));
 return (state.refundOperations??[]).filter(o=>scope(o,authority)&&permitted.has(o.purchaseId)).map(o=>({
  id:o.id,purchaseId:o.purchaseId,amountMinor:o.amountMinor,currency:o.currency,
  status:['intent','dispatching','unknown'].includes(o.status)?(o.status==='unknown'?'needs-review':'pending'):['completed','pending','failed','rejected','released'].includes(o.status)?(o.status==='released'?o.failureStatus:o.status):'needs-review',
  entitlementDisposition:o.status==='completed'?'retired':o.status==='released'?'released':'held',
  createdAt:o.createdAt,
  ...(authority.role==='staff'?{contract:o.contract,origin:o.origin??'staff',recoveryAction:o.origin==='external'&&o.status==='needs-review'?'resolve':!o.providerRefundId&&['unknown','dispatching'].includes(o.status)?'bind':null}:{}),
  history:(o.history??[]).filter(h=>['refund-intent','refund-dispatch','refund-observation','refund-hold-released','refund-external-recorded','refund-provider-bound'].includes(h.action)).map(h=>({event:h.action,at:h.createdAt,...(h.status?{status:h.status==='unknown'?'needs-review':h.status}:{})}))
 })).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||a.id.localeCompare(b.id));
}
