import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,visibleState,transition} from '../src/application.mjs';
const staff={role:'staff',userId:'desk',participantIds:[]},member={role:'member',userId:'member',participantIds:['p']};
const at='2030-01-01T10:00:00Z';
function fixture(){return {...emptyState(),participants:[{id:'p',name:'Member'},{id:'other',name:'Other'}],classes:[{id:'c',title:'Dance',category:'Dance',status:'open',startsAt:'2030-01-02T12:00:00Z',capacity:1,waitlistEnabled:true,creditRequired:true}],passes:[{id:'pass',participantId:'p',label:'Dance pack'}],creditUnits:[{id:'u',participantId:'p',passId:'pass',status:'available',entitlement:{categories:['Dance'],expiresAt:'2030-02-01T00:00:00Z'}}]};}
test('staff explanation uses the same eligible pass as reserve and refuses stale selected pass',()=>{
 const s=fixture(),v=visibleState(s,staff,at),o=v.bookingOptions.find(o=>o.participantId==='p');assert.equal(o.passId,'pass');assert.equal(v.staffAccount.available,1);
 const command={action:'reserve',body:{requestId:'r',classId:'c',participantId:'p',passId:o.passId,reservationOnly:true}};
 const next=transition(s,command,staff,{now:()=>at});assert.equal(next.result.creditConsumption.passId,o.passId);
 s.creditUnits[0].status='spent';assert.throws(()=>transition(s,command,staff,{now:()=>at}),/No eligible/);
});
test('reservation-only staff intent blocks a capacity race without creating a waitlist or consuming credit',()=>{
 const s=fixture();assert.equal(visibleState(s,staff,at).bookingOptions[0].eligible,true);
 s.reservations.push({id:'occupied',classId:'c',participantId:'other',status:'reserved'});const before=structuredClone(s);
 assert.throws(()=>transition(s,{action:'reserve',body:{requestId:'r',classId:'c',participantId:'p',reservationOnly:true}},staff,{now:()=>at}),/Class full/);assert.deepEqual(s,before);
 const prior=transition(s,{action:'reserve',body:{requestId:'existing',classId:'c',participantId:'p'}},staff,{now:()=>at});assert.equal(prior.result.status,'waitlisted');
});
test('staff initial explicit classification preserves original record and actor/reason; members cannot use it',()=>{
 const s=fixture(),book=transition(s,{action:'reserve',body:{requestId:'r',classId:'c',participantId:'p'}},staff,{now:()=>at});
 const command={action:'cancel',id:book.result.id,body:{requestId:'cancel',classification:'late',reason:'Staff support request'}};
 assert.throws(()=>transition(book.state,command,member,{now:()=>at}),e=>e.status===403);
 const cancelled=transition(book.state,command,staff,{now:()=>at});assert.equal(cancelled.result.cancellation.originalClassification,'late');assert.equal(cancelled.result.cancellationHistory[0].actorId,'desk');assert.equal(cancelled.result.cancellationHistory[0].reason,'Staff support request');
 const corrected=transition(cancelled.state,{action:'correct-cancellation',id:book.result.id,body:{requestId:'fix',classification:'early',reason:'Reviewed policy'}},staff,{now:()=>at});assert.equal(corrected.result.cancellation.originalClassification,'late');assert.equal(corrected.result.cancellation.classification,'early');assert.equal(corrected.state.creditUnits.filter(u=>u.status==='available').length,1);
});
test('staff summary remains staff-only and member option scope is unchanged',()=>{
 const s=fixture(),v=visibleState(s,member,at);assert.equal(v.staffAccount,undefined);assert.ok(v.bookingOptions.every(o=>o.participantId==='p'));assert.deepEqual(v.creditEvents,[]);
 const sv=visibleState(s,staff,at);assert.equal(sv.bookingOptions.length,2);assert.equal(sv.staffAccount.available,1);
});
