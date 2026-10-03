import {isDeepStrictEqual as equal} from 'node:util';
import {inventoryDigest, ownedInventoryCategories, validateRefundInventory} from './refund-inventory.mjs';

export const evidenceGapKinds=Object.freeze(['missing_owned_history','missing_provider_activity','coverage_unasserted','coverage_incomplete','stale','conflicting','provenance_unverified','recovery_unacknowledged','audit_incomplete']);
const policies=['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED'];
const text=x=>typeof x==='string'&&x.trim().length>0;
const stamp=x=>text(x)&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
const sources={purchase:'owned purchase and frozen-terms registry',confirmation:'owned authenticated payment confirmation',refunds:'owned refund-operation ledger',issuance:'owned entitlement ledger',consumption:'owned usage ledger',restoration:'owned restoration ledger',reservations:'owned reservation history',clocks:'owned confirmed-payment clock records',ownership:'owned authenticated ownership records',recovery:'owned recovery obligations and authoritative acknowledgments',audit:'owned authoritative command/event audit',provider_activity:'authenticated normalized provider payment/refund/adjustment history',inventory:'owned scoped snapshot and trusted evidence registry'};

// Pure server-side diagnostic companion. Trusted assertions must never originate
// from caller-supplied HTTP data. This module acquires nothing and authorizes nothing.
export function reportRefundEvidenceGaps(input={}){
 const {authority:a,context:c,envelope:e,trustedEvidence:t}=input;
 if(!c?.scope||!['tenantId','businessId','purchaseId','attemptId'].every(k=>text(c.scope[k]))||a?.role!=='staff'||a.tenantId!==c.scope.tenantId||a.businessId!==c.scope.businessId)
  return {status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],executionAuthorized:false};
 const gaps=[];const scope=structuredClone(c.scope),f=e?.ownedFacts??{},p=e?.providerFacts,fp=c.freshnessPolicy;
 const add=(category,kind,origin,deficiency,refs=[])=>{
  const assertion=origin==='provider'?e?.coverage?.provider:e?.coverage?.owned?.[category];
  if(gaps.some(g=>g.category===category&&g.kind===kind&&g.observedDeficiency===deficiency))return;
  gaps.push({category,kind,origin,scope:structuredClone(scope),affectedRecordRefs:refs.filter(text),observedEvidenceRefs:Array.isArray(assertion?.evidenceRefs)?assertion.evidenceRefs.filter(text):[],
   requiredSource:{authorityClass:sources[category]??sources.inventory},
   requiredProvenance:{verified:true,exactScope:true,sourceAndSchemaVersion:true,payloadDigestBinding:true,observationAndCutoff:true,revisionBinding:origin==='owned',authenticatedPaymentIntegrationBinding:origin==='provider'},
   requiredCurrentness:{freshnessPolicyRef:fp?{id:fp.id??null,approvalRef:fp.approvalRef??null}:null,maxAgeMs:origin==='owned'?fp?.ownedMaxAgeMs??null:fp?.providerMaxAgeMs??null,rule:origin==='owned'?'Match assessment revision/digest and approved snapshot age; coherent cutoff and observation times.':'Approved age measured from proven coverage cutoff; coherent observations and stable acquisition, not retrieval time alone.'},
   requiredCompleteness:{state:origin==='owned'?'complete':'complete_as_of',exhaustive:true,paginationComplete:true,exclusions:[],rule:'Evidence-backed history boundary and applicable activity coverage; no omitted records, retention gaps or unsupported activity; empty lists alone prove nothing.'},
   observedDeficiency:deficiency,resolutionPredicate:`Resolve ${deficiency}; supply scoped authoritative evidence and matching verified provenance/currentness/completeness assertions, then revalidate.`,blocks:{affirmativeEligibility:true,execution:true}});
 };
 const registry=Array.isArray(t)&&new Set(t.map(v=>v?.id)).size===t.length;
 const freshness=fp&&text(fp.id)&&text(fp.approvalRef)&&['ownedMaxAgeMs','providerMaxAgeMs'].every(k=>Number.isSafeInteger(fp[k])&&fp[k]>=0);
 if(!equal(e?.scope,scope))add('inventory','conflicting','owned','inventory_scope_mismatch');
 if(!registry)add('inventory','provenance_unverified','owned','trusted_registry_missing_or_ambiguous');
 if(!freshness)add('inventory','coverage_unasserted','owned','approved_currentness_rule_missing');
 if(e?.snapshot?.revision!==c.revision||e?.snapshot?.stateDigest!==c.stateDigest)add('inventory','stale','owned','snapshot_revision_or_digest_mismatch');
 if(!stamp(c.at)||!stamp(e?.snapshot?.assessedAt)||!stamp(e?.snapshot?.evidenceCutoff)||Date.parse(e.snapshot.evidenceCutoff)>Date.parse(e.snapshot.assessedAt)||Date.parse(e.snapshot.assessedAt)>Date.parse(c.at))add('inventory','coverage_incomplete','owned','invalid_snapshot_timeline');
 else if(freshness&&Date.parse(c.at)-Date.parse(e.snapshot.assessedAt)>fp.ownedMaxAgeMs)add('inventory','stale','owned','owned_snapshot_age_exceeded');
 function check(category,origin,payload,assertion){
  if(payload===undefined)add(category,origin==='owned'?'missing_owned_history':'missing_provider_activity',origin,'required_facts_absent');
  if(!assertion)add(category,'coverage_unasserted',origin,'coverage_assertion_absent');
  else {
   if(assertion.state==='provider_unknown')add(category,'missing_provider_activity',origin,'provider_unknown');
   else if(assertion.state==='stale')add(category,'stale',origin,'source_declared_stale');
   else if(assertion.state==='conflicted')add(category,'conflicting',origin,'source_declared_conflict');
   else if(assertion.state!==(origin==='owned'?'complete':'complete_as_of'))add(category,'coverage_incomplete',origin,'complete_coverage_not_established');
   const b=assertion.coverageBasis;
   if(!b)add(category,'coverage_unasserted',origin,'coverage_basis_absent');
   else if(!text(b.source)||!text(b.method)||b.exhaustive!==true||b.paginationComplete!==true||!Array.isArray(b.exclusions)||b.exclusions.length)add(category,'coverage_incomplete',origin,'exhaustiveness_pagination_or_exclusions_unresolved');
   if(!stamp(assertion.cutoff)||(origin==='owned'?assertion.cutoff!==e?.snapshot?.evidenceCutoff:Date.parse(assertion.cutoff)>Date.parse(e?.snapshot?.evidenceCutoff)))add(category,'coverage_incomplete',origin,'coverage_cutoff_invalid_or_unaligned');
   if(origin==='provider'&&freshness&&stamp(c.at)&&stamp(assertion.cutoff)&&Date.parse(c.at)-Date.parse(assertion.cutoff)>fp.providerMaxAgeMs)add(category,'stale',origin,'provider_cutoff_age_exceeded');
  }
  const refs=assertion?.evidenceRefs;
  const verified=registry&&payload!==undefined&&Array.isArray(refs)&&refs.length>0&&refs.every(id=>{
   const v=t.find(v=>v?.id===id);
   return v?.verified===true&&v.origin===origin&&v.category===category&&text(v.source)&&text(v.schemaVersion)&&equal(v.scope,scope)&&stamp(v.observedAt)&&stamp(v.cutoff)&&Date.parse(v.cutoff)<=Date.parse(v.observedAt)&&Date.parse(v.observedAt)<=Date.parse(e?.snapshot?.assessedAt)&&v.cutoff===assertion.cutoff&&equal(v.coverageBasis,assertion.coverageBasis)&&v.payloadDigest===inventoryDigest(payload)&&(origin==='owned'?v.revision===e?.snapshot?.revision:v.authentication==='authenticated'&&equal(v.paymentRef,e?.paymentRef));
  });
  if(!verified)add(category,'provenance_unverified',origin,'verified_payload_bound_provenance_missing');
 }
 for(const category of ownedInventoryCategories)check(category,'owned',f[category],e?.coverage?.owned?.[category]);
 check('provider_activity','provider',p,e?.coverage?.provider);
 if(!Array.isArray(f.audit)||!f.audit.length)add('audit','audit_incomplete','owned','authoritative_audit_absent');
 if(!Array.isArray(f.recovery)||!f.recovery.length)add('recovery','missing_owned_history','owned','recovery_obligations_unaccounted');
 for(const r of Array.isArray(f.recovery)?f.recovery:[])if(r?.state!=='acknowledged')add('recovery','recovery_unacknowledged','owned','recovery_acknowledgment_missing',[r?.id]);
 const refunds=Array.isArray(f.refunds)?f.refunds:[],external=Array.isArray(p?.refunds)?p.refunds:[];
 for(const r of external){const match=refunds.find(o=>o?.providerRecordId===r?.id);if(!match){add('refunds','missing_owned_history','owned','provider_refund_has_no_owned_record',[r?.id]);add('provider_activity','conflicting','provider','provider_refund_unmatched',[r?.id]);}else if(['status','amountMinor','currency'].some(k=>match[k]!==r[k]))add('provider_activity','conflicting','provider','owned_provider_refund_outcomes_conflict',[r?.id,match.id]);}
 for(const r of refunds){
  if(!['completed','failed','cancelled'].includes(r?.status))add('refunds','coverage_incomplete','owned','prior_refund_outcome_unresolved',[r?.id]);
  if(r?.status==='completed'&&!external.some(v=>v?.id===r.providerRecordId))add('provider_activity','missing_provider_activity','provider','owned_completed_refund_lacks_provider_outcome',[r.id]);
 }
 if(Array.isArray(p?.adjustments)&&p.adjustments.length)add('provider_activity','coverage_incomplete','provider','provider_adjustment_semantics_unresolved');
 // The closed validator remains the authority for structural/correlation checks.
 // Preserve its fail-closed result without turning policy reasons into evidence gaps.
 let validation;
 try{validation=validateRefundInventory(input);}catch{validation={reasonCodes:['INVENTORY_SCHEMA_INVALID']};}
 const policyBlocks=[...new Set([...(Array.isArray(e?.policyBoundaries)?e.policyBoundaries.filter(v=>policies.includes(v)):[]),...(validation.reasonCodes??[]).filter(v=>policies.includes(v))])];
 const mapping={INVENTORY_SCOPE_CONFLICT:['inventory','conflicting','owned'],INVENTORY_SCHEMA_INVALID:['inventory','coverage_incomplete','owned'],INVENTORY_STALE:['inventory','stale','owned'],CURRENTNESS_POLICY_UNRESOLVED:['provider_activity','coverage_unasserted','provider'],PROVENANCE_UNVERIFIED:['inventory','provenance_unverified','owned'],OWNED_HISTORY_INCOMPLETE:['inventory','missing_owned_history','owned'],INVENTORY_CONFLICTED:['inventory','conflicting','owned'],PROVIDER_ACTIVITY_UNKNOWN:['provider_activity','missing_provider_activity','provider'],PROVIDER_COVERAGE_INCOMPLETE:['provider_activity','coverage_incomplete','provider'],INVENTORY_SCOPE_OR_RECORD_CONFLICT:['inventory','conflicting','owned'],PAYMENT_REFERENCE_UNRESOLVED:['confirmation','conflicting','owned'],CLOCK_STATE_INCONSISTENT:['clocks','conflicting','owned'],RECOVERY_ACKNOWLEDGMENT_PENDING:['recovery','recovery_unacknowledged','owned'],PRIOR_REFUND_OUTCOME_UNRESOLVED:['refunds','coverage_incomplete','owned'],PROVIDER_ADJUSTMENT_UNRESOLVED:['provider_activity','coverage_incomplete','provider'],POLICY_BOUNDARIES_UNRESOLVED:['inventory','coverage_unasserted','owned']};
 for(const code of validation.reasonCodes??[])if(!policies.includes(code)){
  const [category,kind,origin]=mapping[code]??['inventory','coverage_incomplete','owned'];
  if(!gaps.some(g=>g.kind===kind))add(category,kind,origin,code);
 }
 return {contractVersion:1,status:gaps.length||policyBlocks.length?'blocked':'evidence_usable',scope,assessment:{assessedAt:c.at??null,evidenceCutoff:e?.snapshot?.evidenceCutoff??null,revision:c.revision??null,canonicalStateSha256:c.stateDigest??null,frozenTermsSha256:e?.frozenTermsRef?.digest??null,projectedPayloadSha256:input.projectedPayloadSha256??null,historicalMd5:input.historicalMd5??null,freshnessPolicyRef:fp?{id:fp.id??null,approvalRef:fp.approvalRef??null}:null},evidenceGaps:gaps,policyBlocks,evidenceUsable:gaps.length===0,executionAuthorized:false};
}
