import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
const staff={userId:'desk',role:'staff',participantIds:[]},member={userId:'member',role:'member',participantIds:['p']};
function fixture(){let state={...emptyState(),participants:[{id:'p'},{id:'q'}],classes:[{id:'a',category:'Dance',status:'open',capacity:5,creditRequired:true,startsAt:'2026-10-02T12:00:00Z'},{id:'b',category:'Other',status:'open',capacity:5,creditRequired:true,startsAt:'2026-10-02T12:00:00Z'}]},n=0,time='2026-10-01T10:00:00Z';return {get state(){return state},time:t=>time=t,run(action,body={},id,actor=staff){const next=transition(state,{action,id,body:{requestId:`r${++n}`,...body}},actor,{id:()=>`id-${++n}`,now:()=>time});state=next.state;return next.result;}};}
const define=(s,type='class_pack',extra={})=>s.run('entitlement-product',{name:'Test product',type,quantity:type==='drop_in'?1:3,validDays:30,...extra});
const grant=(s,p,extra={})=>s.run('issue-entitlement',{productId:p.id,participantId:'p',issuanceRef:'purchase-1',reason:'Test successful purchase',...extra});
const reserve=(s,classId='a',extra={})=>s.run('reserve',{participantId:'p',classId,...extra},undefined,member);
test('drop-in and pack issue exact configured quantity with business-reference deduplication',()=>{
 const s=fixture(),p=define(s,'drop_in');const g=grant(s,p);assert.equal(g.quantity,1);assert.equal(grant(s,p).outcome,'already_issued');assert.equal(s.state.creditUnits.length,1);
 assert.throws(()=>grant(s,p,{participantId:'q'}),e=>e.status===409);
 const pack=define(s);grant(s,pack,{issuanceRef:'pack-1'});assert.equal(s.state.creditUnits.length,4);assert.equal(s.state.entitlementIssuances.length,2);
 assert.equal(s.state.creditUnits[0].entitlement.source,'simulated_purchase');assert.equal(g.actorId,'desk');
});
test('booking skips ineligible credits, consumes eligible unit once, and rejects insufficient credit',()=>{
 const s=fixture(),wrong=define(s,'drop_in',{categories:['Other']}),right=define(s,'drop_in',{categories:['Dance'],classIds:['a']});
 const a=grant(s,wrong),b=grant(s,right,{issuanceRef:'right'});const booking=reserve(s);assert.equal(booking.creditConsumption.passId,b.passId);assert.throws(()=>reserve(s),/Already booked/);
 assert.equal(s.state.creditUnits.find(u=>u.passId===a.passId).status,'available');
 s.run('cancel',{},booking.id,member);assert.deepEqual(s.state.creditUnits.at(-1).entitlement,s.state.creditUnits.find(u=>u.id===booking.creditConsumption.unitId).entitlement);
 assert.throws(()=>reserve(s,'b',{passId:b.passId}),/No eligible/);reserve(s,'b',{passId:a.passId});
});
test('expiration applies to current time and class start; restoration never extends validity',()=>{
 const s=fixture(),p=define(s,'drop_in',{validDays:1});grant(s,p);assert.throws(()=>reserve(s),/No eligible/);
 const longer=define(s,'drop_in',{validDays:3});grant(s,longer,{issuanceRef:'longer'});const r=reserve(s);
 s.time('2026-10-05T10:00:00Z');s.run('cancel',{classification:'early',reason:'Test correction'},r.id,staff);
 assert.equal(s.state.creditUnits.at(-1).entitlement.expiresAt,'2026-10-04T10:00:00.000Z');
});
test('membership periods issue once, remain account-bound and reject overlapping or duplicate periods',()=>{
 const s=fixture(),p=define(s,'membership');const first=grant(s,p,{membershipRef:'m1',periodStart:'2026-10-01T00:00:00Z'});
 assert.throws(()=>grant(s,p,{issuanceRef:'different',membershipRef:'m1',periodStart:'2026-10-01T00:00:00Z'}),/already issued/);
 assert.throws(()=>grant(s,p,{issuanceRef:'overlap',membershipRef:'m1',periodStart:'2026-10-15T00:00:00Z'}),/prior period end/);
 assert.throws(()=>grant(s,p,{issuanceRef:'foreign',participantId:'q',membershipRef:'m1',periodStart:first.expiresAt}),/another account/);
 grant(s,p,{issuanceRef:'next',membershipRef:'m1',periodStart:first.expiresAt});assert.equal(s.state.memberships[0].periods.length,2);
 const r=reserve(s);assert.equal(s.state.creditUnits.find(u=>u.id===r.creditConsumption.unitId).entitlement.validFrom,'2026-10-01T00:00:00.000Z');
});
test('courtesy provenance and staff authority are explicit; member views exclude issuance audit and other accounts',()=>{
 const s=fixture(),p=define(s,'courtesy');grant(s,p);grant(s,p,{participantId:'q',issuanceRef:'other'});
 assert.equal(s.state.creditUnits[0].entitlement.source,'staff_courtesy');
 assert.throws(()=>s.run('issue-entitlement',{productId:p.id},undefined,member),e=>e.status===403);
 assert.throws(()=>s.run('entitlement-product',{},undefined,member),e=>e.status===403);
 const v=visibleState(s.state,member);assert.equal(v.passes.length,1);assert.deepEqual(v.entitlementIssuances,[]);assert.equal(v.entitlementProducts[0].createdBy,undefined);assert.ok(v.creditUnits.every(u=>u.participantId==='p'));
});
