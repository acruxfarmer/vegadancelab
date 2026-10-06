import test from 'node:test';
import assert from 'node:assert/strict';
import {programFixture,stamp} from './helpers/refund-program-fixture.mjs';
import {reconcileRefundInventory} from '../src/refund-reconciliation.mjs';
const check=(h,e=h.inventory(),ops=h.state.refundOperations??[])=>reconcileRefundInventory({purchase:h.purchase(),operations:ops,evidence:e,at:stamp});
test('empty complete payment-scoped evidence establishes remaining provider amount only',()=>{const h=programFixture(),r=check(h);assert.equal(r.status,'reconciled');assert.equal(r.remainingProviderMinor,6000);assert.equal(r.executionAuthorized,false);assert.equal(r.historicalCompleteness,'unknown');});
for(const [name,change,code] of [
 ['stale',e=>e.cutoff='2026-10-05T00:00:00Z','PROVIDER_EVIDENCE_STALE'],
 ['future',e=>e.observedAt='2027-01-01T00:00:00Z','PROVIDER_EVIDENCE_STALE'],
 ['foreign',e=>e.businessId='other','PROVIDER_BINDING_INVALID'],
 ['wrong purchase',e=>e.purchaseId='other','PROVIDER_BINDING_INVALID'],
 ['wrong integration',e=>e.integrationDigest='other','PROVIDER_BINDING_INVALID'],
 ['missing pages',e=>e.coverage.paginationExhausted=false,'PROVIDER_COVERAGE_INCOMPLETE'],
 ['unstable payment',e=>e.coverage.paymentStable=false,'PROVIDER_COVERAGE_INCOMPLETE'],
 ['wrong payment',e=>e.payment.id='other','PAYMENT_BINDING_CONFLICT'],
 ['missing refund',e=>e.payment.refundIds=['missing'],'PAYMENT_REFUND_COVERAGE_GAP'],
 ['inconsistent total',e=>e.payment.refundedMinor=100,'PAYMENT_REFUND_TOTAL_CONFLICT'],
 ['dispute',e=>e.disputes=[{id:'d'}],'PROVIDER_DISPUTE'],
])test(`comparison blocks ${name}`,()=>{const h=programFixture(),e=h.inventory();change(e);const r=check(h,e);assert.equal(r.status,'needs-review');assert.ok(r.reasonCodes.includes(code));assert.ok(r.remainingProviderMinor==null);});
test('duplicate and conflicting provider IDs never double count or authorize',()=>{const h=programFixture(),e=h.inventory(),r={id:'r',paymentId:h.purchase().paymentId,amountMinor:2000,currency:'USD',status:'completed'};e.refunds=[r,r];e.payment.refundedMinor=2000;assert.ok(check(h,e).reasonCodes.includes('DUPLICATE_PROVIDER_REFUND'));e.refunds=[r,{...r,amountMinor:3000}];assert.ok(check(h,e).reasonCodes.includes('CONFLICTING_PROVIDER_REFUND'));});
test('external pending, failed, rejected and completed remain review items',()=>{for(const status of ['pending','failed','rejected','completed']){const h=programFixture();h.extra=[{id:'external',paymentId:h.purchase().paymentId,amountMinor:2000,currency:'USD',status}];const r=check(h);assert.equal(r.status,'needs-review');assert.equal(r.external[0].status,status);}});
test('over refund evidence blocks rather than clamping to zero',()=>{const h=programFixture();h.extra=[{id:'external',paymentId:h.purchase().paymentId,amountMinor:6001,currency:'USD',status:'completed'}];assert.ok(check(h).reasonCodes.includes('OVER_REFUND_EVIDENCE'));});
test('owned provider ID missing, changed amount and terminal conflict require review',()=>{const h=programFixture(),o=h.intent();h.dispatch(o);h.observe(o,'completed');const e=h.inventory();e.refunds=[];assert.ok(check(h,e).reasonCodes.includes('OWNED_PROVIDER_REFUND_MISSING'));const e2=h.inventory();e2.refunds[0].amountMinor=1000;assert.ok(check(h,e2).reasonCodes.includes('REFUND_AMOUNT_CONFLICT'));const e3=h.inventory();e3.refunds[0].status='failed';assert.ok(check(h,e3).reasonCodes.includes('TERMINAL_STATUS_CONFLICT'));});
test('two business operations cannot share one provider refund',()=>{const h=programFixture(),o=h.intent();h.dispatch(o);h.observe(o,'completed');const ops=h.state.refundOperations;assert.ok(check(h,h.inventory(),[ops[0],{...ops[0],id:'second'}]).reasonCodes.includes('PROVIDER_REFUND_LINKED_TWICE'));});
test('matching reason alone is an unbound candidate and never clears unknown dispatch',()=>{const h=programFixture(),o=h.intent();h.dispatch(o);h.extra=[{id:'r',paymentId:o.paymentId,amountMinor:o.amountMinor,currency:o.currency,status:'completed',reason:`Refund ${o.id}: ${o.reason}`}];const r=check(h);assert.ok(r.reasonCodes.includes('UNBOUND_PROVIDER_CANDIDATE'));assert.ok(r.reasonCodes.includes('UNRESOLVED_DISPATCH'));assert.equal(r.matches.length,0);assert.equal(r.automaticRetry,false);});
