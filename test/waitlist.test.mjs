import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {orderedWaitlist,promotionOptions} from '../src/waitlist.mjs';
import {auditRecords} from '../public/reporting-audit.js';
import {memberBookingUI} from '../public/member-booking.js';
const staff={userId:'desk',role:'staff',participantIds:[]},member=id=>({userId:`user-${id}`,role:'member',participantIds:[id]});
let n=0;const opts={id:()=>`id-${String(++n).padStart(5,'0')}`,now:()=> '2026-09-23T12:00:00Z'};
const cmd=(action,body={},id)=>({action,id,body:{requestId:`request-${++n}`,...body}});
const act=(s,action,body={},id,actor=staff)=>transition(s,cmd(action,body,id),actor,opts);
function fixture(){let s={...emptyState(),participants:['occupant','a','b','c'].map(id=>({id,name:id})),classes:[{id:'class',title:'Full class',status:'open',startsAt:'2099-10-01T12:00:00Z',capacity:1,waitlistEnabled:true,creditRequired:true}]};for(const participantId of ['occupant','a','b'])s=act(s,'issue-credit',{participantId,quantity:2,reason:'Synthetic fixture'}).state;return act(s,'reserve',{classId:'class',participantId:'occupant'}).state;}
const join=(s,p)=>act(s,'reserve',{classId:'class',participantId:p,waitlistOnly:true},undefined,member(p));
const release=s=>act(s,'cancel',{},s.reservations.find(r=>r.participantId==='occupant').id).state;
test('member join and leave reserve no seat, spend no credit, preserve lineage and isolate other members',()=>{
 const before=fixture(),joined=join(before,'a'),r=joined.result;assert.equal(r.status,'waitlisted');assert.equal(r.waitlistHistory[0].actorId,undefined);
 assert.deepEqual(joined.state.creditUnits,before.creditUnits);assert.deepEqual(joined.state.creditEvents,before.creditEvents);assert.equal(joined.state.reservations.filter(r=>r.status==='reserved').length,1);
 assert.throws(()=>join(joined.state,'a'),/Already/);
 const v=visibleState(joined.state,member('a'));assert.equal(v.reservations.length,1);assert.equal(v.reservations[0].waitlistPosition,1);assert.equal(v.promotionOptions,undefined);assert.equal(v.reservations[0].waitlistHistory[0].actorId,undefined);
 assert.throws(()=>act(joined.state,'cancel',{expectedReservationStatus:'waitlisted'},r.id,member('b')),e=>e.status===403);
 const left=act(joined.state,'cancel',{expectedReservationStatus:'waitlisted'},r.id,member('a'));assert.equal(left.result.status,'cancelled');assert.deepEqual(left.state.creditUnits,before.creditUnits);assert.deepEqual(left.state.creditEvents,before.creditEvents);
 assert.deepEqual(left.state.reservations.find(x=>x.id===r.id).waitlistHistory.map(h=>h.action),['joined','left']);assert.deepEqual(act(left.state,'cancel',{expectedReservationStatus:'waitlisted'},r.id,member('a')).state,left.state);
 const rejoined=join(left.state,'a');assert.notEqual(rejoined.result.id,r.id);assert.equal(rejoined.result.status,'waitlisted');
});
test('waitlist intent never falls through to paid booking and invalid classes or malformed intent fail safely',()=>{
 const s=fixture();assert.throws(()=>act(release(s),'reserve',{classId:'class',participantId:'a',waitlistOnly:true},undefined,member('a')),e=>e.status===409);
 assert.throws(()=>act(s,'reserve',{classId:'class',participantId:'a',waitlistOnly:'true'}),/intent/);
 for(const patch of [{waitlistEnabled:false},{status:'closed'},{startsAt:'2000-01-01'},{capacity:0}]){const bad=structuredClone(s);Object.assign(bad.classes[0],patch);assert.throws(()=>join(bad,'a'));}
});
test('deterministic earliest eligible promotion consumes exactly once, preserves identity and prevents stale leave',()=>{
 let s=fixture();for(const p of ['c','a','b'])s=join(s,p).state;s=release(s);
 const queue=orderedWaitlist(s,'class');assert.deepEqual(queue.map(r=>r.participantId),['c','a','b']);
 const choices=promotionOptions(s,s.classes[0],opts.now());assert.equal(choices[0].eligible,false);assert.equal(choices[1].promotable,true);assert.equal(choices[2].promotable,false);
 assert.throws(()=>act(s,'promote',{},queue[2].id),/earlier eligible/);assert.throws(()=>act(s,'promote',{},queue[1].id,member('a')),e=>e.status===403);
 const before=structuredClone(s),promoted=act(s,'promote',{passId:choices[1].passId},queue[1].id);s=promoted.state;
 assert.equal(promoted.result.id,queue[1].id);assert.equal(promoted.result.status,'reserved');assert.equal(promoted.result.paymentStatus,'not_evaluated');assert.equal(promoted.result.attendanceStatus,'not_recorded');
 assert.equal(s.creditEvents.length,before.creditEvents.length+1);assert.equal(s.creditEvents.at(-1).type,'consume');assert.deepEqual(act(s,'promote',{},queue[1].id).state,s);
 assert.throws(()=>act(s,'cancel',{expectedReservationStatus:'waitlisted'},queue[1].id,member('a')),/no longer waitlisted/);
 assert.throws(()=>act(s,'promote',{},queue[2].id),/capacity/);
 const records=auditRecords({...s,context:staff}).filter(r=>r.bookingId===queue[1].id);assert.deepEqual(records.map(r=>r.type).sort(),['consume','waitlist-joined','waitlist-promoted']);
 const attended=act(s,'attendance',{status:'present'},queue[1].id);assert.deepEqual(attended.state.creditEvents,s.creditEvents);
});
test('promotion rechecks expired, future, restricted and spent credits and queue order at confirmation',()=>{
 for(const invalid of ['expired','future','restricted','spent']){
  let s=release(join(fixture(),'a').state),r=s.reservations.find(r=>r.participantId==='a');
  for(const u of s.creditUnits.filter(u=>u.participantId==='a')){if(invalid==='expired')u.entitlement.expiresAt='2026-01-01';if(invalid==='future')u.entitlement.validFrom='2099-12-01';if(invalid==='restricted')u.entitlement.classIds=['other'];if(invalid==='spent')u.status='spent';}
  assert.throws(()=>act(s,'promote',{},r.id),/eligible class credit/);
 }
 const s=release(join(fixture(),'a').state),r=s.reservations.find(r=>r.participantId==='a');assert.throws(()=>act(s,'promote',{passId:'stale'},r.id),/credit changed/);
});
test('member presentation distinguishes waiting from confirmed booking and exposes no staff promotion controls',()=>{
 const s=join(fixture(),'a').state,d={...visibleState(s,member('a'),opts.now()),context:member('a')};
 const ui=memberBookingUI({getData:()=>d,escape:s=>String(s??''),date:()=> 'future',time:()=> 'noon'}),html=ui.render('bookings');
 assert.match(html,/Waitlisted · Position 1/);assert.match(html,/Leave waitlist/);assert.match(html,/Waiting consumes no credit/);assert.doesNotMatch(html,/Confirm promotion|desk|user-b/);
});
