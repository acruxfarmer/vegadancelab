import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,target,durable,booking} from './helpers/fulfillment-fixture.mjs';
import {hasDurableAccess,reversePurchaseFulfillment,durableFulfillmentComplete} from '../src/fulfillment.mjs';
import {refundProgramFacts} from '../src/refund-program.mjs';
const access=h=>hasDurableAccess(h.state,{principalId:h.a.userId,tenantId:h.a.tenantId,businessId:h.a.businessId,target});
test('soda: successful purchase with explicit empty plan issues no booking credits',()=>{
 const h=fixture([]);h.state.purchaseDrafts[0].terms.productType='physical';h.state.purchaseDrafts[0].terms.productName='Soda';h.sync();
 assert.equal(h.fulfill().status,'issued');assert.equal(h.state.purchaseDrafts[0].paymentStatus,'succeeded');assert.equal(h.state.creditUnits.length,0);assert.equal(h.state.passes.length,0);assert.equal(h.state.fulfillmentActions.length,0);
});
test('video: one durable entitlement, repeat access and fulfillment never consume or duplicate',()=>{
 const h=fixture();assert.equal(h.fulfill().status,'issued');const before=structuredClone(h.state);
 for(let i=0;i<10;i++)assert.equal(access(h),true);
 h.fulfill();assert.deepEqual(h.state,before);assert.equal(h.state.accessEntitlements.length,1);assert.equal(h.state.creditUnits.length,0);
});
test('generic target is not limited to media',()=>{const h=fixture([{...durable,target:{...target,kind:'document'}}]);h.fulfill();assert.equal(hasDurableAccess(h.state,{principalId:h.a.userId,tenantId:h.a.tenantId,businessId:h.a.businessId,target:{...target,kind:'document'}}),true);});
for(const actions of [[booking],null])test(`class-pack preserves issuer and validity ${actions?'explicit':'legacy mapping'}`,()=>{
 const h=fixture(actions);h.fulfill();h.fulfill();assert.equal(h.state.creditUnits.length,3);assert.equal(h.state.passes.length,1);assert.equal(h.state.entitlementIssuances.length,1);
 assert.equal(h.state.purchaseDrafts[0].validFrom,h.state.purchaseDrafts[0].paymentConfirmedAt);assert.equal(h.state.creditUnits[0].entitlement.source,'sandbox_purchase');
 h.refund();assert.ok(h.state.creditUnits.every(u=>u.status==='refunded'));assert.equal(h.state.fulfillmentActions[0].status,'revoked');
});
test('multi-action executes exactly once and full refund revokes both with retained history',()=>{
 const h=fixture([booking,durable]);h.fulfill();h.fulfill();assert.equal(h.state.creditUnits.length,3);assert.equal(h.state.accessEntitlements.length,1);assert.ok(h.state.fulfillmentActions.every(a=>a.attempts===1&&a.status==='fulfilled'));
 h.refund();assert.equal(access(h),false);assert.ok(h.state.fulfillmentActions.every(a=>a.status==='revoked'));assert.equal(h.state.accessEntitlements[0].state,'revoked');assert.equal(h.state.creditEvents.filter(e=>e.type==='refund_retire').length,3);
 const before=structuredClone(h.state);reversePurchaseFulfillment(h.state,h.state.purchaseDrafts[0].id,h.state.refundOperations[0].id,'2026-10-05T23:00:00Z');assert.deepEqual(h.state,before);assert.throws(()=>h.fulfill(),/refund/);
});
test('durable-only refund never holds or retires unrelated legacy credits',()=>{
 const h=fixture();h.state.creditUnits.push({id:'unrelated',status:'available'});h.fulfill();h.refund();assert.deepEqual(h.state.creditUnits,[{id:'unrelated',status:'available'}]);assert.equal(h.state.refundOperations[0].unitIds.length,0);assert.equal(access(h),false);
});
test('one handler failure preserves success and retries only failed action',()=>{
 const h=fixture([durable,booking]);h.state.passes=null;
 assert.equal(h.fulfill().status,'pending');assert.deepEqual(h.state.fulfillmentActions.map(a=>a.status),['fulfilled','failed']);assert.equal(h.state.accessEntitlements.length,1);assert.equal(h.state.creditUnits.length,0);
 h.state.passes=[];assert.equal(h.fulfill().status,'issued');assert.deepEqual(h.state.fulfillmentActions.map(a=>a.attempts),[1,2]);assert.equal(h.state.creditUnits.length,3);assert.equal(h.state.accessEntitlements.length,1);assert.ok(h.state.fulfillmentActions[1].history.some(e=>e.status==='failed'));
});
for(const type of ['PHYSICAL_FULFILLMENT','toString','__proto__'])test(`unsupported ${type} fails without implicit credits`,()=>{const h=fixture([{id:'future',type}]);assert.equal(h.fulfill().status,'pending');assert.equal(h.state.fulfillmentActions[0].error,'unsupported_handler');assert.equal(h.state.creditUnits.length,0);});
for(const change of [{userId:'another'},{businessId:'another'},{tenantId:'another'},{participantIds:['another']}])test(`authority isolation ${JSON.stringify(change)}`,()=>{const h=fixture(),before=structuredClone(h.state);assert.throws(()=>h.fulfill({...h.a,...change}));assert.deepEqual(h.state,before);});
test('frozen target cannot escape business',()=>{const h=fixture([{...durable,target:{...target,businessId:'foreign'}}]);assert.throws(()=>h.fulfill(),/scope/);assert.equal(h.state.accessEntitlements,undefined);});
test('unknown legacy product gets no implicit credit action',()=>{const h=fixture(null);h.state.purchaseDrafts[0].terms.productType='physical';h.sync();assert.throws(()=>h.fulfill(),/Explicit/);assert.equal(h.state.creditUnits.length,0);});
for(const mutate of [h=>h.state.accessEntitlements.push(structuredClone(h.state.accessEntitlements[0])),h=>h.state.fulfillmentActions.push(structuredClone(h.state.fulfillmentActions[0])),h=>h.state.purchaseDrafts[0].terms.fulfillmentPlan.actions=[],h=>h.state.accessEntitlements[0].principalId='foreign'])test('inconsistent durable provenance fails closed',()=>{const h=fixture();h.fulfill();mutate(h);assert.equal(access(h),false);});
test('wrong viewer/business/target cannot use grant',()=>{const h=fixture();h.fulfill();for(const override of [{principalId:'foreign'},{businessId:'foreign'},{target:{...target,id:'foreign'}}])assert.equal(hasDurableAccess(h.state,{principalId:h.a.userId,tenantId:h.a.tenantId,businessId:h.a.businessId,target,...override}),false);});
test('unfinalized purchase cannot grant and reversal needs completed canonical refund',()=>{const h=fixture();h.state.purchaseDrafts[0].status='draft';assert.throws(()=>h.fulfill(),/Finalized/);assert.throws(()=>reversePurchaseFulfillment(h.state,h.state.purchaseDrafts[0].id,'invented','2026-10-05'),/canonical refund/);});
test('mixed outcomes cannot be allocated as whole booking-credit partial refunds',()=>{const h=fixture([booking,durable]);h.fulfill();assert.deepEqual(refundProgramFacts(h.state,h.staff,h.state.purchaseDrafts[0].id,'2026-10-05T23:00:00Z').reasonCodes,['FULFILLMENT_ALLOCATION_UNSUPPORTED']);});
test('a second grant to the same target cannot conceal a missing action outcome',()=>{const h=fixture([durable,{...durable,id:'second-access'}]);h.fulfill();h.state.fulfillmentActions[1].status='failed';assert.equal(durableFulfillmentComplete(h.state,h.state.purchaseDrafts[0]),false);});
