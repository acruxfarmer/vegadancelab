import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRefundInventory,inventoryDigest,ownedInventoryCategories} from '../src/refund-inventory.mjs';

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
 ['clean',()=>{},'usable'],
 ['missing owned history',x=>delete x.envelope.coverage.owned.refunds,'blocked','OWNED_HISTORY_INCOMPLETE'],
 ['empty list lacks evidence',x=>x.envelope.coverage.owned.refunds.evidenceRefs=[],'blocked','PROVENANCE_UNVERIFIED'],
 ['consumed but fully evidenced',x=>{x.envelope.ownedFacts.consumption.push({id:'use1',scope:x.envelope.scope,issuanceId:'grant-1'});attest(x);},'usable'],
 ['restored ambiguity',x=>{x.envelope.ownedFacts.restoration.push({id:'restore1',scope:x.envelope.scope,issuanceId:'grant-1'});attest(x);},'blocked','RESTORED_USAGE_POLICY_UNRESOLVED'],
 ['provider refund missing owned record',x=>{x.envelope.providerFacts.refunds.push({id:'refund-1',scope:x.envelope.scope,status:'completed',amountMinor:1,currency:'USD'});attest(x);},'blocked','INVENTORY_CONFLICTED'],
 ['owned refund missing provider evidence',x=>{x.envelope.ownedFacts.refunds.push({id:'refund1',scope:x.envelope.scope,providerRecordId:'p-refund1',status:'completed',amountMinor:1,currency:'USD'});attest(x);},'blocked','PRIOR_REFUND_OUTCOME_UNRESOLVED'],
 ['stale snapshot',x=>x.context.revision='128','blocked','INVENTORY_STALE'],
 ['cross business access',x=>x.authority.businessId='foreign','denied','OWNERSHIP_SCOPE_DENIED'],
 ['cross business contamination',x=>{x.envelope.ownedFacts.issuance[0].scope={...x.envelope.scope,businessId:'foreign'};attest(x);},'blocked','INVENTORY_SCOPE_OR_RECORD_CONFLICT'],
 ['payment conflict',x=>{x.envelope.providerFacts.payment.amountMinor++;attest(x);},'blocked','INVENTORY_CONFLICTED'],
 ['provider unavailable',x=>x.envelope.coverage.provider.state='provider_unknown','blocked','PROVIDER_ACTIVITY_UNKNOWN'],
 ['missing cutoff',x=>delete x.envelope.coverage.provider.cutoff,'blocked','PROVIDER_COVERAGE_INCOMPLETE'],
 ['missing coverage basis',x=>delete x.envelope.coverage.provider.coverageBasis,'blocked','PROVIDER_COVERAGE_INCOMPLETE'],
 ['partial pagination',x=>x.envelope.coverage.provider.coverageBasis.paginationComplete=false,'blocked','PROVIDER_COVERAGE_INCOMPLETE'],
 ['untrusted provider evidence',x=>x.trustedEvidence.at(-1).verified=false,'blocked','PROVENANCE_UNVERIFIED'],
 ['unauthenticated provider evidence',x=>x.trustedEvidence.at(-1).authentication='unverified','blocked','PROVENANCE_UNVERIFIED'],
 ['no approved freshness policy',x=>delete x.context.freshnessPolicy,'blocked','CURRENTNESS_POLICY_UNRESOLVED'],
 ['provider observation stale',x=>{x.envelope.coverage.provider.cutoff='2026-10-02T00:00:00Z';attest(x);},'blocked','INVENTORY_STALE'],
 ['pending recovery',x=>{x.envelope.ownedFacts.recovery[0].state='pending';attest(x);},'blocked','RECOVERY_ACKNOWLEDGMENT_PENDING'],
 ['explicit cutoff boundary',x=>x.envelope.policyBoundaries=['REFUND_CUTOFF_POLICY_UNRESOLVED'],'blocked','REFUND_CUTOFF_POLICY_UNRESOLVED'],
 ['altered owned facts',x=>x.envelope.ownedFacts.purchase.amountMinor++,'blocked','PROVENANCE_UNVERIFIED'],
 ['unresolved provider adjustment',x=>{x.envelope.providerFacts.adjustments=[{id:'adjustment1'}];attest(x);},'blocked','PROVIDER_ADJUSTMENT_UNRESOLVED'],
 ['malformed owned record',x=>{x.envelope.ownedFacts.refunds=[null];attest(x);},'blocked','INVENTORY_SCOPE_OR_RECORD_CONFLICT'],
 ['future cutoff',x=>{x.envelope.coverage.provider.cutoff='2026-10-04T00:00:00Z';attest(x);},'blocked','PROVIDER_COVERAGE_INCOMPLETE'],
 ['evidence predates cutoff',x=>x.trustedEvidence.at(-1).observedAt='2026-10-02T23:59:59Z','blocked','PROVENANCE_UNVERIFIED'],
 ['complete matched refund',x=>{const r={id:'provider-refund',scope:x.envelope.scope,status:'completed',amountMinor:x.envelope.ownedFacts.purchase.amountMinor,currency:x.envelope.ownedFacts.purchase.currency};x.envelope.providerFacts.refunds=[r];x.envelope.ownedFacts.refunds=[{...r,id:'owned-refund',providerRecordId:r.id}];attest(x);},'usable'],
 ['derived cutoff boundary',x=>{x.envelope.ownedFacts.clocks.refundWindowEndsAt=x.context.at;attest(x);},'blocked','REFUND_CUTOFF_POLICY_UNRESOLVED'],
];
for(const business of ['dance','ceramics'])for(const processor of ['processor-alpha','processor-beta'])for(const [name,change,status,reason] of cases)test(`inventory ${business}/${processor}: ${name}`,()=>{const x=fixture(business,processor);change(x);const before=structuredClone(x);freeze(x);const r=validateRefundInventory(x);assert.equal(r.status,status);if(reason)assert.ok(r.reasonCodes.includes(reason),JSON.stringify(r));assert.equal(r.eligibilityUsable,status==='usable');assert.equal(r.executionAuthorized,false);assert.deepEqual(x,before);if(status==='denied')assert.equal(r.coverage,undefined);});
