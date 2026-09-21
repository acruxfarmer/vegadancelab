import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';

const staff={userId:'synthetic-staff',role:'staff',participantIds:[]};
const member={userId:'synthetic-member',role:'member',participantIds:['a']};
const opts={id:()=>crypto.randomUUID(),now:()=> '2026-09-21T12:00:00Z'};
const cmd=(action,body={},id)=>({action,id,body:{requestId:crypto.randomUUID(),...body}});
function fixture(){const s=emptyState();s.participants=[{id:'a'},{id:'b'}];s.classes=[{id:'c',status:'open',capacity:1,startsAt:'2026-10-01T12:00:00Z',waitlistEnabled:true}];return s;}

test('waitlist promotion applies the same occurrence availability boundary as reservation',()=>{
 const s=fixture();s.classes[0].startsAt='2026-09-20T12:00:00Z';
 s.reservations=[{id:'wait-a',classId:'c',participantId:'a',status:'waitlisted'}];
 assert.throws(()=>transition(s,cmd('promote',{},'wait-a'),staff,opts),e=>e.status===409);
 assert.equal(s.reservations[0].status,'waitlisted');
});

test('repeated cancellation releases one seat without changing independent outcomes',()=>{
 const booked=transition(fixture(),cmd('reserve',{classId:'c',participantId:'a'}),member,opts);
 const cancelled=transition(booked.state,cmd('cancel',{},booked.result.id),member,opts);
 const repeated=transition(cancelled.state,cmd('cancel',{},booked.result.id),member,opts);
 assert.equal(repeated.state.reservations.length,1);
 assert.equal(visibleState(repeated.state,staff).classes[0].reservedCount,0);
 assert.equal(repeated.result.paymentStatus,'not_evaluated');
 assert.equal(repeated.result.notificationStatus,'not_requested');
});

test('other participant cancellation cannot mutate their record',()=>{
 const booked=transition(fixture(),cmd('reserve',{classId:'c',participantId:'b'}),staff,opts);
 assert.throws(()=>transition(booked.state,cmd('cancel',{},booked.result.id),member,opts),e=>e.status===403);
 assert.equal(booked.state.reservations[0].status,'reserved');
});
