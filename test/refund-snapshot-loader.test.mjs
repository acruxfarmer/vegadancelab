import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOwnedRefundSnapshotLoader} from '../src/refund-snapshot-loader.mjs';
import {inventoryDigest} from '../src/refund-inventory.mjs';
import {assembleRefundAssessment} from '../src/refund-inventory-assembler.mjs';
import {assemblyFixture} from './helpers/refund-assembly-fixtures.mjs';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function fixture(business,processor){
 const f=assemblyFixture(business,processor),s=f.ownedSnapshot;
 const row={tenantId:s.scope.tenantId,businessId:s.scope.businessId,state:s.state,revision:'127',historicalMd5:'2697037513f331bcf116a37d2bd003bc',source:'synthetic-owned-store',schemaVersion:'1',observedAt:f.context.at};
 const support={recovery:s.facts.recovery,audit:s.facts.audit,evidenceCutoff:s.evidenceCutoff,coverage:f.attestations.coverage.owned,policyBoundaries:[],evidence:f.attestations.evidence.filter(e=>e.origin==='owned')};
 return {row,support,authority:f.authority,args:{authenticatedPrincipal:'fixture-user',purchaseId:s.scope.purchaseId,expectedAttemptId:s.scope.attemptId,expectedCheckpoint:{revision:'127'},assessmentContext:{at:f.context.at,freshnessPolicy:f.context.freshnessPolicy}}};
}
async function run(x){
 const calls=[];let assessments=0;
 const source={environment:x.environment??'development',withSnapshot:async(options,fn)=>{calls.push('transaction');assert.deepEqual(options,{isolation:'repeatable read',readOnly:true});return fn({resolveAuthority:async()=>{calls.push('authority');return x.authority;},readOwnedState:async scope=>{calls.push('state');assert.deepEqual(scope,{tenantId:x.authority.tenantId,businessId:x.authority.businessId});return x.row;},readOwnedEvidence:async scope=>{calls.push('evidence');assert.equal(scope.purchaseId,x.args.purchaseId);return x.support;}});}};
 const load=createOwnedRefundSnapshotLoader({source,assess:input=>{assessments++;return assembleRefundAssessment(input);}});
 return {result:await load(x.args),calls,assessments};
}
const cases=[
 ['authorized',()=>{},'blocked'],
 ['non staff',x=>x.authority.role='member','denied'],
 ['missing',x=>x.args.purchaseId='missing','denied'],
 ['cross business',x=>x.row.state.purchaseDrafts[0].businessId='foreign','denied'],
 ['wrong source',x=>x.environment='production','blocked'],
 ['revision drift',x=>x.row.revision='128','blocked'],
 ['digest drift',x=>x.args.expectedCheckpoint.stateDigest='a'.repeat(64),'blocked'],
 ['missing checkpoint',x=>delete x.args.expectedCheckpoint,'blocked'],
 ['missing refund history',x=>delete x.row.state.refundRecords,'blocked'],
 ['missing recovery',x=>delete x.support.recovery,'blocked'],
 ['missing audit',x=>delete x.support.audit,'blocked'],
 ['missing coverage',x=>delete x.support.coverage,'blocked'],
 ['missing freshness',x=>delete x.args.assessmentContext.freshnessPolicy,'blocked'],
 ['conflicting payment',x=>x.row.state.paymentAttempts[0].paymentConfirmedAt='2020-01-01T00:00:00Z','blocked'],
 ['foreign linked record',x=>x.row.state.creditUnits[0].businessId='foreign','blocked'],
 ['foreign audit',x=>x.support.audit[0].scope.businessId='foreign','blocked'],
 ['unknown event',x=>x.row.state.creditEvents[0].type='unsupported','blocked'],
 ['duplicate purchase',x=>x.row.state.purchaseDrafts.push(structuredClone(x.row.state.purchaseDrafts[0])),'blocked'],
 ['missing events',x=>delete x.row.state.creditEvents,'blocked'],
 ['cutoff policy',x=>x.support.policyBoundaries=['REFUND_CUTOFF_POLICY_UNRESOLVED'],'blocked'],
 ['restored policy',x=>x.support.policyBoundaries=['RESTORED_USAGE_POLICY_UNRESOLVED'],'blocked'],
];
for(const business of ['original','second'])for(const processor of ['processor-alpha','processor-beta'])for(const [name,change,status] of cases)test(`loader ${business}/${processor}: ${name}`,async()=>{
 const x=fixture(business,processor);change(x);const before=structuredClone(x);freeze(x);
 const {result:r,calls}=await run(x);assert.equal(r.status,status);assert.equal(r.executionAuthorized,false);assert.deepEqual(x,before);
 assert.deepEqual((await run(x)).result,r);
 if(name==='non staff')assert.deepEqual(calls,['transaction','authority']);
 if(name==='wrong source')assert.deepEqual(calls,[]);
 if(status==='denied'){assert.equal(r.checkpoint,undefined);assert.equal(r.assemblerInput,undefined);assert.ok(!calls.includes('evidence'));}
 if(r.assemblerInput){const i=r.assemblerInput,s=i.ownedSnapshot;assert.equal(i.attestations.coverage.provider.state,'provider_unknown');assert.equal(r.assessment.eligibility,undefined);assert.equal(s.stateDigest,inventoryDigest(x.row.state));assert.equal(i.attestations.snapshot.payloadDigest,inventoryDigest({state:s.state,facts:s.facts}));assert.equal(i.frozenTermsRef.digest,inventoryDigest(x.row.state.purchaseDrafts[0].terms));assert.equal(r.checkpoint.historicalMd5,x.row.historicalMd5);assert.equal(s.stateDigest.length,64);assert.notEqual(s.stateDigest,r.checkpoint.historicalMd5);
  if(name==='missing refund history')assert.equal(s.facts.refunds,undefined);
  if(name==='missing coverage')assert.ok(Object.values(i.attestations.coverage.owned).every(v=>v.state==='incomplete'));
  if(name.endsWith('policy'))assert.ok(r.reasonCodes.includes(x.support.policyBoundaries[0]));
 }
});
test('missing and cross-business responses are indistinguishable',async()=>{const a=fixture('original','processor-alpha'),b=structuredClone(a);a.args.purchaseId='missing';b.row.state.purchaseDrafts[0].businessId='other';assert.deepEqual((await run(a)).result,(await run(b)).result);});
test('canonical binding ignores object key order, not state content',async()=>{const x=fixture('original','processor-alpha');const a=(await run(x)).result;x.row.state=Object.fromEntries(Object.entries(x.row.state).reverse());const b=(await run(x)).result;assert.equal(a.checkpoint.stateDigest,b.checkpoint.stateDigest);assert.equal(a.assemblerInput.attestations.snapshot.payloadDigest,b.assemblerInput.attestations.snapshot.payloadDigest);});
test('digests have independent inputs and purposes',async()=>{const x=fixture('second','processor-beta');const r=(await run(x)).result;const i=r.assemblerInput;assert.equal(new Set([r.checkpoint.stateDigest,i.frozenTermsRef.digest,i.attestations.snapshot.payloadDigest,r.checkpoint.historicalMd5]).size,4);});
test('generic source contains no fixture/provider/default freshness literals',()=>{const source=readFileSync(new URL('../src/refund-snapshot-loader.mjs',import.meta.url),'utf8');for(const s of ['vega','square','6000','13750','USD','EUR','processor-alpha','Date.now','fetch(','complete_as_of','ownedMaxAgeMs'])assert.ok(!source.includes(s),s);});
