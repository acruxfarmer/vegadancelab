import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {classCancellationOption} from '../src/class-cancellation.mjs';
import {auditRecords} from '../public/reporting-audit.js';
import {memberBookingUI} from '../public/member-booking.js';
const staff={userId:'desk',role:'staff',participantIds:[]},member={userId:'member',role:'member',participantIds:['a']};
let n=0;const clock={id:()=>`id-${++n}`,now:()=> '2026-09-23T12:00:00Z'};
const act=(s,action,body={},id,actor=staff)=>transition(s,{action,id,body:{requestId:`req-${++n}`,...body}},actor,clock);
function fixture(){
 let s={...emptyState(),participants:['a','b','waiting'].map(id=>({id,name:id})),classes:[{id:'class',title:'Class',status:'open',startsAt:'2099-10-01T12:00:00Z',capacity:2,waitlistEnabled:true,creditRequired:true}]};
 for(const participantId of ['a','b'])s=act(s,'issue-credit',{participantId,quantity:2,reason:'Fixture'}).state;
 s=act(s,'reserve',{classId:'class',participantId:'a'}).state;s=act(s,'cancel',{},s.reservations[0].id).state;
 for(const participantId of ['a','b','waiting'])s=act(s,'reserve',{classId:'class',participantId}).state;
 return s;
}
const preview=s=>visibleState(s,staff,clock.now()).classCancellationOptions[0];
const cancel=(s,body={},actor=staff)=>act(s,'cancel-class',{classId:'class',reason:'Instructor unavailable',impactToken:preview(s).impactToken,...body},undefined,actor);

test('occurrence cancellation atomically restores booked credits, closes waiting, preserves prior cancellation and lineage',()=>{
 const before=fixture(),p=preview(before);assert.equal(p.allowed,true);assert.equal(p.activeBookings,2);assert.equal(p.waitingEntries,1);assert.equal(p.expectedRestorations,2);
 const {state:s,result}=cancel(before);assert.equal(result.outcome,'applied');assert.equal(s.classes[0].status,'cancelled');assert.deepEqual(s.reservations[0],before.reservations[0]);
 assert.equal(s.reservations.filter(r=>r.status==='cancelled').length,4);assert.equal(s.creditEvents.length,before.creditEvents.length+2);
 for(const r of s.reservations.slice(1)){
  assert.equal(r.classCancellation.eventId,result.eventId);assert.equal(r.cancellationHistory.at(-1).actorId,'desk');assert.equal(r.attendanceStatus,'not_recorded');assert.equal(r.paymentStatus,'not_evaluated');
  if(r.creditConsumption){const debit=s.creditUnits.find(u=>u.id===r.creditConsumption.unitId),restored=s.creditUnits.find(u=>u.id===r.restoredCreditUnitId);assert.deepEqual(restored.entitlement,debit.entitlement);assert.equal(restored.sourceUnitId,debit.id);assert.equal(debit.status,'spent');}
  else {assert.equal(r.restoredCreditUnitId,undefined);assert.equal(r.waitlistHistory.at(-1).action,'closed');}
 }
 assert.deepEqual(cancel(s).state,s);
 assert.throws(()=>act(s,'reserve',{classId:'class',participantId:'a'}),/unavailable/);assert.throws(()=>act(s,'reserve',{classId:'class',participantId:'waiting',waitlistOnly:true}),/unavailable/);assert.throws(()=>act(s,'promote',{},s.reservations.at(-1).id),/unavailable/);
 assert.throws(()=>act(s,'correct-cancellation',{classification:'late',reason:'reverse'},s.reservations[1].id),/reconciliation/);
 const audit=auditRecords({...s,context:staff});assert.equal(audit.filter(r=>r.type==='class-cancellation').length,1);assert.equal(audit.find(r=>r.type==='class-cancellation').classId,'class');assert.equal(audit.filter(r=>r.type==='restore'&&r.detail.includes(result.eventId)).length,2);
});

