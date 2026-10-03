import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assemblyFixture,attestAssembly} from './helpers/refund-assembly-fixtures.mjs';
import {createRefundInventoryAssembler,assembleRefundAssessment} from '../src/refund-inventory-assembler.mjs';
import {assessRefundEligibility} from '../src/refund-eligibility.mjs';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const cases=[
 ['usable eligible',()=>{},'eligible',true],
 ['missing owned evidence',x=>x.attestations.evidence=x.attestations.evidence.filter(e=>e.category!=='refunds'),'blocked',false],
 ['missing provider evidence',x=>delete x.providerEvidence,'blocked',false],
 ['stale evidence',x=>x.context.revision='128','blocked',false],
 ['expired evidence freshness',x=>x.context.at='2026-10-04T00:00:00Z','blocked',false],
 ['conflicted evidence',x=>x.attestations.coverage.provider.state='conflicted','blocked',false],
 ['incomplete provenance',x=>x.attestations.evidence.at(-1).verified=false,'blocked',false],
 ['cross business denial',x=>x.authority.businessId='foreign','denied',false],
 ['cross tenant denial',x=>x.authority.tenantId='foreign','denied',false],
 ['provider unknown',x=>x.attestations.coverage.provider.state='provider_unknown','blocked',false],
 ['missing freshness policy',x=>delete x.context.freshnessPolicy,'blocked',false],
 ['missing coverage',x=>delete x.attestations.coverage.owned.refunds,'blocked',false],
 ['missing cutoff',x=>delete x.attestations.coverage.provider.cutoff,'blocked',false],
 ['missing basis',x=>delete x.attestations.coverage.provider.coverageBasis,'blocked',false],
 ['unverified snapshot',x=>x.attestations.snapshot.verified=false,'blocked',false],
 ['tampered eligibility state',x=>x.ownedSnapshot.state.purchaseDrafts[0].totalMinor++,'blocked',false],
 ['conflicting projection',x=>{x.ownedSnapshot.facts.purchase.amountMinor++;x.providerEvidence.facts.payment.amountMinor++;attestAssembly(x);},'blocked',false],
 ['usable consumed ineligible',x=>{const s=x.ownedSnapshot.state;s.creditUnits[0].status='spent';const event={...s.creditEvents[0],id:'consumption-test',type:'consume'};s.creditEvents.push(event);x.ownedSnapshot.facts.consumption=[{id:event.id,scope:x.context.scope,issuanceId:s.entitlementIssuances[0].id}];attestAssembly(x);},'ineligible',true],
 ['omitted usage projection',x=>{const s=x.ownedSnapshot.state;s.creditEvents.push({...s.creditEvents[0],id:'omitted-consumption',type:'consume'});attestAssembly(x);},'blocked',false],
 ['restored policy',x=>x.attestations.policyBoundaries=['RESTORED_USAGE_POLICY_UNRESOLVED'],'blocked',false],
 ['cutoff policy',x=>x.attestations.policyBoundaries=['REFUND_CUTOFF_POLICY_UNRESOLVED'],'blocked',false],
 ['missing policy declarations',x=>delete x.attestations.policyBoundaries,'blocked',false],
];
for(const business of ['original','second'])for(const processor of ['processor-alpha','processor-beta'])for(const [name,change,status,called] of cases)test(`assembler ${business}/${processor}: ${name}`,()=>{
 const x=assemblyFixture(business,processor);change(x);const before=structuredClone(x);freeze(x);let calls=0;
 const assemble=createRefundInventoryAssembler(args=>{calls++;return assessRefundEligibility(args);});
 const r=assemble(x);assert.equal(r.status,status,JSON.stringify(r.reasonCodes));assert.equal(calls,called?1:0);assert.equal(r.executionAuthorized,false);assert.deepEqual(x,before);
 if(called)assert.equal(r.inventory.status,'usable');else assert.equal(r.eligibility,undefined);
 if(status==='denied'){assert.equal(r.envelope,undefined);assert.equal(r.inventory,undefined);}
 const repeated=assembleRefundAssessment(x);assert.deepEqual(repeated,r);if(r.envelope)assert.deepEqual(repeated.envelope,r.envelope);
});
test('assembler has no business/processor branches or completeness defaults',()=>{const source=readFileSync(new URL('../src/refund-inventory-assembler.mjs',import.meta.url),'utf8');for(const literal of ['vega','USD','6000','processor-alpha','processor-beta','complete_as_of','ownedMaxAgeMs','providerMaxAgeMs','Date.now','fetch('])assert.ok(!source.includes(literal),literal);});
