import {isDeepStrictEqual as equal} from 'node:util';
import {inventoryDigest,ownedInventoryCategories} from './refund-inventory.mjs';
import {assembleRefundAssessment} from './refund-inventory-assembler.mjs';

const denied=()=>({status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],staffApprovalRequired:true,executionAuthorized:false});
const blocked=code=>({status:'blocked',reasonCodes:[code],staffApprovalRequired:true,executionAuthorized:false});
const list=x=>Array.isArray(x)?x:[];
const clone=x=>structuredClone(x);
// Server infrastructure owns this interface. It must enforce the requested
// transaction mode and source identity; this is never an HTTP input boundary.
// No connection, provider client, persistence or operational freshness policy here.
export function createOwnedRefundSnapshotLoader({source,assess=assembleRefundAssessment}){
 return async function loadOwnedRefundSnapshot({authenticatedPrincipal,purchaseId,expectedAttemptId,expectedCheckpoint,assessmentContext}={}){
  if(source?.environment!=='development')return blocked('DEVELOPMENT_SOURCE_REQUIRED');
  return source.withSnapshot({isolation:'repeatable read',readOnly:true},async reader=>{
   const authority=await reader.resolveAuthority(authenticatedPrincipal);
   if(authority?.role!=='staff'||!authority.tenantId||!authority.businessId)return denied();
   const row=await reader.readOwnedState({tenantId:authority.tenantId,businessId:authority.businessId});
   if(!row?.state||row.tenantId!==authority.tenantId||row.businessId!==authority.businessId)return denied();
   const state=clone(row.state);
   const matches=list(state.purchaseDrafts).filter(d=>d.id===purchaseId&&d.tenantId===authority.tenantId&&d.businessId===authority.businessId);
   if(matches.length===0)return denied();
   if(matches.length!==1)return blocked('OWNED_PROJECTION_CONFLICT');
   const d=matches[0],attempts=list(state.paymentAttempts).filter(a=>a.id===d.activeAttemptId&&a.purchaseId===d.id);
   if(attempts.length!==1||attempts[0].id!==expectedAttemptId)return blocked('OWNED_PROJECTION_CONFLICT');
   const a=attempts[0],scope={tenantId:authority.tenantId,businessId:authority.businessId,purchaseId:d.id,attemptId:a.id};
   if(row.revision===undefined||row.revision===null||!row.source||!row.schemaVersion)return blocked('SNAPSHOT_PROVENANCE_UNVERIFIED');
   const revision=String(row.revision),stateDigest=inventoryDigest(state);
   const checkpoint={revision,stateDigest,historicalMd5:row.historicalMd5};
   if(!expectedCheckpoint||Object.keys(expectedCheckpoint).some(k=>!['revision','stateDigest','historicalMd5'].includes(k)||expectedCheckpoint[k]!==checkpoint[k]))return blocked('SNAPSHOT_CHECKPOINT_MISMATCH');
   if(!Object.keys(expectedCheckpoint).length)return blocked('SNAPSHOT_CHECKPOINT_MISMATCH');
   if(row.historicalMd5!==undefined&&!/^[a-f0-9]{32}$/.test(row.historicalMd5))return blocked('SNAPSHOT_CHECKPOINT_MISMATCH');
   const support=await reader.readOwnedEvidence(scope);
   const conflicts=new Set(),incomplete=new Set();
   const record=(r,extra={})=>{
    if((r.tenantId!==undefined&&r.tenantId!==scope.tenantId)||(r.businessId!==undefined&&r.businessId!==scope.businessId)||(r.scope!==undefined&&!equal(r.scope,scope)))conflicts.add('scope');
    return {id:r.id,scope:clone(scope),...extra};
   };
   const grants=list(state.entitlementIssuances).filter(g=>g.reference===`purchase:${d.id}`);
   const units=list(state.creditUnits).filter(u=>grants.some(g=>g.id===u.entitlement?.issuanceId));
   const passes=list(state.passes).filter(p=>grants.some(g=>g.id===p.entitlement?.issuanceId||g.passId===p.id));
   // An inherited scope is valid only for records reached through this scoped
   // state and owned links. Explicit contradictory scope must never be erased.
   [a,...grants,...units,...passes].forEach(r=>record(r));
   const linked=r=>grants.filter(g=>r.passId===g.passId||r.issuanceId===g.id||units.some(u=>u.id===r.unitId&&u.entitlement?.issuanceId===g.id));
   const events=list(state.creditEvents).filter(r=>linked(r).length);
   const projectHistory=rows=>rows.map(r=>{const gs=linked(r);if(gs.length!==1)conflicts.add('link');return record(r,{issuanceId:gs[0]?.id});});
   for(const e of events)if(!['issue','consume','restore','reverse','reversal','refund'].includes(e.type))incomplete.add('consumption');
   const reservations=list(state.reservations).filter(r=>linked(r).length);
   if(list(state.reservations).some(r=>r.participantId===d.participantId&&r.status!=='cancelled'&&!linked(r).length))incomplete.add('reservations');
   for(const [collection,categories] of [['entitlementIssuances',['issuance']],['creditUnits',['issuance','consumption']],['passes',['issuance']],['creditEvents',['consumption','restoration']],['reservations',['reservations']]])if(!Array.isArray(state[collection]))categories.forEach(c=>incomplete.add(c));
   const frozenTermsRef=d.terms?{id:d.terms.id,digest:inventoryDigest(d.terms)}:undefined;
   const tr=a.transactionRef,paymentRef=tr&&{provider:tr.provider,integrationId:tr.integrationId,integrationVersion:tr.integrationVersion,environment:tr.environment,resourceId:tr.id};
   const end=Date.parse(d.refundWindowStartsAt)+d.terms?.refundPolicy?.requestWithinDays*86400000;
   const facts={purchase:{amountMinor:d.totalMinor,currency:d.currency,frozenTermsDigest:frozenTermsRef?.digest},confirmation:{status:d.paymentStatus==='succeeded'&&a.status==='succeeded'?'confirmed':a.status,paymentRef,confirmedAt:d.paymentConfirmedAt},issuance:grants.map(g=>record(g,{quantity:g.quantity})),consumption:projectHistory(events.filter(e=>e.type==='consume')),restoration:projectHistory(events.filter(e=>['restore','reverse','reversal','refund'].includes(e.type))),reservations:projectHistory(reservations),clocks:{refundWindowStartsAt:d.refundWindowStartsAt,refundWindowEndsAt:Number.isFinite(end)&&Number.isFinite(new Date(end).getTime())?new Date(end).toISOString():undefined},ownership:clone(scope)};
   // Never create absent histories. Refund records are already-normalized owned
   // records; retain original scope/provenance for the closed validator to check.
   if(Array.isArray(state.refundRecords))facts.refunds=clone(state.refundRecords.filter(r=>r.purchaseId===d.id||r.scope?.purchaseId===d.id));
   if(Array.isArray(support?.recovery))facts.recovery=clone(support.recovery);
   if(Array.isArray(support?.audit))facts.audit=clone(support.audit);
   for(const c of ['refunds','recovery','audit'])for(const r of list(facts[c])){
    record(r);
    if(r.purchaseId!==undefined&&r.purchaseId!==scope.purchaseId)conflicts.add('scope');
    if(r.attemptId!==undefined&&r.attemptId!==scope.attemptId)conflicts.add('scope');
   }
   if(a.paymentConfirmedAt!==d.paymentConfirmedAt||!equal(a.transactionRef,a.evidence?.transactionRef)||a.paymentId!==a.evidence?.paymentId||a.status!==a.evidence?.status||d.paymentStatus!==a.status)conflicts.add('payment');
   if(conflicts.size)return blocked('OWNED_PROJECTION_CONFLICT');
   const coverage={owned:{},provider:{state:'provider_unknown'}};
   for(const c of ownedInventoryCategories){
    coverage.owned[c]=clone(support?.coverage?.[c]??{state:'incomplete'});
    if(facts[c]===undefined||incomplete.has(c))coverage.owned[c]={...coverage.owned[c],state:'incomplete'};
   }
   const snapshot={scope,revision,stateDigest,assessedAt:row.observedAt,evidenceCutoff:support?.evidenceCutoff,state,facts,paymentRef};
   const policyBoundaries=Array.isArray(support?.policyBoundaries)?clone(support.policyBoundaries):undefined;
   const input={authority:clone(authority),context:{scope:clone(scope),revision,stateDigest,at:assessmentContext?.at,freshnessPolicy:clone(assessmentContext?.freshnessPolicy)},ownedSnapshot:snapshot,frozenTermsRef,attestations:{snapshot:{verified:true,scope:clone(scope),revision,stateDigest,payloadDigest:inventoryDigest({state,facts}),source:row.source,schemaVersion:row.schemaVersion},coverage,policyBoundaries,evidence:clone(support?.evidence)}};
   // This bounded loader does not acquire or assert provider coverage. A future
   // reviewed evidence source may supply it; accepted payment alone never does.
   const assessment=assess(input);
   return {status:assessment.status,reasonCodes:assessment.reasonCodes,staffApprovalRequired:true,executionAuthorized:false,checkpoint,assemblerInput:input,assessment};
  });
 };
}
