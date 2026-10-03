import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyFixture} from './helpers/refund-assembly-fixtures.mjs';
import {assembleRefundAssessment} from '../src/refund-inventory-assembler.mjs';
import {composeRefundInventoryAssessment,createRefundInventoryComposition} from '../src/refund-inventory-composition.mjs';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const cases=[
 ['provider unknown',x=>x.attestations.coverage.provider.state='provider_unknown','missing_provider_activity'],
 ['complete evidence unresolved policy',x=>x.attestations.policyBoundaries=['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED'],null],
 ['incomplete owned',x=>x.attestations.coverage.owned.refunds.state='incomplete','coverage_incomplete'],
 ['stale provider',x=>x.attestations.coverage.provider.state='stale','stale'],
 ['conflict',x=>x.attestations.coverage.provider.state='conflicted','conflicting'],
 ['complete',()=>{},null]
];
for(const business of ['original','second'])for(const processor of ['processor-alpha','processor-beta'])for(const [name,change,kind] of cases)test(`${business}/${processor}: ${name}`,()=>{
 const x=assemblyFixture(business,processor);change(x);const before=structuredClone(x);freeze(x);
 const original=assembleRefundAssessment(x),r=composeRefundInventoryAssessment(x);
 assert.deepEqual(r.assessment,original);assert.equal(r.status,original.status);assert.equal(r.executionAuthorized,false);
 assert.deepEqual(r,composeRefundInventoryAssessment(x));assert.deepEqual(x,before);
 if(kind)assert.ok(r.gapReport.evidenceGaps.some(g=>g.kind===kind));
 else assert.deepEqual(r.gapReport.evidenceGaps,[]);
 if(name==='complete evidence unresolved policy'){assert.deepEqual(r.gapReport.policyBlocks,x.attestations.policyBoundaries);assert.equal(r.status,'blocked');assert.equal(r.gapReport.evidenceUsable,true);}
});
for(const mode of ['member','missing','cross-business','cross-tenant'])test(`composition disclosure denial: ${mode}`,()=>{
 const x=assemblyFixture('original','processor-alpha');
 if(mode==='member')x.authority.role='member';
 if(mode==='missing')x.context.scope.purchaseId='absent';
 if(mode==='cross-business')x.authority.businessId='foreign';
 if(mode==='cross-tenant')x.authority.tenantId='foreign';
 const r=composeRefundInventoryAssessment(x);
 assert.deepEqual(r,{status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],staffApprovalRequired:true,executionAuthorized:false});
});
test('loader seam denies before evidence acquisition',async()=>{
 const source={environment:'development',withSnapshot:async(options,fn)=>{assert.deepEqual(options,{isolation:'repeatable read',readOnly:true});return fn({resolveAuthority:async()=>null,readOwnedState:()=>assert.fail('unauthorized read')});}};
 const r=await createRefundInventoryComposition({source})({authenticatedPrincipal:'untrusted'});
 assert.equal(r.status,'denied');assert.equal(r.gapReport,undefined);assert.equal(r.assemblerInput,undefined);
});
for(const business of ['original','second'])for(const processor of ['processor-alpha','processor-beta'])test(`loader to composition ${business}/${processor}`,async()=>{
 const f=assemblyFixture(business,processor),s=f.ownedSnapshot;
 const row={tenantId:s.scope.tenantId,businessId:s.scope.businessId,state:s.state,revision:'127',source:'fixture',schemaVersion:'1',observedAt:f.context.at};
 const support={recovery:s.facts.recovery,audit:s.facts.audit,evidenceCutoff:s.evidenceCutoff,coverage:f.attestations.coverage.owned,policyBoundaries:[],evidence:f.attestations.evidence.filter(e=>e.origin==='owned')};
 const before=structuredClone({row,support});freeze(row);freeze(support);
 const source={environment:'development',withSnapshot:async(options,fn)=>fn({resolveAuthority:async()=>f.authority,readOwnedState:async()=>row,readOwnedEvidence:async()=>support})};
 const load=createRefundInventoryComposition({source});
 const args={authenticatedPrincipal:'fixture',purchaseId:s.scope.purchaseId,expectedAttemptId:s.scope.attemptId,expectedCheckpoint:{revision:'127'},assessmentContext:{at:f.context.at,freshnessPolicy:f.context.freshnessPolicy}};
 const r=await load(args);assert.equal(r.status,'blocked');assert.ok(r.assessment.gapReport.evidenceGaps.some(g=>g.kind==='missing_provider_activity'));assert.deepEqual(r.assessment.assessment,assembleRefundAssessment(r.assemblerInput));assert.deepEqual(await load(args),r);assert.deepEqual({row,support},before);
 const denied=await load({...args,purchaseId:'missing'});assert.equal(denied.status,'denied');assert.equal(denied.assessment,undefined);assert.equal(denied.assemblerInput,undefined);
});
