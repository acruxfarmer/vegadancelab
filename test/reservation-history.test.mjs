import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {reservationHistory,reservationHistoryHTML,reservationHistoryTypes} from '../public/reservation-history.js';
import {classCancellationOption} from '../src/class-cancellation.mjs';
const staff={role:'staff',userId:'staff',participantIds:[]},at='2026-09-23T12:00:00Z';
function fixture(){
 let n=0,s={...emptyState(),participants:[{id:'p',name:'Same Name'},{id:'q',name:'Same Name'}],classes:[{id:'c',status:'open',capacity:1,waitlistEnabled:true,creditRequired:false,startsAt:'2099-10-02T12:00:00Z'}]};
 const cmd=(action,body={},id)=>{const result=transition(s,{action,id,body:{requestId:`request-${++n}`,...body}},staff,{id:()=>`event-${++n}`,now:()=>at});s=result.state;return result.result;};
 return {cmd,data:()=>({...visibleState(s,staff,at),context:staff}),state:()=>s};
}
test('canonical promotion, attendance and cancellation evidence maps once with stable reservation identity',()=>{
 const f=fixture(),held=f.cmd('reserve',{classId:'c',participantId:'q'}),r=f.cmd('reserve',{classId:'c',participantId:'p',waitlistOnly:true});
 f.cmd('cancel',{},held.id);f.cmd('promote',{},r.id);f.cmd('attendance',{status:'present'},r.id);f.cmd('attendance',{status:'not_recorded',reason:'Clear <private> attendance'},r.id);f.cmd('cancel',{},r.id);f.cmd('correct-cancellation',{classification:'early',reason:'Already early'},r.id);
 const d=f.data(),before=structuredClone(d),h=reservationHistory(d,r.id);
 assert.deepEqual(h.events.map(x=>x.type).sort(),['attendance-change','attendance-change','cancellation','cancellation-correction','creation','waitlist-promotion']);
 assert.ok(h.events.every(e=>e.reservationId===r.id&&e.participantId==='p'&&e.occurrenceId==='c'&&reservationHistoryTypes.includes(e.type)));
 assert.ok(h.events.filter(e=>e.type==='attendance-change').every(e=>e.evidence.length===2));
 const correction=h.events.find(e=>e.type==='cancellation-correction');assert.equal(correction.outcome,'unchanged');assert.equal(correction.after.cancellationClassification,'unrecorded');assert.equal(correction.requested.cancellationClassification,'early');
 assert.equal(h.events.find(e=>e.type==='creation').after.bookingStatus,'unrecorded');assert.ok(h.unlinkedEvidence.some(e=>e.record.action==='joined'));assert.ok(h.unlinkedEvidence.some(e=>e.record.action==='promote'));
 assert.deepEqual(d,before);assert.deepEqual(reservationHistory(d,r.id),h);
 assert.ok(reservationHistory(d,held.id).events.every(e=>e.reservationId===held.id));
});
test('explicit request/actor link merges waitlist leave into cancellation without name or timestamp joins',()=>{
 const f=fixture();f.cmd('reserve',{classId:'c',participantId:'q'});const r=f.cmd('reserve',{classId:'c',participantId:'p',waitlistOnly:true});f.cmd('cancel',{},r.id);
 const d=f.data(),h=reservationHistory(d,r.id),cancel=h.events.find(e=>e.type==='cancellation');assert.equal(cancel.before.bookingStatus,'waitlisted');assert.equal(cancel.after.bookingStatus,'cancelled');assert.equal(h.events.filter(e=>e.type==='cancellation').length,1);assert.ok(cancel.evidence.some(e=>e.source==='waitlistHistory'));
 d.reservations.find(x=>x.id===r.id).waitlistHistory.find(x=>x.action==='left').requestId='different';const changed=reservationHistory(d,r.id);assert.equal(changed.events.find(e=>e.type==='cancellation').before.bookingStatus,'unrecorded');assert.ok(changed.unlinkedEvidence.some(e=>e.record.action==='left'));
});
test('occurrence cancellation projects only explicitly affected reservation and merges closed waitlist evidence',()=>{
 const f=fixture(),held=f.cmd('reserve',{classId:'c',participantId:'q'}),waiting=f.cmd('reserve',{classId:'c',participantId:'p',waitlistOnly:true});const s=f.state();f.cmd('cancel-class',{classId:'c',reason:'Class closed',impactToken:classCancellationOption(s,s.classes[0],at).impactToken});
 const h=reservationHistory(f.data(),waiting.id),e=h.events.find(e=>e.type==='cancellation');assert.equal(e.before.bookingStatus,'waitlisted');assert.equal(e.after.bookingStatus,'cancelled');assert.equal(e.evidence.filter(x=>x.source==='occurrence.cancellationHistory').length,1);assert.ok(!JSON.stringify(h).includes(held.id));
});
test('missing snapshots stay unrecorded and current status never replaces historical values',()=>{
 const d={context:staff,classes:[{id:'c'}],participants:[],reservations:[{id:'r',classId:'c',participantId:'p',status:'cancelled',attendanceStatus:'present'}],activity:[]};
 assert.equal(reservationHistory(d,'r').events.length,0);d.reservations[0].createdAt=at;const creation=reservationHistory(d,'r').events[0];assert.equal(creation.actor.id,'unrecorded');assert.equal(creation.after.bookingStatus,'unrecorded');assert.equal(creation.after.attendanceStatus,'unrecorded');
});
test('identity deduplication, conflicts, anonymous evidence, tie ordering and missing timestamps are deterministic',()=>{
 const f=fixture(),r=f.cmd('reserve',{classId:'c',participantId:'p'});f.cmd('attendance',{status:'present'},r.id);const d=f.data(),row=d.reservations[0],original=structuredClone(row.attendanceHistory[0]);row.attendanceHistory.push(structuredClone(original));let h=reservationHistory(d,r.id);assert.equal(h.events.filter(x=>x.type==='attendance-change').length,1);
 row.attendanceHistory.push({...original,to:'absent'});h=reservationHistory(d,r.id);const change=h.events.find(x=>x.type==='attendance-change');assert.equal(change.after.attendanceStatus,'unrecorded');assert.deepEqual(change.conflicts.afterAttendance.sort(),['absent','present']);
 row.attendanceHistory.push({from:'not_recorded',to:'present'},{from:'not_recorded',to:'present'});h=reservationHistory(d,r.id);assert.equal(h.events.filter(x=>x.type==='attendance-change').length,3);assert.equal(new Set(h.events.map(e=>e.eventId)).size,h.events.length);assert.equal(h.events.at(-1).recordedAt,'unrecorded');
 row.attendanceHistory.reverse();d.activity.reverse();assert.deepEqual(reservationHistory(d,r.id),h);
});
test('ambiguous links, dangling attendance references and unrelated actions remain honest and scoped',()=>{
 const f=fixture();f.cmd('reserve',{classId:'c',participantId:'q'});const r=f.cmd('reserve',{classId:'c',participantId:'p',waitlistOnly:true});f.cmd('cancel',{},r.id);const d=f.data(),row=d.reservations.find(x=>x.id===r.id);row.cancellationHistory.push({...row.cancellationHistory[0],id:'second-identity'});d.activity.push({id:'dangling',subjectId:r.id,action:'attendance',attendanceHistoryId:'missing'});d.activity.push({id:'foreign',subjectId:'foreign-reservation',action:'cancel',reason:'foreign secret'});
 const h=reservationHistory(d,r.id);assert.ok(h.unlinkedEvidence.some(e=>e.relationship.includes('Ambiguous')));assert.ok(h.unlinkedEvidence.some(e=>e.record.id==='dangling'));assert.ok(!JSON.stringify(h).includes('foreign secret'));
});
test('blocked correction retains requested classification without claiming it became applied history',()=>{
 const f=fixture(),r=f.cmd('reserve',{classId:'c',participantId:'p'});f.cmd('cancel',{},r.id);const d=f.data();d.reservations[0].cancellationHistory.push({id:'blocked',action:'correction',from:'early',to:'late',outcome:'blocked',creditOutcome:'blocked_spent',createdAt:at});const e=reservationHistory(d,r.id).events.find(x=>x.type==='cancellation-correction');assert.equal(e.outcome,'blocked');assert.equal(e.creditOutcome,'blocked_spent');assert.equal(e.requested.cancellationClassification,'late');assert.equal(e.after.cancellationClassification,'unrecorded');
});
test('member/missing occurrence exclusion and escaped read-only rendering',()=>{
 const f=fixture(),r=f.cmd('reserve',{classId:'c',participantId:'p'});f.cmd('attendance',{status:'present',reason:'<script>secret</script>'},r.id);const d=f.data(),escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 assert.deepEqual(reservationHistory({...d,context:{role:'member'}},r.id).events,[]);assert.equal(reservationHistoryHTML({...d,context:{role:'member'}},r.id,escape),'');assert.deepEqual(reservationHistory({...d,classes:[]},r.id).events,[]);
 const html=reservationHistoryHTML(d,r.id,escape);assert.ok(html.includes('&lt;script&gt;secret'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<form'));assert.ok(!html.includes('Save attendance'));
});
