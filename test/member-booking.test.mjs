import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
const at='2030-01-01T12:00:00Z',member={role:'member',userId:'member',participantIds:['p']};
const fixture=()=>({...emptyState(),participants:[{id:'p'},{id:'q'}],classes:[{id:'c',status:'open',startsAt:'2030-01-02T12:00:00Z',capacity:1,creditRequired:true,category:'Dance'}],passes:[{id:'long',participantId:'p',label:'Long pass'},{id:'short',participantId:'p',label:'Short pass'}],creditUnits:[{id:'long-unit',passId:'long',participantId:'p',status:'available',entitlement:{expiresAt:'2030-03-01T00:00:00Z'}},{id:'short-unit',passId:'short',participantId:'p',status:'available',entitlement:{expiresAt:'2030-02-01T00:00:00Z',categories:['Dance']}},{id:'private',passId:'private',participantId:'q',status:'available'}]});
const view=s=>visibleState(s,member,at);
const book=(s,body={})=>transition(s,{action:'reserve',body:{requestId:'one',classId:'c',participantId:'p',...body}},member,{now:()=>at});
test('member explanation selects the same earliest-expiring eligible pass as consumption',()=>{
 const s=fixture(),o=view(s).bookingOptions[0];assert.equal(o.passId,'short');assert.equal(o.eligibleCredits,1);assert.equal(o.passLabel,'Short pass');
 const next=book(s,{passId:o.passId});assert.equal(next.result.creditConsumption.passId,o.passId);assert.equal(next.state.creditEvents.filter(e=>e.type==='consume').length,1);
 assert.equal(view(next.state).bookingOptions[0].eligible,false);assert.throws(()=>book(next.state),/Already booked/);assert.equal(s.creditUnits[1].status,'available');
});
test('capacity, past and closed classes, expiration, category and class restrictions block booking',()=>{
 for(const mutate of [s=>{s.classes[0].status='closed'},s=>{s.classes[0].startsAt=at},s=>{s.classes[0].waitlistEnabled=true;s.reservations.push({id:'other',classId:'c',participantId:'q',status:'reserved'})},s=>{s.creditUnits.forEach(u=>u.entitlement={expiresAt:'2030-01-02T12:00:00Z'})},s=>{s.creditUnits.forEach(u=>u.entitlement={validFrom:'2030-01-02T00:00:00Z'})},s=>{s.creditUnits.forEach(u=>u.entitlement={categories:['Other']})},s=>{s.creditUnits.forEach(u=>u.entitlement={classIds:['other']})},s=>{s.creditUnits=[]}]){
  const s=fixture();mutate(s);const before=structuredClone(s);assert.equal(view(s).bookingOptions[0].eligible,false);assert.throws(()=>book(s),e=>e.status===409);assert.deepEqual(s,before);
 }
});
test('stale selected entitlement fails rather than silently consuming another pass; cancellation restores the same terms',()=>{
 const s=fixture(),o=view(s).bookingOptions[0];s.creditUnits[1].status='spent';assert.throws(()=>book(s,{passId:o.passId}),/No eligible/);assert.equal(s.creditUnits[0].status,'available');
 s.creditUnits[1].status='available';const b=book(s,{passId:o.passId});const cancelled=transition(b.state,{action:'cancel',id:b.result.id,body:{requestId:'cancel'}},member,{now:()=>at});
 assert.equal(cancelled.result.cancellation.creditOutcome,'restored');assert.equal(view(cancelled.state).bookingOptions[0].passId,o.passId);assert.deepEqual(cancelled.state.creditUnits.at(-1).entitlement,s.creditUnits[1].entitlement);
});
test('member summary excludes other participants and audit; forged participant/pass selection fails',()=>{
 const s=fixture(),v=view(s);assert.ok(v.bookingOptions.every(o=>o.participantId==='p'));assert.ok(v.creditUnits.every(u=>u.participantId==='p'));assert.deepEqual(v.creditEvents,[]);
 assert.throws(()=>book(s,{participantId:'q'}),e=>e.status===403);assert.throws(()=>book(s,{passId:'private'}),e=>e.status===403);
 s.classes[0].creditRequired=false;s.creditUnits=[];assert.equal(view(s).bookingOptions[0].eligible,true);assert.equal(book(s).result.creditConsumption,undefined);
});
