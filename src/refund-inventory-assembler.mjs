import {isDeepStrictEqual as equal} from 'node:util';
import {inventoryDigest,validateRefundInventory} from './refund-inventory.mjs';
import {assessRefundEligibility} from './refund-eligibility.mjs';

const denied=()=>({status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],executionAuthorized:false,staffApprovalRequired:true});
const blocked=code=>({status:'blocked',reasonCodes:[code],executionAuthorized:false,staffApprovalRequired:true});
// Dependency seam is for local verification. Production uses the closed evaluator.
export function createRefundInventoryAssembler(evaluate=assessRefundEligibility){
 return function assembleRefundAssessment(input={}){
  const {authority,context,ownedSnapshot:s,frozenTermsRef,providerEvidence,attestations}=input;
  const scope=context?.scope;
  // No inventory is assembled or disclosed before trusted authority is resolved.
  if(authority?.role!=='staff'||!scope||authority.tenantId!==scope.tenantId||authority.businessId!==scope.businessId)return denied();
  if(!s?.state||!s.facts||!equal(s.scope,scope))return blocked('OWNED_SNAPSHOT_UNRESOLVED');
  // Bind both eligibility state and its inventory projection to the same trusted
  // snapshot. This is distinct from a database digest, whose format is external.
  const binding=attestations?.snapshot;
  const payloadDigest=inventoryDigest({state:s.state,facts:s.facts});
  if(!binding||binding.verified!==true||!equal(binding.scope,scope)||binding.revision!==s.revision||binding.stateDigest!==s.stateDigest||binding.payloadDigest!==payloadDigest||!binding.source||!binding.schemaVersion)
   return blocked('SNAPSHOT_PROVENANCE_UNVERIFIED');
  const envelope=structuredClone({contractVersion:1,scope:s.scope,snapshot:{revision:s.revision,stateDigest:s.stateDigest,assessedAt:s.assessedAt,evidenceCutoff:s.evidenceCutoff},frozenTermsRef,paymentRef:s.paymentRef,ownedFacts:s.facts,providerFacts:providerEvidence?.facts,coverage:attestations?.coverage,policyBoundaries:attestations?.policyBoundaries});
  const inventory=validateRefundInventory({envelope,authority,context,trustedEvidence:attestations?.evidence});
  if(inventory.status==='denied')return denied();
  if(inventory.status!=='usable')return {...inventory,envelope};
  const d=s.state.purchaseDrafts?.find(x=>x.id===scope.purchaseId&&x.tenantId===scope.tenantId&&x.businessId===scope.businessId);
  const a=s.state.paymentAttempts?.find(x=>x.id===scope.attemptId&&x.purchaseId===scope.purchaseId);
  const f=s.facts,ref=s.paymentRef;
  const projectedRef=a?.transactionRef&&{provider:a.transactionRef.provider,integrationId:a.transactionRef.integrationId,integrationVersion:a.transactionRef.integrationVersion,environment:a.transactionRef.environment,resourceId:a.transactionRef.id};
  // Never allow a usable projection to be paired with another eligibility view.
  if(!d||!a||d.activeAttemptId!==a.id||!equal(projectedRef,ref)||d.totalMinor!==f.purchase.amountMinor||d.currency!==f.purchase.currency||inventoryDigest(d.terms)!==frozenTermsRef?.digest||d.terms.id!==frozenTermsRef.id||d.paymentConfirmedAt!==f.confirmation.confirmedAt||d.refundWindowStartsAt!==f.clocks.refundWindowStartsAt||!Array.isArray(s.state.refundRecords)||!equal(s.state.refundRecords,f.refunds))
   return {...blocked('OWNED_PROJECTION_CONFLICT'),inventory,envelope};
  const grants=s.state.entitlementIssuances?.filter(x=>x.reference===`purchase:${d.id}`);
  if(!Array.isArray(grants)||!equal(grants.map(x=>({id:x.id,quantity:x.quantity})),f.issuance.map(x=>({id:x.id,quantity:x.quantity}))))return {...blocked('OWNED_PROJECTION_CONFLICT'),inventory,envelope};
  if(!Array.isArray(s.state.creditEvents)||!Array.isArray(s.state.reservations))return {...blocked('OWNED_PROJECTION_CONFLICT'),inventory,envelope};
  const linked=rows=>rows.filter(r=>grants.some(g=>g.passId===r.passId)).map(r=>({id:r.id,issuanceId:grants.find(g=>g.passId===r.passId).id}));
  const sameHistory=(actual,projected)=>equal(actual.map(r=>[r.id,r.issuanceId]).sort(),projected.map(r=>[r.id,r.issuanceId]).sort());
  if(!sameHistory(linked(s.state.creditEvents.filter(r=>r.type==='consume')),f.consumption)||!sameHistory(linked(s.state.creditEvents.filter(r=>/restore|revers/.test(r.type))),f.restoration)||!sameHistory(linked(s.state.reservations),f.reservations))return {...blocked('OWNED_PROJECTION_CONFLICT'),inventory,envelope};
  const end=Date.parse(d.refundWindowStartsAt)+d.terms.refundPolicy?.requestWithinDays*86400000;
  if(Date.parse(f.clocks.refundWindowEndsAt)!==end)return {...blocked('OWNED_PROJECTION_CONFLICT'),inventory,envelope};
  // No separate empty-list default: only the validated owned refund inventory.
  const eligibility=evaluate({state:s.state,authority,purchaseId:scope.purchaseId,at:context.at,refundRecords:f.refunds});
  return {status:eligibility.status,reasonCodes:eligibility.reasonCodes,staffApprovalRequired:true,executionAuthorized:false,envelope,inventory,eligibility};
 };
}
export const assembleRefundAssessment=createRefundInventoryAssembler();
