import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {cancellationNoticesHTML} from '../public/cancellation-notices.js';
const staff={userId:'staff',role:'staff',participantIds:[]},member={userId:'member',role:'member',participantIds:['p']};
let seq=0;const now=()=> '2026-09-23T12:00:00Z',id=()=>`id-${++seq}`;
const run=(s,action,body={},key,actor=staff)=>transition(s,{action,id:key,body:{requestId:id(),...body}},actor,{id,now});
function fixture(paid=true){
 let s={...emptyState(),participants:['p','q','old'].map(id=>({id,name:'Same name'})),classes:[{id:'c',title:'Original <class>',instructor:'Teacher',location:'Room A',duration:45,category:'Dance',startsAt:'2099-10-02T12:00:00Z',capacity:1,status:'open',waitlistEnabled:true,creditRequired:paid}],reservations:[{id:'old',classId:'c',participantId:'old',status:'cancelled',attendanceStatus:'not_recorded'}]};
 if(paid)s=run(s,'issue-credit',{participantId:'p',quantity:1,reason:'fixture'}).state;
 s=run(s,'reserve',{classId:'c',participantId:'p'}).state;
 s=run(s,'reserve',{classId:'c',participantId:'q',waitlistOnly:true}).state;
 return s;
}
const body=s=>({classId:'c',reason:'PRIVATE ADMIN NOTE',impactToken:visibleState(s,staff,now()).classCancellationOptions[0].impactToken});
test('cancellation notices snapshot each actual effect, preserve prior cancelled rows and preview purity',()=>{
 for(const paid of [true,false]){
  const s=fixture(paid),before=structuredClone(s),b=body(s);assert.deepEqual(s,before);assert.equal(visibleState(s,staff,now()).classCancellationOptions[0].expectedNotices,2);
  const out=run(s,'cancel-class',b),ns=out.state.notifications;assert.equal(ns.length,2);assert.deepEqual(s,before);assert.deepEqual(out.state.reservations[0],before.reservations[0]);assert.deepEqual(out.result.noticeIds,ns.map(n=>n.id));
  for(const n of ns){assert.equal(n.cancellationEventId,out.result.eventId);assert.equal(n.occurrenceId,'c');assert.equal(n.reservationId,out.state.reservations.find(r=>r.participantId===n.participantId).id);assert.equal(n.deliveryStatus,'disabled');assert.equal(n.classSnapshot.title,'Original <class>');assert.equal(n.reservationSnapshot.to,'cancelled');assert.doesNotMatch(JSON.stringify(n),/PRIVATE ADMIN NOTE/);}
  const p=ns.find(n=>n.participantId==='p'),q=ns.find(n=>n.participantId==='q');assert.equal(p.reservationSnapshot.from,'reserved');assert.equal(q.reservationSnapshot.from,'waitlisted');assert.equal(p.creditSnapshot.outcome,paid?'restored':'not_applicable');assert.equal(p.creditSnapshot.quantity,paid?1:0);assert.equal(q.creditSnapshot.outcome,'not_applicable');assert.equal(q.creditSnapshot.quantity,0);
  if(paid){const e=out.state.creditEvents.find(e=>e.id===p.creditSnapshot.creditEventId);assert.equal(e.type,'restore');assert.equal(e.unitId,p.creditSnapshot.restoredCreditUnitId);assert.equal(e.classCancellationEventId,out.result.eventId);}
  assert.deepEqual(run(out.state,'cancel-class',b).state,out.state);
 }
});
test('empty occurrence creates no notice, historical cancellations are not backfilled and rejected commands preserve state',()=>{
 const s=fixture(false);s.reservations=s.reservations.slice(0,1);const done=run(s,'cancel-class',body(s)).state;assert.equal(done.notifications.length,0);
 const populated=fixture(),original=structuredClone(populated);assert.throws(()=>run(populated,'cancel-class',body(populated),undefined,member),/Staff/);assert.throws(()=>run(populated,'cancel-class',{...body(populated),impactToken:'stale'}),/changed/);assert.deepEqual(populated,original);
 const legacy=run(populated,'cancel-class',body(populated)).state;legacy.notifications=[];assert.deepEqual(run(legacy,'cancel-class',body(legacy)).state,legacy);
});
test('failure constructing a later notice leaves all input reservations, credits and history intact',()=>{
 const s=fixture(false),before=structuredClone(s);let i=0;
 // event, first cancellation history, first notice, second cancellation history,
 // waitlist-close evidence, then second notice fails.
 assert.throws(()=>transition(s,{action:'cancel-class',body:{...body(s),requestId:'failure'}},staff,{now,id:()=>{if(++i===6)throw Error('second notice failure');return `failure-${i}`;}}),/second notice failure/);assert.deepEqual(s,before);
});
test('authority, immutable snapshots and escaped presentation keep promotion and cancellation independently readable',()=>{
 let s=fixture(false);const p=s.reservations.find(r=>r.participantId==='p');s=run(s,'cancel',{},p.id).state;const q=s.reservations.find(r=>r.participantId==='q');s=run(s,'promote',{},q.id).state;
 const promotion=structuredClone(s.notifications[0]);s=run(s,'cancel-class',body(s)).state;assert.deepEqual(s.notifications[0],promotion);assert.equal(s.reservations.find(r=>r.id===q.id).promotionNoticeId,promotion.id);
 const notice=structuredClone(s.notifications[1]);s.classes[0].title='Current changed title';s.classes[0].location='Current room';
 s.notifications.push({...notice,id:'draft',status:'draft'},{...notice,id:'other',participantId:'old'});
 const delegated={...member,participantIds:['p','q']},v=visibleState(s,delegated,now());assert.equal(v.notifications.length,2);assert.equal(visibleState(s,member,now()).notifications.length,0);assert.deepEqual(s.notifications[1],notice);
 const e=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),html=cancellationNoticesHTML({...v,context:delegated},e);
 assert.match(html,/Original &lt;class&gt;/);assert.match(html,/Your booked place was cancelled/);assert.match(html,/Current booking: cancelled/);assert.doesNotMatch(html,/PRIVATE ADMIN NOTE|Current changed title|Current room|<class>|<button|<form/);assert.match(html,/No email or SMS/);
 assert.equal(cancellationNoticesHTML({...v,context:staff},e,'other-class'),'');
 const waitingBefore=fixture(),waiting=run(waitingBefore,'cancel-class',body(waitingBefore)).state;const qview=visibleState(waiting,{...member,participantIds:['q']},now());assert.match(cancellationNoticesHTML({...qview,context:{...member,participantIds:['q']}},e),/Your waitlist entry was closed/);
});
