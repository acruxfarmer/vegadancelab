import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceReport,reportAllowed,reportDay,reportWeek} from '../public/attendance-report.js';
import {attendanceReportUI} from '../public/attendance-report-ui.js';
import {staffRuntimeFixture,staffIds as ids,scopes} from './helpers/staff-runtime-fixture.mjs';
const scope={tenantId:'a',businessId:'studio',userId:'owner'};
const occurrence=(id,extra={})=>({id,title:id,instructor:'Alex',startsAt:'2026-09-21T18:00:00Z',duration:60,capacity:4,status:'open',...extra});
const booking=(id,classId,attendanceStatus='present',extra={})=>({id,classId,participantId:id,status:'reserved',attendanceStatus,...extra});
const data=(classes,reservations=[])=>({context:{...scope,role:'staff'},staffAccess:{...scope,permissions:['reports.read']},classes,reservations});
const report=(d,opts={})=>attendanceReport(d,{now:'2026-10-06T20:00:00Z',timeZone:'America/Los_Angeles',...opts});
test('full, partial and empty classes retain separate capacity, booked and attendance totals',()=>{
 const d=data([occurrence('full'),occurrence('partial'),occurrence('empty')],[...Array.from({length:4},(_,i)=>booking('f'+i,'full')),booking('p','partial'),booking('a','partial','absent'),booking('u','partial','not_recorded')]);
 const r=report(d);assert.equal(r.summary.capacity,12);assert.equal(r.summary.booked,7);assert.equal(r.summary.attended,5);assert.equal(r.summary.noShows,1);assert.equal(r.summary.unrecorded,1);assert.equal(r.summary.utilization,100*5/12);assert.equal(r.rows.find(x=>x.id==='full').utilization,100);assert.equal(r.rows.find(x=>x.id==='empty').utilization,0);assert.equal(r.ranked.length,2);
});
test('over-capacity and negative/missing capacity preserve counts but suppress misleading rates',()=>{
 for(const capacity of [1,-1,undefined]){const r=report(data([occurrence('c',{capacity})],[booking('a','c'),booking('b','c')]));assert.equal(r.summary.booked,2);assert.equal(r.summary.utilization,null);assert.equal(r.summary.utilizationState,'unavailable');assert.equal(r.summary.bookingFillState,'unavailable');assert.ok(r.rows[0].quality.length);}
 assert.equal(report(data([occurrence('zero',{capacity:0})])).summary.utilizationState,'not-applicable');
});
test('cancelled classes are separately counted and never dilute active attendance utilization',()=>{
 const r=report(data([occurrence('active',{capacity:1}),occurrence('cancelled',{status:'cancelled',capacity:100})],[booking('a','active'),booking('c','cancelled','not_recorded',{status:'cancelled',cancellation:{classification:'early'}})]));
 assert.equal(r.summary.classes,2);assert.equal(r.summary.cancelledClasses,1);assert.equal(r.summary.capacity,1);assert.equal(r.summary.utilization,100);assert.equal(r.summary.early,1);assert.equal(r.rows.find(x=>x.cancelled).utilizationState,'not-applicable');
});
test('early, late and unknown booking cancellations remain distinct from no-shows',()=>{
 const r=report(data([occurrence('c')],[booking('early','c','not_recorded',{status:'cancelled',cancellation:{classification:'early'}}),booking('late','c','not_recorded',{status:'cancelled',cancellation:{classification:'late'}}),booking('legacy','c','not_recorded',{status:'cancelled'}),booking('unrecorded','c','not_recorded')]));
 assert.equal(r.summary.early,1);assert.equal(r.summary.late,1);assert.equal(r.summary.unclassified,1);assert.equal(r.summary.noShows,0);assert.equal(r.summary.unrecorded,1);assert.equal(r.summary.booked,1);
});
test('future and in-progress classes have no attendance utilization or no-shows yet',()=>{
 for(const startsAt of ['2026-10-06T19:30:00Z','2099-01-01T00:00:00Z']){const r=report(data([occurrence('c',{startsAt})],[booking('a','c','absent')]));assert.equal(r.summary.noShows,0);assert.equal(r.summary.attended,0);assert.equal(r.summary.utilizationState,'not-applicable');assert.equal(r.summary.booked,1);}
});
test('waitlist demand counts distinct supported entries and promotions without consuming booked seats',()=>{
 const r=report(data([occurrence('c')],[booking('waiting','c','not_recorded',{status:'waitlisted'}),booking('promoted','c','present',{waitlistHistory:[{action:'joined'},{action:'promoted'},{action:'promoted'}]}),booking('left','c','not_recorded',{status:'cancelled',waitlistHistory:[{action:'joined'},{action:'left'}]})]));
 assert.equal(r.summary.waiting,1);assert.equal(r.summary.demand,3);assert.equal(r.summary.promoted,1);assert.equal(r.summary.booked,1);
});
test('instructor and weekly comparisons use weighted rates and the same filtered occurrences',()=>{
 const d=data([occurrence('a',{instructor:'Alex',capacity:1}),occurrence('b',{instructor:'Blair',capacity:9,startsAt:'2026-09-22T18:00:00Z'})],[booking('a','a'),booking('b','b')]);
 const r=report(d,{group:'week'});assert.equal(r.trends.length,1);assert.equal(r.trends[0].period,'2026-09-21');assert.equal(r.trends[0].utilization,20);assert.equal(r.instructors.length,2);assert.equal(report(d,{instructor:'Alex'}).summary.utilization,100);assert.equal(report(d,{from:'2026-09-22',to:'2026-09-22'}).summary.classes,1);
});
test('business calendar day/week grouping handles timezone boundaries and DST without browser timezone',()=>{
 assert.equal(reportDay('2026-09-22T01:00:00Z','America/Los_Angeles'),'2026-09-21');assert.equal(reportDay('2026-11-01T09:30:00Z','America/Los_Angeles'),'2026-11-01');assert.equal(reportWeek('2026-11-01'),'2026-10-26');assert.equal(reportWeek('2026-11-02'),'2026-11-02');
 const d=data([occurrence('c',{startsAt:'2026-09-22T01:00:00Z'})]);assert.equal(report(d,{from:'2026-09-21',to:'2026-09-21'}).rows.length,1);assert.equal(report(d,{from:'2026-09-22',to:'2026-09-22'}).rows.length,0);
});
test('unavailable, zero and not applicable are distinct; invalid ranges never masquerade as empty data',()=>{
 assert.equal(report(data([])).summary.utilizationState,'not-applicable');assert.equal(report(data([occurrence('empty')])).summary.utilization,0);
 assert.equal(report(data([occurrence('unknown',{duration:undefined})])).summary.utilizationState,'unavailable');
 for(const opts of [{from:'2026-02-30'},{from:'2026-10-02',to:'2026-10-01'},{timeZone:'Not/AZone'},{group:'year'}])assert.ok(report(data([]),opts).error);
});
test('duplicate, unknown and orphaned records are flagged rather than presented as clean metrics',()=>{
 let r=report(data([occurrence('c')],[booking('same','c'),booking('same','c'),booking('orphan','missing')]));assert.equal(r.summary.attended,null);assert.equal(r.summary.utilizationState,'unavailable');assert.equal(r.orphanBookings,1);
 r=report(data([occurrence('c')],[booking('x','c','present',{status:'invalid'})]));assert.equal(r.summary.booked,null);
 r=report(data([occurrence('bad-date',{startsAt:'bad'})]));assert.equal(r.missingDates,1);assert.equal(r.summary.utilizationState,'unavailable');
});
test('scope mismatch and unauthorized role projections deny; explicit foreign records are excluded',()=>{
 const d=data([occurrence('a'),occurrence('foreign',{businessId:'foreign'})]);assert.equal(report(d).summary.classes,1);
 for(const change of [x=>x.context.role='member',x=>x.staffAccess.permissions=[],x=>x.staffAccess.businessId='foreign',x=>x.staffAccess.userId='other']){const v=structuredClone(d);change(v);assert.equal(reportAllowed(v),false);assert.ok(report(v).error);}
});
test('real application corrections update report facts without changing unrelated business records',async()=>{
 const h=staffRuntimeFixture(),second=structuredClone(h.records.get('studio-b'));
 const read=async()=>attendanceReport(await h.store.read(h.identity()),{now:'2100-01-01T00:00:00Z'});
 assert.equal((await read()).summary.attended,0);await h.command(ids.owner,'attendance',{status:'present',expectedRevision:0},'booking-one');assert.equal((await read()).summary.attended,1);
 await h.command(ids.owner,'attendance',{status:'absent',expectedRevision:1,reason:'Correction'},'booking-one');assert.equal((await read()).summary.attended,0);assert.equal((await read()).summary.noShows,1);
 const before=structuredClone(h.records);await read();assert.deepEqual(h.records,before);assert.deepEqual(h.records.get('studio-b'),second);
});
test('second business reuses the report under independent role assignments; members and limited staff stay bounded',async()=>{
 const h=staffRuntimeFixture();await h.command(ids.worker,'staff-register',{name:'Manager'});await h.role('manager');
 await h.command(ids.worker,'staff-register',{name:'Instructor'},undefined,scopes[1]);await h.role('instructor',['class-one'],scopes[1]);
 assert.equal(reportAllowed(await h.store.read(h.identity(ids.worker))),true);assert.equal(reportAllowed(await h.store.read(h.identity(ids.worker,scopes[1]))),false);
 assert.equal(attendanceReport(await h.store.read(h.identity(ids.owner,scopes[1])),{now:'2100-01-01T00:00:00Z'}).summary.classes,2);
 await h.role('front_desk');assert.equal(reportAllowed(await h.store.read(h.identity(ids.worker))),false);assert.equal(reportAllowed(await h.store.read(h.identity(ids.member))),false);
 await assert.rejects(h.store.read(h.identity(ids.owner,{tenantId:'a',businessId:'studio-b'})),e=>e.status===403);
});
test('report rendering and date controls are read-only and expose useful definitions',()=>{
 const callbacks={};globalThis.document={addEventListener:(k,f)=>callbacks[k]=f};let d=data([occurrence('c')]),html;
 const ui=attendanceReportUI({getData:()=>d,escape:s=>String(s??''),render:()=>html=ui.render()});html=ui.render();
 callbacks.click({target:{closest:()=>({dataset:{reportRange:'all'}})}});assert.match(html,/Attendance & utilization/);assert.match(html,/Instructor comparison/);assert.match(html,/unrecorded attendance is not a no-show|Missing attendance is unrecorded/);assert.match(html,/100\.0|0\.0%/);
 d={...d,staffAccess:{...d.staffAccess,permissions:[]}};assert.match(ui.render(),/Reports unavailable/);delete globalThis.document;
});
