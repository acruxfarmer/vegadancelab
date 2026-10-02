import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessRefundEligibility} from '../src/refund-eligibility.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
function input(){return {state:structuredClone(fixture),authority:{role:'staff',userId:'reviewer',tenantId:'vega-development',businessId:'vega-dance-lab'},purchaseId:fixture.purchaseDrafts[0].id,at:'2026-10-02T22:57:44Z',refundRecords:[]};}
const cases=[
 ['recorded unused purchase',()=>{},'eligible','OWNED_PAYMENT_CONFIRMED'],
 ['expired',x=>x.at='2026-11-01T22:22:38.285Z','ineligible','REFUND_WINDOW_EXPIRED'],
 ['exact boundary',x=>x.at='2026-11-01T22:22:38.284Z','blocked','REFUND_CUTOFF_POLICY_UNRESOLVED'],
 ['before boundary',x=>x.at='2026-11-01T22:22:38.283Z','eligible','WITHIN_FROZEN_REFUND_WINDOW'],
 ['partial consumption',x=>x.state.creditUnits[0].status='spent','ineligible','ENTITLEMENT_CONSUMED'],
 ['full consumption',x=>x.state.creditUnits.forEach(u=>u.status='spent'),'ineligible','ENTITLEMENT_CONSUMED'],
 ['restored after use',x=>x.state.creditEvents.push({...x.state.creditEvents[0],type:'consume'},{...x.state.creditEvents[0],type:'restore'}),'blocked','RESTORED_USAGE_POLICY_UNRESOLVED'],
 ['refund record',x=>x.refundRecords.push({purchaseId:x.purchaseId,status:'completed'}),'blocked','EXISTING_REFUND_OR_REVERSAL'],
 ['already refunded',x=>x.state.purchaseDrafts[0].status='refunded','ineligible','EXISTING_REFUND_OR_REVERSAL'],
 ['credit reversal',x=>x.state.creditUnits[0].status='reversed','ineligible','EXISTING_REFUND_OR_REVERSAL'],
 ['owned inconsistency',x=>x.state.purchaseDrafts[0].paymentStatus='pending','blocked','OWNED_PROVIDER_STATE_INCONSISTENT'],
 ['unauthenticated evidence',x=>x.state.paymentAttempts[0].evidence.verified=false,'blocked','OWNED_PROVIDER_STATE_INCONSISTENT'],
 ['cross business',x=>x.authority.businessId='other','denied','OWNERSHIP_SCOPE_DENIED'],
 ['wrong buyer',x=>Object.assign(x.authority,{role:'member',participantIds:['other']}),'denied','OWNERSHIP_SCOPE_DENIED'],
 ['missing refund input',x=>delete x.refundRecords,'blocked','REFUND_STATE_UNRESOLVED'],
 ['duplicate credit',x=>x.state.creditUnits.push(x.state.creditUnits[0]),'blocked','FULFILLMENT_STATE_INCONSISTENT'],
 ['active reservation',x=>x.state.reservations.push({participantId:'vega-member-test-joe',status:'confirmed'}),'blocked','ACTIVE_OR_UNRESOLVED_RESERVATION'],
 ['missing history',x=>delete x.state.creditEvents,'blocked','USAGE_HISTORY_INCOMPLETE'],
 ['changed grant terms',x=>x.state.entitlementIssuances[0].productSnapshot.validDays=90,'blocked','FULFILLMENT_STATE_INCONSISTENT'],
 ['changed validity',x=>x.state.purchaseDrafts[0].validFrom='2026-10-03T22:22:38.284Z','blocked','FULFILLMENT_STATE_INCONSISTENT'],
 ['changed provider reference',x=>x.state.paymentAttempts[0].transactionRef.id='other','blocked','OWNED_PROVIDER_STATE_INCONSISTENT'],
];
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
for(const [name,change,status,reason] of cases)test(name,()=>{const x=input();change(x);const before=structuredClone(x);freeze(x);const r=assessRefundEligibility(x);assert.equal(r.status,status);assert.ok(r.reasonCodes.includes(reason));assert.equal(r.staffApprovalRequired,true);assert.equal(r.executionAuthorized,false);assert.deepEqual(x,before);});
