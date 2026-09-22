import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditRecords,filterAudit} from '../public/reporting-audit.js';
import {emptyState,transition,visibleState} from '../src/application.mjs';
const staff={role:'staff',userId:'desk',participantIds:[]};
function fixture(){
 let s={...emptyState(),participants:[{id:'p',name:'Member'},{id:'q',name:'Other'}],classes:[{id:'c',status:'open',startsAt:'2030-01-03T12:00:00Z',capacity:5,creditRequired:true}]},n=0;
 const run=(action,body={},id)=>{const v=transition(s,{action,id,body:{requestId:`request-${++n}`,...body}},staff,{id:()=>`id-${++n}`,now:()=>`2030-01-01T10:00:${String(n%60).padStart(2,'0')}Z`});s=v.state;return v.result;};
 run('issue-credit',{participantId:'p',quantity:1,reason:'Courtesy support'});const r=run('reserve',{participantId:'p',classId:'c'});run('cancel',{classification:'late',reason:'Initial decision'},r.id);run('correct-cancellation',{classification:'early',reason:'Reviewed decision'},r.id);run('correct-cancellation',{classification:'late',reason:'Reverse available unit'},r.id);return {...visibleState(s,staff,'2030-01-01T12:00:00Z'),context:staff};
}
test('audit joins immutable originals and exact credit movements without mutating source or duplicating cancellation activity',()=>{
 const d=fixture(),before=structuredClone(d),rows=auditRecords(d);assert.deepEqual(d,before);
 assert.equal(rows.filter(r=>r.type==='booking').length,1);assert.equal(rows.filter(r=>r.type==='cancellation').length,1);assert.equal(rows.filter(r=>r.type==='correction').length,2);
 for(const type of ['issue','consume','restore','reverse_restoration'])assert.equal(rows.filter(r=>r.type===type).length,1);
 assert.equal(rows.find(r=>r.type==='booking').actorId,'desk');assert.ok(rows.filter(r=>r.type==='correction').every(r=>r.original.startsWith('late at')));
 assert.match(rows.find(r=>r.type==='restore').current,/reversed/);assert.match(rows.find(r=>r.type==='restore').current,/original consumed unit/);
});
test('member and date/type/booking/actor/text filters intersect and UTC date is inclusive',()=>{
 const rows=auditRecords(fixture()),r=rows.find(r=>r.type==='consume');assert.equal(filterAudit(rows,{member:'p',type:'consume',booking:r.bookingId,actor:'desk',from:'2030-01-01',to:'2030-01-01',query:r.unitId}).length,1);
 for(const f of [{member:'q'},{actor:'unknown'},{from:'2030-01-02'},{from:'2030-01-02',to:'2030-01-01'}])assert.equal(filterAudit(rows,f).length,0);
});
test('legacy missing actor/time stays unknown; member payload yields no audit rows',()=>{
 const d=fixture();d.reservations.push({id:'legacy',participantId:'q',status:'cancelled'});const rows=auditRecords(d),legacy=rows.find(r=>r.id==='legacy-cancellation:legacy');assert.equal(legacy.actorId,undefined);assert.equal(legacy.at,undefined);assert.equal(filterAudit([legacy],{from:'2030-01-01'}).length,0);
 assert.deepEqual(auditRecords({...d,context:{role:'member'}}),[]);
});
test('grant summaries remain separate from unit issuance, and blocked or unchanged corrections remain visible',()=>{
 const d=fixture();d.entitlementIssuances=[{id:'grant',participantId:'p',passId:'pass',quantity:3,source:'simulated_purchase',productSnapshot:{type:'membership',name:'Membership'},reference:'ref',actorId:'desk'}];d.reservations[0].cancellationHistory.push({id:'blocked',action:'correction',from:'early',to:'late',outcome:'blocked',creditOutcome:'blocked_spent',actorId:'desk',reason:'Attempt after spend'});
 const rows=auditRecords(d);assert.match(rows.find(r=>r.type==='entitlement-issuance').source,/not an additional/);assert.match(rows.find(r=>r.id==='cancellation:blocked').detail,/blocked_spent/);assert.match(rows.find(r=>r.type==='entitlement-issuance').detail,/simulated_purchase/);
});
