import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';

export const ownedInventoryCategories=Object.freeze(['purchase','confirmation','refunds','issuance','consumption','restoration','reservations','clocks','ownership','recovery','audit']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const stamp=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const inventoryDigest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const validScope=s=>object(s)&&['tenantId','businessId','purchaseId','attemptId'].every(k=>text(s[k]));
const validRef=r=>object(r)&&['provider','integrationId','environment','resourceId'].every(k=>text(r[k]))&&Number.isSafeInteger(r.integrationVersion)&&r.integrationVersion>0;
const basis=b=>object(b)&&text(b.source)&&text(b.method)&&b.exhaustive===true&&b.paginationComplete===true&&Array.isArray(b.exclusions)&&b.exclusions.length===0;

// envelope, context, and the evidence registry are server-owned inputs. This
// validates assertions and their bindings; it cannot authenticate a provider or
// discover missing records. Never populate trustedEvidence from an HTTP body.
export function validateRefundInventory({envelope:e,authority,context,trustedEvidence}={}){
 const denied=()=>({status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],eligibilityUsable:false,executionAuthorized:false});
 // Access denial discloses no inventory, revision, or coverage information.
 if(!validScope(context?.scope)||authority?.role!=='staff'||authority.tenantId!==context.scope.tenantId||authority.businessId!==context.scope.businessId)return denied();
 const reasons=new Set();let owned='complete',provider='complete_as_of';
 const block=(code,dimension,state)=>{reasons.add(code);if(dimension==='owned'&&(owned!=='conflicted'||state==='conflicted'))owned=state;if(dimension==='provider'&&(provider!=='conflicted'||state==='conflicted'))provider=state;};
 const finish=()=>({status:reasons.size?'blocked':'usable',reasonCodes:[...reasons],coverage:{owned,provider},eligibilityUsable:reasons.size===0,staffApprovalRequired:true,executionAuthorized:false});
 if(!object(e)||e.contractVersion!==1||!validScope(e.scope)||!equal(e.scope,context.scope)){block('INVENTORY_SCOPE_CONFLICT','owned','conflicted');return finish();}
 if(!stamp(context.at)||!text(context.revision)||!hash(context.stateDigest)||!object(e.snapshot)||!stamp(e.snapshot.assessedAt)||!stamp(e.snapshot.evidenceCutoff)||Date.parse(e.snapshot.evidenceCutoff)>Date.parse(e.snapshot.assessedAt)||Date.parse(e.snapshot.assessedAt)>Date.parse(context.at)){
  block('INVENTORY_SCHEMA_INVALID','owned','incomplete');return finish();
 }
 if(e.snapshot.revision!==context.revision||e.snapshot.stateDigest!==context.stateDigest)block('INVENTORY_STALE','owned','stale');
 const freshness=context.freshnessPolicy;
 if(!object(freshness)||!text(freshness.approvalRef)||!text(freshness.id)||!['ownedMaxAgeMs','providerMaxAgeMs'].every(k=>Number.isSafeInteger(freshness[k])&&freshness[k]>=0))block('CURRENTNESS_POLICY_UNRESOLVED','provider','provider_unknown');
 else if(Date.parse(context.at)-Date.parse(e.snapshot.assessedAt)>freshness.ownedMaxAgeMs)block('INVENTORY_STALE','owned','stale');
 if(!Array.isArray(trustedEvidence)||new Set(trustedEvidence.map(x=>x?.id)).size!==trustedEvidence.length){block('PROVENANCE_UNVERIFIED','owned','incomplete');return finish();}
 function provenance(assertion,payload,category,origin){
  if(!Array.isArray(assertion.evidenceRefs)||!assertion.evidenceRefs.length)return false;
  return assertion.evidenceRefs.every(id=>{
   const ev=trustedEvidence.find(x=>x?.id===id);
   return ev&&ev.verified===true&&ev.origin===origin&&ev.category===category&&text(ev.schemaVersion)&&text(ev.source)&&
    equal(ev.scope,e.scope)&&stamp(ev.observedAt)&&Date.parse(ev.observedAt)<=Date.parse(e.snapshot.assessedAt)&&stamp(ev.cutoff)&&Date.parse(ev.observedAt)>=Date.parse(ev.cutoff)&&hash(ev.payloadDigest)&&ev.payloadDigest===inventoryDigest(payload)&&
    equal(ev.coverageBasis,assertion.coverageBasis)&&ev.cutoff===assertion.cutoff&&
    (origin==='owned'?ev.revision===e.snapshot.revision:ev.authentication==='authenticated'&&equal(ev.paymentRef,e.paymentRef));
  });
 }
 if(!object(e.ownedFacts)||!object(e.coverage?.owned)){block('OWNED_HISTORY_INCOMPLETE','owned','incomplete');return finish();}
 for(const category of ownedInventoryCategories){
  const assertion=e.coverage.owned[category],payload=e.ownedFacts[category];
  if(!object(assertion)||payload===undefined){block('OWNED_HISTORY_INCOMPLETE','owned','incomplete');continue;}
  if(assertion.state==='conflicted'){block('INVENTORY_CONFLICTED','owned','conflicted');continue;}
  if(assertion.state==='stale'){block('INVENTORY_STALE','owned','stale');continue;}
  if(assertion.state!=='complete'||!basis(assertion.coverageBasis)||assertion.cutoff!==e.snapshot.evidenceCutoff){block('OWNED_HISTORY_INCOMPLETE','owned','incomplete');continue;}
  if(!provenance(assertion,payload,category,'owned'))block('PROVENANCE_UNVERIFIED','owned','incomplete');
 }
 const pc=e.coverage.provider;
 if(!object(pc)||pc.state==='provider_unknown')block('PROVIDER_ACTIVITY_UNKNOWN','provider','provider_unknown');
 else if(pc.state==='conflicted')block('INVENTORY_CONFLICTED','provider','conflicted');
 else if(pc.state==='stale')block('INVENTORY_STALE','provider','stale');
 else if(pc.state!=='complete_as_of')block('PROVIDER_COVERAGE_INCOMPLETE','provider','incomplete');
 else {
  // Mandatory: explicit cutoff and evidence-backed basis, even for empty lists.
  if(!stamp(pc.cutoff)||!basis(pc.coverageBasis)||Date.parse(pc.cutoff)>Date.parse(e.snapshot.evidenceCutoff))block('PROVIDER_COVERAGE_INCOMPLETE','provider','incomplete');
  if(!object(e.providerFacts)||!validRef(e.paymentRef)||!provenance(pc,e.providerFacts,'provider_activity','provider'))block('PROVENANCE_UNVERIFIED','provider','incomplete');
  if(freshness&&Number.isSafeInteger(freshness.providerMaxAgeMs)&&stamp(pc.cutoff)&&Date.parse(context.at)-Date.parse(pc.cutoff)>freshness.providerMaxAgeMs)block('INVENTORY_STALE','provider','stale');
 }
 const f=e.ownedFacts,p=e.providerFacts;
 const arrays=['refunds','issuance','consumption','restoration','reservations','recovery','audit'];
 if(arrays.some(k=>!Array.isArray(f[k]))||!object(f.purchase)||!object(f.confirmation)||!object(f.clocks)||!equal(f.ownership,e.scope)){
  block('OWNED_HISTORY_INCOMPLETE','owned','incomplete');return finish();
 }
 if(!Number.isSafeInteger(f.purchase.amountMinor)||f.purchase.amountMinor<=0||!text(f.purchase.currency)||!hash(f.purchase.frozenTermsDigest)||f.purchase.frozenTermsDigest!==e.frozenTermsRef?.digest||!text(e.frozenTermsRef?.id)||!validRef(e.paymentRef)||!equal(f.confirmation.paymentRef,e.paymentRef)||f.confirmation.status!=='confirmed'||!stamp(f.confirmation.confirmedAt)||f.clocks.refundWindowStartsAt!==f.confirmation.confirmedAt)
  block('PAYMENT_REFERENCE_UNRESOLVED','owned','conflicted');
 for(const category of arrays){
  const records=f[category];
  if(records.some(r=>!object(r)||!text(r.id)||!equal(r.scope,e.scope))||new Set(records.map(r=>r?.id)).size!==records.length){block('INVENTORY_SCOPE_OR_RECORD_CONFLICT','owned','conflicted');return finish();}
 }
 if(!stamp(f.clocks.refundWindowEndsAt)||Date.parse(f.clocks.refundWindowEndsAt)<=Date.parse(f.clocks.refundWindowStartsAt))block('CLOCK_STATE_INCONSISTENT','owned','conflicted');
 if(Date.parse(context.at)===Date.parse(f.clocks.refundWindowEndsAt))reasons.add('REFUND_CUTOFF_POLICY_UNRESOLVED');
 if(f.restoration.length)reasons.add('RESTORED_USAGE_POLICY_UNRESOLVED');
 if(f.recovery.length===0||f.audit.length===0)block('OWNED_HISTORY_INCOMPLETE','owned','incomplete');
 if(f.recovery.some(r=>r.state!=='acknowledged'))block('RECOVERY_ACKNOWLEDGMENT_PENDING','owned','incomplete');
 if(f.refunds.some(r=>!['completed','failed','cancelled'].includes(r.status)))block('PRIOR_REFUND_OUTCOME_UNRESOLVED','owned','incomplete');
 if(f.issuance.some(r=>!Number.isSafeInteger(r.quantity)||r.quantity<=0)||['consumption','restoration','reservations'].some(k=>f[k].some(r=>!f.issuance.some(i=>i.id===r.issuanceId))))block('INVENTORY_CONFLICTED','owned','conflicted');
 if(object(p)){
  if(!object(p.payment)||!equal(p.payment.reference,e.paymentRef)||p.payment.amountMinor!==f.purchase.amountMinor||p.payment.currency!==f.purchase.currency||p.payment.status!=='confirmed'||!Array.isArray(p.refunds)||!Array.isArray(p.adjustments))block('INVENTORY_CONFLICTED','provider','conflicted');
  else {
   if(new Set(p.refunds.map(r=>r?.id)).size!==p.refunds.length)block('INVENTORY_CONFLICTED','provider','conflicted');
   // Neither unmatched provider activity nor owned external outcomes disappear.
   for(const r of p.refunds){if(!object(r)||!text(r.id)||!equal(r.scope,e.scope)||!Number.isSafeInteger(r.amountMinor)||r.amountMinor<=0||r.amountMinor>f.purchase.amountMinor||r.currency!==f.purchase.currency||!f.refunds.some(o=>o.providerRecordId===r.id&&o.status===r.status&&o.amountMinor===r.amountMinor&&o.currency===r.currency))block('INVENTORY_CONFLICTED','provider','conflicted');}
   for(const r of f.refunds){if(r.status==='completed'&&!p.refunds.some(v=>v.id===r.providerRecordId&&v.status===r.status&&v.amountMinor===r.amountMinor&&v.currency===r.currency))block('PRIOR_REFUND_OUTCOME_UNRESOLVED','provider','provider_unknown');}
   if(p.adjustments.length)block('PROVIDER_ADJUSTMENT_UNRESOLVED','provider','provider_unknown');
  }
 }
 if(!Array.isArray(e.policyBoundaries))block('POLICY_BOUNDARIES_UNRESOLVED','owned','incomplete');
 else for(const code of e.policyBoundaries){if(['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED'].includes(code))reasons.add(code);else block('POLICY_BOUNDARIES_UNRESOLVED','owned','incomplete');}
 return finish();
}
