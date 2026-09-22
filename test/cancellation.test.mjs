import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
const staff={role:'staff',userId:'desk',participantIds:[]},member={role:'member',userId:'member',participantIds:['p']};
function setup(){let state=emptyState(),time='2026-10-01T10:00:00Z',n=0;state.participants=[{id:'p'},{id:'other'}];state.classes=[{id:'c',startsAt:'2026-10-01T12:00:00Z',status:'open',capacity:5,creditRequired:true},{id:'d',startsAt:'2026-10-02T12:00:00Z',status:'open',capacity:5,creditRequired:true}];return {get state(){return state},setTime:t=>time=t,run(action,body={},id,actor=member){const r=transition(state,{action,id,body:{requestId:`req-${++n}`,...body}},actor,{id:()=>`id-${++n}`,now:()=>time});state=r.state;return r.result},balance:()=>state.creditUnits.filter(u=>u.status==='available').length};}
const issue=s=>s.run('issue-credit',{participantId:'p',quantity:1,reason:'Controlled test'},undefined,staff);
const book=(s,classId='c')=>s.run('reserve',{participantId:'p',classId});
const correct=(s,r,classification)=>s.run('correct-cancellation',{classification,reason:'Front desk correction'},r.id,staff);
test('booking debit, exact cutoff early restore, repeat cancellation and corrections preserve one unit',()=>{
 const s=setup();issue(s);const r=book(s);assert.equal(s.balance(),0);assert.throws(()=>book(s),/Already booked/);assert.equal(s.state.creditEvents.filter(e=>e.type==='consume').length,1);
 s.setTime('2026-10-01T10:30:00Z');const c=s.run('cancel',{},r.id);assert.equal(c.cancellation.classification,'early');assert.equal(s.balance(),1);
 s.run('cancel',{},r.id);correct(s,r,'early');assert.equal(s.balance(),1);assert.equal(s.state.creditEvents.filter(e=>e.type==='restore').length,1);assert.equal(s.state.reservations[0].cancellationHistory.filter(e=>e.action==='cancel').length,1);
 assert.equal(c.paymentStatus,'not_evaluated');assert.equal(c.notificationStatus,'not_requested');
});
test('inside cutoff is late; staff late-to-early restores once; repeated correction has no movement',()=>{
 const s=setup();issue(s);const r=book(s);s.setTime('2026-10-01T10:30:00.001Z');assert.equal(s.run('cancel',{},r.id).cancellation.classification,'late');assert.equal(s.balance(),0);
 correct(s,r,'early');correct(s,r,'early');assert.equal(s.balance(),1);assert.equal(s.state.reservations[0].cancellation.originalClassification,'late');assert.equal(s.state.creditEvents.filter(e=>e.type==='restore').length,1);
});
test('available restored unit reverses once and can be reinstated without minting another unit',()=>{
 const s=setup();issue(s);const r=book(s);s.run('cancel',{},r.id);const unit=s.state.reservations[0].restoredCreditUnitId;
 correct(s,r,'late');correct(s,r,'late');assert.equal(s.balance(),0);assert.equal(s.state.creditEvents.filter(e=>e.type==='reverse_restoration').length,1);
 correct(s,r,'early');assert.equal(s.balance(),1);assert.equal(s.state.reservations[0].restoredCreditUnitId,unit);assert.equal(s.state.creditUnits.length,2);
});
test('spent restored unit blocks reclassification even with unrelated available credits; blocked attempt is audited',()=>{
 const s=setup();issue(s);const r=book(s);s.run('cancel',{},r.id);const next=book(s,'d');issue(s);const balance=s.balance();
 const attempt=correct(s,r,'late');assert.equal(attempt.outcome,'blocked');assert.equal(s.balance(),balance);assert.equal(s.state.reservations[0].cancellation.classification,'early');assert.equal(s.state.reservations[0].cancellationHistory.at(-1).outcome,'blocked');
 // Cancelling the subsequent booking produces its own unit, not an unspent original restoration.
 s.run('cancel',{},next.id);assert.equal(correct(s,r,'late').outcome,'blocked');assert.equal(s.state.reservations[0].cancellation.originalClassification,'early');
});
test('member cannot issue, change cutoff, choose classification, correct, or consume another participant credit',()=>{
 const s=setup();assert.throws(()=>s.run('issue-credit',{participantId:'p',quantity:1,reason:'x'}),e=>e.status===403);
 assert.throws(()=>s.run('class-policy',{classId:'c',cancellationCutoffMinutes:0}),e=>e.status===403);issue(s);const r=book(s);
 assert.throws(()=>s.run('cancel',{classification:'early'},r.id),e=>e.status===403);s.run('cancel',{},r.id);
 assert.throws(()=>s.run('correct-cancellation',{classification:'late',reason:'x'},r.id),e=>e.status===403);
 const foreign=s.run('issue-credit',{participantId:'other',quantity:1,reason:'test'},undefined,staff);assert.throws(()=>s.run('reserve',{classId:'d',participantId:'p',passId:foreign.id}),e=>e.status===403);
 const view=visibleState(s.state,member);assert.ok(view.creditUnits.every(u=>u.participantId==='p'));assert.deepEqual(view.creditEvents,[]);assert.ok(view.reservations[0].cancellationHistory.every(e=>!e.actorId&&!e.reason));
 correct(s,r,'late');const replay=s.run('cancel',{},r.id);assert.ok(replay.cancellationHistory.every(e=>!e.actorId&&!e.reason));assert.equal(s.state.reservations[0].cancellationHistory.at(-1).reason,'Front desk correction');
});
test('configurable cutoff and no-credit legacy bookings do not manufacture credits',()=>{
 const s=setup();s.run('class-policy',{classId:'c',cancellationCutoffMinutes:180},undefined,staff);issue(s);const r=book(s);assert.equal(s.run('cancel',{},r.id).cancellation.classification,'late');
 const free=s.run('class',{title:'No credit',instructor:'Test',location:'Dev',capacity:2,duration:30,startsAt:'2026-10-02T12:00:00Z'},undefined,staff);const b=book(s,free.id);assert.equal(s.run('cancel',{},b.id).creditOutcome,'not_applicable');assert.equal(s.balance(),0);
 assert.throws(()=>s.run('class-policy',{classId:'c',cancellationCutoffMinutes:-1},undefined,staff));
});
