import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {memberCancellationOption} from '../src/member-cancellation.mjs';
import {cancellationConsequence,cancellationOutcome} from '../public/member-cancellation.js';
import {memberBookingUI} from '../public/member-booking.js';
const member={role:'member',userId:'member',participantIds:['p']},staff={role:'staff',userId:'staff',participantIds:[]};
const start='2030-01-01T12:00:00Z',early='2030-01-01T10:30:00Z',late='2030-01-01T10:30:00.001Z';
function fixture(){return {...emptyState(),participants:[{id:'p',name:'Member'},{id:'other'}],classes:[{id:'c',title:'Test class',startsAt:start,cancellationCutoffMinutes:90}],passes:[{id:'pass',participantId:'p',label:'Test pack',entitlement:{expiresAt:'2030-02-01T00:00:00Z'}}],reservations:[{id:'r',classId:'c',participantId:'p',status:'reserved',attendanceStatus:'not_recorded',creditConsumption:{unitId:'unit',passId:'pass'}}],creditUnits:[{id:'unit',participantId:'p',passId:'pass',status:'spent',spentByBookingId:'r',entitlement:{expiresAt:'2030-02-01T00:00:00Z'}}]};}
const cancel=(s,at,body={},actor=member)=>transition(s,{action:'cancel',id:'r',body:{requestId:'request',...body}},actor,{now:()=>at});
test('member consequence matches the verified exact-cutoff classification and identifies original credit terms',()=>{
 const s=fixture(),r=s.reservations[0],o=memberCancellationOption(s,r,early);
 assert.equal(o.classification,'early');assert.equal(o.passLabel,'Test pack');assert.equal(o.expiresAt,'2030-02-01T00:00:00Z');assert.match(cancellationConsequence(o),/1 credit will be restored to Test pack/);
 assert.equal(cancel(s,early,{expectedCancellationClassification:'early'}).result.cancellation.classification,'early');
 const l=memberCancellationOption(s,r,late);assert.equal(l.classification,'late');assert.match(cancellationConsequence(l),/remain spent/);assert.match(cancellationConsequence(l),/No credit will be restored/);
});
test('cutoff crossing requires review, makes no mutation, and then accepts explicit late confirmation',()=>{
 const s=fixture(),before=structuredClone(s);assert.throws(()=>cancel(s,late,{expectedCancellationClassification:'early'}),/consequence has changed/);assert.deepEqual(s,before);
 const next=cancel(s,late,{expectedCancellationClassification:'late'});assert.equal(next.result.status,'cancelled');assert.equal(next.state.creditUnits.length,1);assert.match(cancellationOutcome(next.result,'Test pack'),/remains spent/);
});
test('past, missing class, invalid status and recorded attendance are safe and understandable; staff reconciliation is unchanged',()=>{
 for(const change of [s=>{s.classes[0].startsAt=early},s=>{s.classes=[]},s=>{s.reservations[0].status='invalid'},s=>{s.reservations[0].attendanceStatus='present'}]){
  const s=fixture();change(s);const before=structuredClone(s),o=memberCancellationOption(s,s.reservations[0],early);assert.equal(o.allowed,false);assert.match(o.reason,/studio/);assert.throws(()=>cancel(s,early),e=>e.status===409);assert.deepEqual(s,before);
 }
 const s=fixture();assert.throws(()=>cancel(s,start),/already started/);assert.equal(cancel(s,start,{},staff).result.status,'cancelled');
});
test('duplicate cancellation after class start preserves prior result and does not restore twice',()=>{
 const first=cancel(fixture(),early,{expectedCancellationClassification:'early'}),again=cancel(first.state,start,{expectedCancellationClassification:'early'});
 assert.deepEqual(again.state,first.state);assert.equal(again.state.creditEvents.filter(e=>e.type==='restore').length,1);assert.match(cancellationOutcome(again.result,'Test pack'),/1 credit was restored/);
});
test('member summary is own-only and another participant cannot cancel or change reviewed classification',()=>{
 const s=fixture();s.reservations.push({...s.reservations[0],id:'foreign',participantId:'other'});const v=visibleState(s,member,early);assert.deepEqual(v.cancellationOptions.map(o=>o.reservationId),['r']);
 assert.throws(()=>cancel(s,early,{}, {...member,participantIds:['other']}),e=>e.status===403);
 assert.throws(()=>cancel(s,early,{classification:'early'}),e=>e.status===403);
});
test('no-credit cancellation never promises restoration; unknown outcomes stay explicit',()=>{
 const s=fixture();delete s.reservations[0].creditConsumption;const o=memberCancellationOption(s,s.reservations[0],early);assert.match(cancellationConsequence(o),/will not change your credit balance/);
 const r=cancel(s,early).result;assert.match(cancellationOutcome(r),/No credit was restored/);assert.match(cancellationOutcome({status:'cancelled'}),/not recorded/);
});
test('past/attendance-blocked cards show explanation without cancel action and cancelled cards show clear credit outcome',()=>{
 const s=fixture();s.classes[0].startsAt='2020-01-01T12:00:00Z';const d={...visibleState(s,member),context:member};const ui=memberBookingUI({getData:()=>d,escape:String,date:String,time:String});const html=ui.render('bookings');assert.doesNotMatch(html,/data-cancel=/);assert.match(html,/already started/);
 const next=cancel(fixture(),early);const shown={...visibleState(next.state,member,early),context:member};const cancelled=memberBookingUI({getData:()=>shown,escape:String,date:String,time:String}).render('bookings');assert.match(cancelled,/1 credit was restored to Test pack/);assert.doesNotMatch(cancelled,/not_applicable/);
});
