import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryDigest,ownedInventoryCategories} from '../src/refund-inventory.mjs';
import {reportRefundEvidenceGaps} from '../src/refund-evidence-gaps.mjs';
function fixture(business,processor){
 const scope={tenantId:`tenant-${business}`,businessId:business,purchaseId:`purchase-${business}`,attemptId:`attempt-${business}`};
 const at='2026-10-03T00:00:00Z',ref={provider:processor,integrationId:`integration-${processor}`,integrationVersion:1,environment:'test',resourceId:'payment-1'};
 const record=(id,fields={})=>({id,scope:{...scope},...fields});
 const amount=business==='dance'?6000:13750,currency=business==='dance'?'USD':'EUR';
 const e={contractVersion:1,scope,snapshot:{revision:'127',stateDigest:'a'.repeat(64),assessedAt:at,evidenceCutoff:at},frozenTermsRef:{id:'terms-v1',digest:'b'.repeat(64)},paymentRef:ref,
 ownedFacts:{purchase:{amountMinor:amount,currency,frozenTermsDigest:'b'.repeat(64)},confirmation:{status:'confirmed',paymentRef:ref,confirmedAt:'2026-10-02T00:00:00Z'},refunds:[],issuance:[record('grant-1',{quantity:business==='dance'?3:7})],consumption:[],restoration:[],reservations:[],clocks:{refundWindowStartsAt:'2026-10-02T00:00:00Z',refundWindowEndsAt:business==='dance'?'2026-11-01T00:00:00Z':'2026-10-16T00:00:00Z'},ownership:{...scope},recovery:[record('receipt-1',{state:'acknowledged'})],audit:[record('audit-1')]},providerFacts:{payment:{reference:ref,amountMinor:amount,currency,status:'confirmed'},refunds:[],adjustments:[]},coverage:{owned:{},provider:{}},policyBoundaries:[]};
 const basis={source:'authoritative-history',method:'exhaustive-payment-scoped-snapshot',exhaustive:true,paginationComplete:true,exclusions:[]};
 for(const category of ownedInventoryCategories)e.coverage.owned[category]={state:'complete',cutoff:at,coverageBasis:{...basis},evidenceRefs:[category]};
 e.coverage.provider={state:'complete_as_of',cutoff:at,coverageBasis:{...basis},evidenceRefs:['provider_activity']};
 const x={envelope:e,authority:{role:'staff',tenantId:scope.tenantId,businessId:scope.businessId},context:{scope:{...scope},revision:'127',stateDigest:'a'.repeat(64),at,freshnessPolicy:{id:'synthetic-test-policy',approvalRef:'fixture-only-not-operational-approval',ownedMaxAgeMs:1000,providerMaxAgeMs:1000}},trustedEvidence:[]};
 attest(x);return x;
}
function attest(x){const e=x.envelope;x.trustedEvidence=ownedInventoryCategories.map(k=>({id:k,origin:'owned',category:k,verified:true,schemaVersion:'1',source:'owned-store',scope:{...e.scope},observedAt:e.snapshot.assessedAt,revision:e.snapshot.revision,payloadDigest:inventoryDigest(e.ownedFacts[k]),coverageBasis:structuredClone(e.coverage.owned[k].coverageBasis),cutoff:e.coverage.owned[k].cutoff}));x.trustedEvidence.push({id:'provider_activity',origin:'provider',category:'provider_activity',verified:true,authentication:'authenticated',schemaVersion:'1',source:'normalized-adapter',scope:{...e.scope},observedAt:e.snapshot.assessedAt,paymentRef:structuredClone(e.paymentRef),payloadDigest:inventoryDigest(e.providerFacts),coverageBasis:structuredClone(e.coverage.provider.coverageBasis),cutoff:e.coverage.provider.cutoff});}
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
const cases=[
 ['complete owned unknown provider',x=>x.envelope.coverage.provider.state='provider_unknown','missing_provider_activity'],
 ['complete provider incomplete owned',x=>x.envelope.coverage.owned.consumption.state='incomplete','coverage_incomplete'],
 ['stale provider',x=>{x.envelope.coverage.provider.cutoff='2026-10-02T00:00:00Z';attest(x)},'stale'],
 ['incomplete pagination',x=>{x.envelope.coverage.provider.coverageBasis.paginationComplete=false;attest(x)},'coverage_incomplete'],
 ['provider refund missing owned',x=>{x.envelope.providerFacts.refunds=[{id:'r',scope:x.envelope.scope,status:'completed',amountMinor:1,currency:x.envelope.ownedFacts.purchase.currency}];attest(x)},'missing_owned_history'],
 ['owned refund unavailable provider',x=>{x.envelope.ownedFacts.refunds=[{id:'o',scope:x.envelope.scope,status:'completed',providerRecordId:'r',amountMinor:1,currency:x.envelope.ownedFacts.purchase.currency}];attest(x);delete x.envelope.providerFacts},'missing_provider_activity'],
 ['conflicting outcomes',x=>{const r={id:'r',scope:x.envelope.scope,status:'completed',amountMinor:1,currency:x.envelope.ownedFacts.purchase.currency};x.envelope.providerFacts.refunds=[r];x.envelope.ownedFacts.refunds=[{...r,id:'o',providerRecordId:'r',status:'failed'}];attest(x)},'conflicting'],
 ['provider unavailable',x=>{delete x.envelope.providerFacts;x.envelope.coverage.provider={state:'provider_unknown'}},'missing_provider_activity'],
 ['missing recovery acknowledgment',x=>{x.envelope.ownedFacts.recovery[0].state='pending';attest(x)},'recovery_unacknowledged'],
 ['complete evidence unresolved policy',x=>x.envelope.policyBoundaries=['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED'],null],
 ['empty list without assertion',x=>delete x.envelope.coverage.owned.refunds,'coverage_unasserted'],
 ['empty list without provenance',x=>x.envelope.coverage.owned.refunds.evidenceRefs=[],'provenance_unverified'],
 ['missing audit',x=>{x.envelope.ownedFacts.audit=[];attest(x)},'audit_incomplete'],
 ['unauthenticated provider',x=>x.trustedEvidence.at(-1).authentication='unverified','provenance_unverified'],
 ['altered payload',x=>x.envelope.ownedFacts.purchase.amountMinor++,'provenance_unverified'],
 ['missing currentness',x=>delete x.context.freshnessPolicy,'coverage_unasserted'],
 ['clean',()=>{},null]
];
for(const business of ['dance','ceramics'])for(const processor of ['processor-alpha','processor-beta'])for(const [name,change,kind] of cases)test(business+'/'+processor+': '+name,()=>{
 const x=fixture(business,processor);change(x);const before=structuredClone(x);freeze(x);const r=reportRefundEvidenceGaps(x);
 assert.equal(r.executionAuthorized,false);assert.deepEqual(x,before);assert.deepEqual(r,reportRefundEvidenceGaps(x));
 if(kind){assert.ok(r.evidenceGaps.some(g=>g.kind===kind),JSON.stringify(r));assert.equal(r.evidenceUsable,false)}else{assert.equal(r.evidenceUsable,true);assert.equal(r.evidenceGaps.length,0)}
 if(name==='complete evidence unresolved policy'){assert.deepEqual(r.policyBlocks,x.envelope.policyBoundaries);assert.equal(r.status,'blocked')}
 for(const g of r.evidenceGaps){assert.deepEqual(g.scope,x.context.scope);assert.ok(['owned','provider'].includes(g.origin));for(const k of ['category','observedEvidenceRefs','requiredSource','requiredProvenance','requiredCurrentness','requiredCompleteness','observedDeficiency','resolutionPredicate'])assert.ok(g[k]!==undefined,k);assert.deepEqual(g.blocks,{affirmativeEligibility:true,execution:true});assert.ok(!JSON.stringify(g).includes('REFUND_CUTOFF_POLICY_UNRESOLVED'));assert.ok(!JSON.stringify(g).includes('RESTORED_USAGE_POLICY_UNRESOLVED'))}
});
test('access denial discloses no evidence',()=>{const x=fixture('dance','processor-alpha');x.authority.businessId='other';assert.deepEqual(reportRefundEvidenceGaps(x),{status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],executionAuthorized:false})});
test('malformed input fails closed',()=>{const x=fixture('dance','processor-alpha');x.envelope=null;assert.equal(reportRefundEvidenceGaps(x).evidenceUsable,false)});