test('all historical attendance blocks cancellation, including cleared attendance on a previously cancelled booking',()=>{
 for(const patch of [{attendanceStatus:'present'},{attendanceStatus:'absent'},{attendanceHistory:[{from:'present',to:'not_recorded'}]},{attendanceRevision:2}]){
  const s=fixture();Object.assign(s.reservations[0],patch);const before=structuredClone(s);assert.equal(preview(s).allowed,false);assert.match(preview(s).reason,/Attendance/);assert.throws(()=>cancel(s),/reconciliation/);assert.deepEqual(s,before);
 }
});

test('stale impacts, past classes, malformed requests, member authority and broken ledger fail without mutations',()=>{
 const s=fixture(),before=structuredClone(s),token=preview(s).impactToken;
 assert.throws(()=>cancel(s,{},member),e=>e.status===403);assert.throws(()=>cancel(s,{classId:{id:'class'}}),/identifier/);assert.throws(()=>cancel(s,{reason:''}),/reason/);
 assert.throws(()=>cancel(s,{impactToken:'stale'}),/impact changed/);assert.deepEqual(s,before);
 const changed=act(s,'cancel',{},s.reservations[1].id).state;assert.throws(()=>cancel(changed,{impactToken:token}),/impact changed/);
 const past=structuredClone(s);past.classes[0].startsAt='2000-01-01';assert.throws(()=>cancel(past),/upcoming/);
 for(const damage of ['missing','spent','restored','waiting-credit']){
  const broken=structuredClone(s),r=broken.reservations[2];
  if(damage==='missing')broken.creditEvents=broken.creditEvents.filter(e=>e.id!==r.creditConsumption.eventId);
  if(damage==='spent')broken.creditUnits.find(u=>u.id===r.creditConsumption.unitId).status='available';
  if(damage==='restored')r.restoredCreditUnitId='unexpected';
  if(damage==='waiting-credit')broken.reservations.at(-1).creditConsumption=r.creditConsumption;
  const original=structuredClone(broken);assert.equal(preview(broken).allowed,false);assert.throws(()=>cancel(broken),/reconciliation/);assert.deepEqual(broken,original);
 }
});

test('expired and restricted original terms remain unchanged and member presentation excludes staff and other member history',()=>{
 const s=fixture();for(const u of s.creditUnits.filter(u=>u.status==='spent'))u.entitlement={source:'class_pack',validFrom:'2020-01-01',expiresAt:'2025-01-01',categories:['Limited'],classIds:['class']};
 const {state:done}=cancel(s),v=visibleState(done,member,clock.now());assert.equal(v.memberAccount.available,1); // Other unspent original credit only.
 assert.equal(v.classCancellationOptions,undefined);assert.equal(v.classes[0].cancellationHistory,undefined);assert.ok(v.reservations.every(r=>r.participantId==='a'));assert.doesNotMatch(JSON.stringify(v),/Instructor unavailable|"actorId":"desk"/);
 const html=memberBookingUI({getData:()=>({...v,context:member}),escape:x=>String(x??''),date:()=> 'future',time:()=> 'noon'}).render('bookings');assert.match(html,/Class cancelled by studio/);assert.doesNotMatch(html,/Confirm class cancellation/);
});

test('free classes cancel without credit movements and mid-operation failure cannot mutate input',()=>{
 const s=fixture();s.classes[0].creditRequired=false;for(const r of s.reservations.slice(1))delete r.creditConsumption;
 const free=cancel(s).state;assert.deepEqual(free.creditUnits,s.creditUnits);assert.deepEqual(free.creditEvents,s.creditEvents);
 const original=fixture(),snapshot=structuredClone(original),body={classId:'class',impactToken:preview(original).impactToken,reason:'Atomic failure',requestId:'fail'};let count=0;
 assert.throws(()=>transition(original,{action:'cancel-class',body},staff,{...clock,id:()=>{if(++count===5)throw Error('injected failure');return `failure-${count}`;}}),/injected failure/);assert.deepEqual(original,snapshot);
});
