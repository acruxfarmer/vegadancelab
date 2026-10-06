import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boundedRefundReadiness} from '../src/bounded-refund-readiness.mjs';
import {assessRefundEligibility} from '../src/refund-eligibility.mjs';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const authority={userId:'staff',role:'staff',tenantId:'vega-development',businessId:'vega-dance-lab'},at='2026-10-05T23:00:00Z';
const check=(state=structuredClone(fixture),a=authority,p=state.purchaseDrafts[0].id)=>boundedRefundReadiness({state,authority:a,purchaseId:p,at});
test('bounded readiness preserves closed assessment without historical completeness promotion',()=>{const s=structuredClone(fixture),before=structuredClone(s),r=check(s);assert.equal(r.status,'ready');assert.equal(r.historicalCompleteness,'unknown');assert.equal(r.providerStatus,'provider_unknown');assert.equal(r.executionAuthorized,false);assert.deepEqual(r.assessment,assessRefundEligibility({state:s,authority,purchaseId:s.purchaseDrafts[0].id,at,refundRecords:[]}));assert.deepEqual(check(s),r);assert.deepEqual(s,before);});
for(const [name,mutate] of [
 ['terms mismatch',s=>s.purchaseDrafts[0].terms.priceMinor++],
 ['payment mismatch',s=>s.paymentAttempts[0].paymentId='wrong'],
 ['issuance missing',s=>s.entitlementIssuances=[]],
 ['credit spent',s=>s.creditUnits[0].status='spent'],
 ['restoration',s=>s.creditEvents[0].type='restore'],
 ['usage missing',s=>delete s.creditEvents],
 ['reservation unresolved',s=>s.reservations.push({participantId:s.purchaseDrafts[0].participantId,status:'pending'})],
 ['refund inventory null',s=>s.refundOperations=null],
 ['existing refund',s=>s.refundOperations=[{...authority,purchaseId:s.purchaseDrafts[0].id}]],
 ['foreign refund inventory',s=>s.refundOperations=[{purchaseId:'foreign',tenantId:'other',businessId:'other'}]]
])test(name+' blocks',()=>{const s=structuredClone(fixture);mutate(s);assert.equal(check(s).status,'blocked');});
test('member and foreign-business staff denied',()=>{assert.equal(check(fixture,{...authority,role:'member'}).status,'blocked');assert.equal(check(fixture,{...authority,businessId:'foreign'}).status,'blocked');assert.equal(check(fixture,authority,'missing').status,'blocked');});
test('private command/provenance absence never supplies or removes business authority',()=>{const s=structuredClone(fixture);s.activity=[];assert.equal(check(s).status,'ready');s.buyerCommands=[{response:{terms:'forged'}}];assert.equal(check(s).status,'ready');});
test('refundContext reads no private commands and returns no raw evidence payloads',async()=>{
 const queries=[];const pool={async connect(){return {release(){},async query(sql){queries.push(sql);if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:authority.tenantId,business_id:authority.businessId,role:'staff',participant_ids:[]}]};if(sql.startsWith('select state,revision'))return {rows:[{state:structuredClone(fixture),revision:127}]};if(/app_commands|recovery_outbox/.test(sql))assert.fail('private receipt query');return {rows:[]};}};}};
 const store=createApplicationStore(pool,{initialOwners:[authority],resolveIntegration:async(c,a,t)=>t.integrationRef,refundNow:()=>at});const r=await store.refundContext('staff',fixture.purchaseDrafts[0].id);assert.equal(r.businessReadiness.status,'ready');assert.equal(Object.hasOwn(r,'ownedComplete'),false);assert.equal(Object.hasOwn(r,'response'),false);assert.ok(queries.includes('begin isolation level repeatable read read only'));
});
