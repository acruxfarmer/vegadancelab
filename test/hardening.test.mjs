import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition} from '../src/application.mjs';
import {entitlementEligible} from '../src/entitlements.mjs';
import {memberBookingOption} from '../src/member-booking.mjs';

const at='2026-10-01T00:00:00Z';
const c={id:'class',status:'open',startsAt:'2026-10-02T00:00:00Z',capacity:1,category:'Dance'};
test('malformed persisted class dates and capacity fail closed without modifying history',()=>{
 for(const invalid of [{startsAt:'bad'},{capacity:null},{capacity:'1'},{capacity:-1},{capacity:1.5}]){
  const state={...emptyState(),participants:[{id:'p'}],classes:[{...c,...invalid}]},before=structuredClone(state);
  assert.equal(memberBookingOption(state,state.classes[0],'p',at).eligible,false);
  assert.throws(()=>transition(state,{action:'reserve',body:{participantId:'p',classId:c.id,requestId:'r'}},{userId:'u',role:'member',participantIds:['p']},{now:()=>at}),e=>e.status===409);
  assert.deepEqual(state,before);
 }
});
test('malformed entitlement windows and restrictions cannot authorize consumption',()=>{
 for(const entitlement of [{validFrom:'bad'},{expiresAt:'bad'},{validFrom:''},{expiresAt:123},{validFrom:'2026-10-03',expiresAt:'2026-10-01'},{categories:'Dance'},{classIds:'class'},{categories:[null]},'bad']){
  assert.equal(entitlementEligible({entitlement},c,at),false,JSON.stringify(entitlement));
 }
 assert.equal(entitlementEligible({},c,at),true);
 assert.equal(entitlementEligible({}, {...c,startsAt:'bad'},at),false);
});
