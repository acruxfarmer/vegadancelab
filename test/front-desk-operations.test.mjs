import test from 'node:test';
import assert from 'node:assert/strict';
import {deskCustomer,deskScope,frontDeskOperationsUI} from '../public/front-desk-operations.js';
import {staffRuntimeFixture,staffIds as ids,scopes} from './helpers/staff-runtime-fixture.mjs';
const setup=async(role='front_desk')=>{const h=staffRuntimeFixture();await h.command(ids.worker,'staff-register',{name:'Desk'});await h.role(role,role==='instructor'?['class-one']:[]);return h;};
test('one customer projection composes only their authoritative records without mutation',async()=>{
 const h=await setup('owner'),d=await h.store.read(h.identity(ids.worker));
 d.participants.push({id:'other',name:'Other'});d.passes=[{id:'pass',participantId:'person-one'},{id:'other-pass',participantId:'other'}];d.staffAccount={passes:[{passId:'pass',available:3},{passId:'other-pass',available:99}]};
 d.purchaseDrafts=[{id:'sale',participantId:'person-one'},{id:'other-sale',participantId:'other'}];d.refundHistory=[{purchaseId:'sale',status:'pending'},{purchaseId:'other-sale',status:'completed'}];
 const before=structuredClone(d),c=deskCustomer(d,'person-one');assert.equal(c.available,3);assert.equal(c.purchases.length,1);assert.equal(c.refunds.length,1);assert.equal(c.reservations.length,2);assert.deepEqual(d,before);
});
test('ambiguous customer and account linkage never enables a sale or selects arbitrary records',async()=>{
 const h=await setup(),d=await h.store.read(h.identity(ids.worker));
 d.frontDesk={customers:[{participantId:'person-one',buyerId:'one'}]};assert.equal(deskCustomer(d,'person-one').linked,true);
 d.profileAdministration.participants[0].profile={accountId:'two'};assert.equal(deskCustomer(d,'person-one').review,true);assert.deepEqual(deskCustomer(d,'person-one').customers,[]);
 d.participants.push({...d.participants[0]});assert.equal(deskCustomer(d,'person-one'),null);
});
test('front desk books, cancels, joins and leaves a waitlist through existing application contracts',async()=>{
 const h=await setup();h.records.get('studio-a').state.classes.push({id:'new-class',title:'New class',startsAt:'2099-03-01T18:00:00Z',capacity:1,status:'open',waitlistEnabled:true});
 const untouched=structuredClone(h.records.get('studio-b'));
 const b=await h.command(ids.worker,'reserve',{participantId:'person-one',classId:'new-class',reservationOnly:true});
 assert.equal(b.status,'reserved');await h.command(ids.worker,'cancel',{classification:'early',reason:'Customer requested'},b.id);
 h.records.get('studio-a').state.participants.push({id:'other',name:'Other'});
 await h.command(ids.worker,'reserve',{participantId:'other',classId:'new-class',reservationOnly:true});
 const w=await h.command(ids.worker,'reserve',{participantId:'person-one',classId:'new-class',waitlistOnly:true});assert.equal(w.status,'waitlisted');assert.equal(w.creditConsumption,undefined);
 await h.command(ids.worker,'cancel',{classification:'early',reason:'Leaving queue'},w.id);
 const c=deskCustomer(await h.store.read(h.identity(ids.worker)),'person-one');assert.equal(c.reservations.find(r=>r.id===w.id).status,'cancelled');assert.deepEqual(h.records.get('studio-b'),untouched);
});
test('stale waitlist action rejects rather than booking a newly available seat',async()=>{
 const h=await setup();await assert.rejects(h.command(ids.worker,'reserve',{participantId:'person-one',classId:'class-two',waitlistOnly:true}));
 const before=structuredClone(h.records.get('studio-a'));h.records.get('studio-a').state.classes.push({id:'open',title:'Open',startsAt:'2099-04-01T18:00:00Z',capacity:2,status:'open',waitlistEnabled:true});
 await assert.rejects(h.command(ids.worker,'reserve',{participantId:'person-one',classId:'open',waitlistOnly:true}),/waitlist|refresh/i);assert.equal(h.records.get('studio-a').state.reservations.length,before.state.reservations.length);
});
test('attendance correction refreshes the customer projection and preserves booking and member facts',async()=>{
 const h=await setup();const before=structuredClone(h.records.get('studio-a').state.reservations[0]);
 await h.command(ids.worker,'attendance',{status:'present',expectedRevision:0},'booking-one');
 await h.command(ids.worker,'attendance',{status:'absent',expectedRevision:1,reason:'Corrected entry'},'booking-one');
 const d=await h.store.read(h.identity(ids.worker)),c=deskCustomer(d,'person-one'),member=await h.store.read(h.identity(ids.member));
 assert.equal(c.reservations[0].attendanceStatus,'absent');assert.equal(c.reservations[0].status,before.status);assert.equal(member.reservations[0].attendanceStatus,'absent');
 await assert.rejects(h.command(ids.worker,'attendance',{status:'present',expectedRevision:0},'booking-one'),/changed|refresh|revision/i);
});
test('instructor receives assigned-class workspace only; member and foreign business access stay denied',async()=>{
 const h=await setup('instructor'),d=await h.store.read(h.identity(ids.worker)),c=deskCustomer(d,'person-one');
 assert.equal(c.reservations.length,1);assert.equal(c.profile,null);assert.deepEqual(c.purchases,[]);assert.deepEqual(c.passes,[]);assert.equal(c.can('bookings.manage'),false);
 assert.equal(deskCustomer(await h.store.read(h.identity(ids.member)),'person-one'),null);
 await assert.rejects(h.store.read(h.identity(ids.worker,{tenantId:'tenant-a',businessId:'studio-b'})),e=>e.status===403);
 await assert.rejects(h.command(ids.worker,'attendance',{status:'present'},'booking-two'),e=>e.status===403);
});
test('same projection works in a second business with independent roles',async()=>{
 const h=await setup();await h.command(ids.worker,'staff-register',{name:'Other business desk'},undefined,scopes[1]);await h.role('manager',[],scopes[1]);
 const a=await h.store.read(h.identity(ids.worker)),b=await h.store.read(h.identity(ids.worker,scopes[1]));
 assert.notEqual(deskScope(a),deskScope(b));assert.equal(deskCustomer(a,'person-one').can('finance.read'),false);assert.equal(deskCustomer(b,'person-one').can('finance.read'),true);
});
test('workspace refresh retains customer only within the same authorized context; waiver required remains visible',async()=>{
 const h=await setup();let d=await h.store.read(h.identity(ids.worker)),html,callbacks={};
 globalThis.document={addEventListener:(type,callback)=>callbacks[type]=callback};
 const ui=frontDeskOperationsUI({getData:()=>d,escape:s=>String(s??''),load:async()=>{},render:()=>html=ui.render(),notify:()=>{},openAttendance:()=>{},saleHTML:()=>'',commerceHTML:()=>'',refundHTML:()=>'',date:s=>s,time:()=>''});
 ui.render();const button={dataset:{deskCustomer:'person-one'}};await callbacks.click({target:{closest:()=>button}});
 assert.match(html,/Selected customer/);assert.equal(ui.scoped(),ui.scoped());
 d=structuredClone(d);d.profileAdministration.participants[0].waiverStatus='Acceptance required';html=ui.render();assert.match(html,/Acceptance required/);
 d.context.businessId='different';html=ui.render();assert.doesNotMatch(html,/Selected customer/);assert.deepEqual(ui.scoped().purchaseDrafts,[]);
 delete globalThis.document;
});
