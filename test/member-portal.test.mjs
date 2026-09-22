import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleState} from '../src/application.mjs';
import {eligibleCredits} from '../src/entitlements.mjs';
import {memberBookingUI} from '../public/member-booking.js';
import {portalFixture,portalActor} from '../scripts/member-portal-fixture.mjs';
const at='2030-01-15T12:00:00Z';
const fixture=()=>portalFixture(Date.parse(at));
const render=(state,page)=>memberBookingUI({getData:()=>({...visibleState(state,portalActor,at),context:portalActor}),escape:s=>String(s).replaceAll('<','&lt;'),date:String,time:String}).render(page);
test('available-now excludes expired and future units, preserves restricted and restored provenance without mutation',()=>{
 const s=fixture(),before=structuredClone(s),v=visibleState(s,portalActor,at);
 assert.equal(v.memberAccount.available,2);
 assert.equal(v.memberAccount.passes.find(p=>p.passId==='pack').restored,1);
 assert.equal(v.memberAccount.passes.find(p=>p.passId==='expired').expired,1);
 assert.equal(v.memberAccount.passes.find(p=>p.passId==='future').future,1);
 assert.equal(eligibleCredits(s,{id:'next',category:'Dance',startsAt:at},'p',at).length,2);
 assert.equal(eligibleCredits(s,{id:'next',category:'Other',startsAt:at},'p',at).length,1);
 assert.deepEqual(s,before);
});
test('validity boundaries agree with booking selector, including class date beyond expiry',()=>{
 const s=fixture(),end=s.passes[0].entitlement.expiresAt;
 assert.equal(visibleState(s,portalActor,end).memberAccount.passes.find(p=>p.passId==='pack').available,0);
 assert.equal(eligibleCredits(s,{id:'next',category:'Dance',startsAt:end},'p',at,'pack').length,0);
 const start=s.passes[2].entitlement.validFrom;
 assert.equal(visibleState(s,portalActor,start).memberAccount.passes.find(p=>p.passId==='future').available,1);
});
test('portal history distinguishes attendance from booking and includes clear cancellation outcomes',()=>{
 const s=fixture();s.classes.forEach(c=>{c.startsAt=c.id==='next'?'2099-01-01T00:00:00Z':'2020-01-01T00:00:00Z'});
 const html=render(s,'today');
 for(const text of ['Your Vega account','Upcoming dance','Attended','Marked absent','attendance not recorded','Early cancellation','Late cancellation','1 credit was restored','remains spent','Recent booking & cancellation activity']){
  assert.ok(html.includes(text),text);
 }
 assert.match(html,/2 credits available now/);assert.match(html,/1 expired/);assert.match(html,/1 not yet valid/);assert.match(html,/restored after cancellation/);
});
test('member portal and summaries never include another member or staff audit; staff view stays unchanged',()=>{
 const s=fixture(),v=visibleState(s,portalActor,at);assert.doesNotMatch(JSON.stringify(v),/PRIVATE|foreign-reservation|OTHER PASS/);
 assert.doesNotMatch(render(s,'today'),/PRIVATE|foreign-reservation/);
 const staff=visibleState(s,{role:'staff',participantIds:[]},at);assert.equal(staff.memberAccount,undefined);assert.equal(staff.activity[0].message,'PRIVATE STAFF AUDIT');
});
test('empty and missing historical details are honest and untrusted titles are escaped',()=>{
 const s=fixture();s.classes[0].title='<script>bad</script>';assert.doesNotMatch(render(s,'today'),/<script>/);
 s.reservations=[];s.passes=[];s.creditUnits=[];const html=render(s,'today');assert.match(html,/No upcoming bookings/);assert.match(html,/No past classes/);assert.match(html,/No credits or entitlements/);assert.match(html,/No dated booking/);
});
