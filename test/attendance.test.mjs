import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {auditRecords} from '../public/reporting-audit.js';
const staff={userId:'operator',role:'staff',participantIds:[]},member={userId:'member',role:'member',participantIds:['p']};
let sequence=0;
const opts={id:()=>`id-${++sequence}`,now:()=> '2026-09-22T12:00:00Z'};
function fixture(){let s={...emptyState(),participants:[{id:'p'},{id:'other'}],classes:[{id:'c',status:'open',capacity:3,creditRequired:true,startsAt:'2099-10-01T12:00:00Z'}]};s=transition(s,{action:'issue-credit',body:{requestId:'grant',participantId:'p',quantity:2,reason:'test'}},staff,opts).state;return transition(s,{action:'reserve',body:{requestId:'book',participantId:'p',classId:'c'}},member,opts).state;}
function mark(s,status,extra={},authority=staff){return transition(s,{action:'attendance',id:s.reservations[0].id,body:{requestId:`request-${++sequence}`,status,...extra}},authority,opts);}
function nonAttendance(s){const copy=structuredClone(s);copy.activity=copy.activity.filter(a=>a.action!=='attendance');for(const r of copy.reservations){delete r.attendanceStatus;delete r.attendanceRevision;delete r.attendanceHistory;}return copy;}
test('present, absent and cleared corrections preserve exact booking, credit and payment state and immutable lineage',()=>{
 const initial=fixture();let s=initial;
 for(const [revision,status] of ['present','absent','not_recorded','present'].entries()){
  const before=structuredClone(s.reservations[0].attendanceHistory||[]);
  s=mark(s,status,{expectedRevision:revision,...(revision?{reason:'Corrected roster entry'}:{})}).state;
  assert.deepEqual(nonAttendance(s),nonAttendance(initial));
  const h=s.reservations[0].attendanceHistory;assert.deepEqual(h.slice(0,-1),before);assert.equal(h.length,revision+1);assert.equal(h.at(-1).actorId,'operator');assert.equal(h.at(-1).to,status);assert.equal(h.at(-1).revision,revision+1);
 }
 const rows=auditRecords({...s,context:staff}).filter(r=>r.id.startsWith('attendance:'));assert.equal(rows.length,4);assert.ok(rows.every(r=>r.actorId==='operator'&&r.bookingId===s.reservations[0].id));
});
test('same state is an exact no-op even with a new request; stale correction cannot overwrite another change',()=>{
 const s=mark(fixture(),'present',{expectedRevision:0}).state;
 assert.deepEqual(mark(s,'present',{expectedRevision:0}).state,s);
 assert.throws(()=>mark(s,'absent',{expectedRevision:0,reason:'stale'}),e=>e.status===409);
 assert.throws(()=>mark(s,'absent',{expectedRevision:1}),/reason/);
 assert.throws(()=>mark(s,'absent',{expectedRevision:-1,reason:'bad'}),/revision/);
});
test('member isolation, staff notes privacy and invalid booking/status boundaries',()=>{
 const s=mark(fixture(),'present',{reason:'Private staff note'}).state;
 assert.throws(()=>mark(s,'absent',{},member),e=>e.status===403);
 assert.throws(()=>mark(s,'unknown'),/status/);
 for(const status of ['cancelled','waitlisted']){const invalid=structuredClone(s);invalid.reservations[0].status=status;assert.throws(()=>mark(invalid,'absent',{reason:'invalid'}),e=>e.status===409);}
 const v=visibleState(s,member);assert.equal(v.reservations[0].attendanceStatus,'present');assert.deepEqual(Object.keys(v.reservations[0].attendanceHistory[0]).sort(),['createdAt','from','to']);assert.ok(!JSON.stringify(v).includes('Private staff note'));
 assert.equal(visibleState(s,{...member,participantIds:['other']}).reservations.length,0);
});
