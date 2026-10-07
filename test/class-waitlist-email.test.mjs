import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition} from '../src/application.mjs';
import {classCancellationOption} from '../src/class-cancellation.mjs';
import {classEditOption} from '../src/class-editing.mjs';
import {bookingEmailIntents,bookingEmailMessage} from '../src/booking-email.mjs';
const now=()=> '2030-01-01T12:00:00Z';
const actor=b=>({tenantId:b,businessId:b,userId:'staff',role:'staff',participantIds:[]});
const config={name:'Studio',sender:'admin@acrux.co',origin:'https://vega-development-web.onrender.com',tenantId:'vega',businessId:'vega',timeZone:'America/Los_Angeles'};
function fixture(){return {...emptyState(),classes:[{id:'class',title:'Movement',instructor:'Teacher',startsAt:'2030-01-03T02:00:00Z',status:'open',capacity:1,waitlistEnabled:true,creditRequired:false}],participants:['p','q','old','unaffected'].map(id=>({id,name:id})),reservations:[{id:'r',classId:'class',participantId:'p',status:'reserved',attendanceStatus:'not_recorded'},{id:'w',classId:'class',participantId:'q',status:'waitlisted',attendanceStatus:'not_recorded'},{id:'old',classId:'class',participantId:'old',status:'cancelled'},{id:'other',classId:'other',participantId:'unaffected',status:'reserved',attendanceStatus:'not_recorded'}]};}
for(const business of ['vega','willow'])test(`${business}: class cancellation reports only booked and waiting members, once`,()=>{
 const before=fixture(),a=actor(business),command={action:'cancel-class',body:{requestId:'cancel',classId:'class',reason:'PRIVATE STAFF DETAIL',impactToken:classCancellationOption(before,before.classes[0],now()).impactToken}};
 const after=transition(before,command,a,{now}).state,saved=structuredClone(after),intents=bookingEmailIntents(before,after,a,command);
 assert.equal(intents.length,2);assert.deepEqual(intents.map(i=>i.participantId),['p','q']);assert.ok(intents.every(i=>i.kind==='class_cancelled'));
 assert.deepEqual(bookingEmailIntents(before,after,a,command),intents);assert.deepEqual(bookingEmailIntents(after,after,a,command),[]);
 for(const i of intents){const m=bookingEmailMessage({...i,recipient:'member@example.com'},{...config,tenantId:business,businessId:business});assert.match(m.subject,/class has been cancelled/);assert.doesNotMatch(m.text,/PRIVATE STAFF DETAIL|eventId|provider|recovery/);assert.match(m.text,i.participantId==='q'?/waitlist entry is closed/:/your booking/);}
 assert.deepEqual(after,saved);
});
test('waitlist removal is not a cancelled confirmed booking and replay creates nothing',()=>{
 const before=fixture(),command={action:'cancel',id:'w',body:{requestId:'remove',expectedReservationStatus:'waitlisted'}},after=transition(before,command,actor('vega'),{now}).state;
 const i=bookingEmailIntents(before,after,actor('vega'),command);assert.equal(i.length,1);assert.equal(i[0].kind,'waitlist_removed');assert.equal(i[0].participantId,'q');
 const m=bookingEmailMessage({...i[0],recipient:'member@example.com'},config);assert.match(m.text,/Waitlist status: Removed/);assert.doesNotMatch(m.text,/Booking status: Confirmed/);
 assert.deepEqual(bookingEmailIntents(after,after,actor('vega'),command),[]);
});
test('waitlist joining explains no seat and no credit consumption; frozen snapshot survives later edits',()=>{
 const before=fixture();before.reservations=before.reservations.filter(r=>r.id!=='w');
 const command={action:'reserve',body:{requestId:'join',classId:'class',participantId:'q',waitlistOnly:true}},after=transition(before,command,actor('vega'),{now}).state;
 const i=bookingEmailIntents(before,after,actor('vega'),command)[0],m=bookingEmailMessage({...i,recipient:'member@example.com'},config);
 assert.equal(i.kind,'waitlist_joined');assert.match(m.text,/No seat is reserved and no class credit/);assert.match(m.text,/Waitlist status: Waiting/);
 after.classes[0].instructor='Changed';assert.equal(bookingEmailMessage({...i,recipient:'member@example.com'},config).text,m.text);
});
test('foreign affected rows are excluded and scopes have independent intent keys',()=>{
 const before=fixture(),after=structuredClone(before);after.reservations[0].status='cancelled';after.reservations[1].status='cancelled';after.reservations[1].businessId='foreign';
 const cmd={action:'cancel-class'},v=bookingEmailIntents(before,after,actor('vega'),cmd),w=bookingEmailIntents(before,after,actor('willow'),cmd);
 assert.equal(v.length,1);assert.equal(w.length,1);assert.notEqual(v[0].id,w[0].id);
});
test('existing schedule authority rejects time and instructor edits with affected populations',()=>{
 const s=fixture();assert.equal(classEditOption(s,s.classes[0],now()).allowed,false);
 for(const details of [{startsAt:'2030-01-04T02:00:00Z'},{instructor:'Changed'}])assert.throws(()=>transition(s,{action:'edit-class',body:{requestId:'edit',classId:'class',details}},actor('vega'),{now}),/cannot be edited/);
 assert.deepEqual(bookingEmailIntents(s,s,actor('vega'),{action:'edit-class'}),[]);
});
