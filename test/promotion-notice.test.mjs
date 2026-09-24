import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {promotionNoticesHTML} from '../public/promotion-notices.js';
const staff={userId:'staff',role:'staff',participantIds:[]},member={userId:'member',role:'member',participantIds:['p']};
let serial=0;
const run=(s,action,body={},id,actor=staff)=>transition(s,{action,id,body:{requestId:'req-'+(++serial),...body}},actor,{id:()=> 'id-'+(++serial),now:()=> '2026-09-23T12:00:00Z'});
function fixture(paid=false){let s={...emptyState(),participants:[{id:'p',name:'Same'},{id:'q',name:'Same'}],classes:[{id:'c',title:'Original <class>',instructor:'Teacher',location:'Room A',duration:45,category:'Dance',startsAt:'2099-10-02T12:00:00Z',capacity:1,status:'open',waitlistEnabled:true,creditRequired:paid}],reservations:[{id:'r',classId:'c',participantId:'p',status:'waitlisted',attendanceStatus:'not_recorded',paymentStatus:'not_evaluated',notificationStatus:'not_requested',createdAt:'2026-09-22T12:00:00Z'}]};if(paid)s=run(s,'issue-credit',{participantId:'p',quantity:1,reason:'fixture'}).state;return s;}
test('promotion persists one linked notice with recorded context for paid and free classes; repeated promotion does not backfill',()=>{
 for(const paid of [false,true]){const original=fixture(paid),copy=structuredClone(original),out=run(original,'promote',{},'r'),n=out.state.notifications[0];assert.deepEqual(original,copy);assert.equal(out.state.notifications.length,1);assert.equal(n.promotionEventId,out.result.waitlistHistory.at(-1).id);assert.equal(n.reservationId,'r');assert.equal(n.participantId,'p');assert.equal(n.occurrenceId,'c');assert.equal(n.id,out.result.promotionNoticeId);assert.equal(out.result.notificationStatus,'in_app_available');assert.equal(n.deliveryStatus,'disabled');assert.equal(n.creditSnapshot.quantity,paid?1:0);assert.equal(n.classSnapshot.title,'Original <class>');assert.deepEqual(run(out.state,'promote',{},'r').state,out.state);
 const legacy=structuredClone(out.state);legacy.notifications=[];delete legacy.reservations[0].promotionNoticeId;assert.deepEqual(run(legacy,'promote',{},'r').state,legacy);
 }
});
test('rejected promotion and notice construction failure cannot mutate input or consume credit',()=>{
 const s=fixture(true),before=structuredClone(s);assert.throws(()=>run(s,'promote',{},'r',member),/Staff/);assert.throws(()=>run(s,'promote',{passId:'stale'},'r'),/changed/);assert.deepEqual(s,before);
 let count=0;assert.throws(()=>transition(fixture(),{action:'promote',id:'r',body:{requestId:'x'}},staff,{id:()=>{if(++count===2)throw Error('notice unavailable');return 'event';},now:()=> '2026-09-23T12:00:00Z'}),/notice unavailable/);
});
test('published notices follow participant authority including delegated profiles; drafts and other participants excluded',()=>{
 const s=run(fixture(),'promote',{},'r').state;s.notifications.push({...s.notifications[0],id:'other',participantId:'q'},{...s.notifications[0],id:'draft',status:'draft'});
 assert.deepEqual(visibleState(s,member).notifications.map(n=>n.id),[s.notifications[0].id]);assert.equal(visibleState(s,{...member,participantIds:[]}).notifications.length,0);assert.equal(visibleState(s,{...member,participantIds:['p','q']}).notifications.length,2);
});
test('notice snapshots survive later class changes and cancellation; UI separates current state and does not imply delivery',()=>{
 let s=run(fixture(),'promote',{},'r').state;const notice=structuredClone(s.notifications[0]);s.classes[0].title='Changed';s.classes[0].location='Room B';s=run(s,'cancel',{},'r').state;assert.deepEqual(s.notifications[0],notice);
 const d={...visibleState(s,member),context:member},escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');const html=promotionNoticesHTML(d,escape);assert.match(html,/Original &lt;class&gt;/);assert.match(html,/Room A/);assert.doesNotMatch(html,/Room B|Changed|<class>/);assert.match(html,/Current booking: cancelled/);assert.match(html,/No email or SMS sent/);assert.doesNotMatch(html,/<form|<button/);assert.equal(promotionNoticesHTML({...d,context:{...member,participantIds:['q']}},escape),'');
});
