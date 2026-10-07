import test from 'node:test';
import assert from 'node:assert/strict';
import {transition} from '../src/first-booking.mjs';
import {emptyState} from '../src/application.mjs';
import {bookingEmailIntents,bookingEmailMessage,validEmail,emailStateLabel} from '../src/booking-email.mjs';
import {createResendBookingAdapter} from '../src/runtime/providers/resend-booking.mjs';
import {deliverBookingEmail,readBookingEmails,enqueueBookingEmails} from '../src/runtime/booking-email.mjs';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {generateKeyPairSync} from 'node:crypto';
const now=()=> '2030-01-01T12:00:00Z';
const authority=(business='vega')=>({tenantId:business,businessId:business,role:'member',userId:'member',participantIds:['self']});
function fixture(business){return {...emptyState(),classes:[{id:'class',title:'Movement practice',instructor:'Teacher',status:'open',startsAt:'2030-01-03T02:00:00Z',capacity:1,waitlistEnabled:true,creditRequired:false}],participants:[{id:'self',name:'Member'}],customerProfiles:[{...authority(business),accountId:'member',participantId:'self',revision:1}]};}
const reserve={action:'reserve',body:{participantId:'self',classId:'class',requestId:'test'}};
for(const business of ['vega','willow'])test(`${business}: booking/cancellation/rebooking compose actual transitions without changing state`,()=>{
 const a=authority(business),before=fixture(business),booked=transition(before,reserve,a,{now}).state;
 let saved=structuredClone(booked);const first=bookingEmailIntents(before,booked,a,reserve);
 assert.equal(first.length,1);assert.equal(first[0].kind,'booking_confirmation');assert.deepEqual(booked,saved);
 assert.deepEqual(bookingEmailIntents(booked,booked,a,reserve),[]);
 const cancel={action:'cancel',id:booked.reservations[0].id,body:{requestId:'cancel'}},cancelled=transition(booked,cancel,a,{now}).state;
 assert.equal(bookingEmailIntents(booked,cancelled,a,cancel)[0].kind,'booking_cancellation');
 const again=transition(cancelled,reserve,a,{now}).state;
 assert.equal(bookingEmailIntents(cancelled,again,a,reserve)[0].kind,'rebooking_confirmation');
 assert.notEqual(bookingEmailIntents(cancelled,again,a,reserve)[0].id,first[0].id);
});
test('successful promotion and waitlist joining use authoritative transitions',()=>{
 const a=authority(),s=fixture();s.reservations=[{id:'full',participantId:'other',classId:'class',status:'reserved'}];
 const waiting=transition(s,{...reserve,body:{...reserve.body,waitlistOnly:true}},a,{now}).state;
 assert.equal(bookingEmailIntents(s,waiting,a,reserve)[0].kind,'waitlist_joined');
 waiting.reservations[0].status='cancelled';
 const command={action:'promote',id:waiting.reservations[1].id,body:{requestId:'promote'}},promoted=transition(waiting,command,{...a,role:'staff'},{now}).state;
 const intents=bookingEmailIntents(waiting,promoted,a,command);assert.equal(intents[0].kind,'waitlist_promotion');
 assert.equal(promoted.notifications.length,1);assert.deepEqual(bookingEmailIntents(promoted,promoted,a,command),[]);
});
test('foreign business rows cannot create email; same reservation ids have different scoped intent identities',()=>{
 const before=fixture(),after=structuredClone(before);after.reservations=[{id:'r',participantId:'self',classId:'class',status:'reserved',tenantId:'foreign'}];
 assert.deepEqual(bookingEmailIntents(before,after,authority(),reserve),[]);
 delete after.reservations[0].tenantId;
 assert.notEqual(bookingEmailIntents(before,after,authority('vega'),reserve)[0].id,bookingEmailIntents(before,after,authority('willow'),reserve)[0].id);
});
const intent={kind:'booking_confirmation',recipient:'member@example.com',snapshot:{className:'Movement practice',startsAt:'2030-01-03T02:00:00Z',memberName:'Member',instructor:'Teacher',status:'reserved'}};
const configuration={name:'Vega Dance Lab',sender:'admin@acrux.co',timeZone:'America/Los_Angeles',origin:'https://vega-development-web.onrender.com',tenantId:'vega-development',businessId:'vega-dance-lab'};
test('customer content has business-local time, supported scoped booking link and no internals',()=>{
 const m=bookingEmailMessage(intent,configuration);assert.match(m.text,/January 2, 2030 at 6:00 PM/);assert.match(m.text,/Instructor: Teacher/);assert.match(m.text,/tenant=vega-development&business=vega-dance-lab#bookings/);assert.doesNotMatch(m.text,/command|recovery|provider|requestId/);
 const willow=bookingEmailMessage(intent,{...configuration,name:'Willow',timeZone:'America/New_York'});assert.match(willow.text,/9:00 PM/);assert.match(willow.subject,/Willow/);
});
for(const email of [undefined,'','wrong','a@b','a\nb@example.com','a@b.com\r\nBcc: victim@example.com'])test(`invalid email rejected: ${JSON.stringify(email)}`,()=>{assert.equal(validEmail(email),false);assert.throws(()=>bookingEmailMessage({...intent,recipient:email},configuration));});
test('Resend timeout and malformed successful response remain uncertain',async()=>{
 for(const fetcher of [async()=>{throw Error('secret diagnostic');},async()=>({ok:true,json:async()=>({})})])assert.deepEqual(await createResendBookingAdapter('secret',fetcher).send({},'key'),{state:'uncertain',reason:'response_unconfirmed'});
});
test('permanent provider rejection is failed, retryable failure is uncertain, acceptance is not delivery',async()=>{
 for(const [status,state] of [[400,'failed'],[401,'failed'],[429,'uncertain'],[503,'uncertain']])assert.equal((await createResendBookingAdapter('key',async()=>({ok:false,status})).send({},'key')).state,state);
 const sent=await createResendBookingAdapter('key',async()=>({ok:true,json:async()=>({id:'provider-id'})})).send({},'key');assert.equal(sent.state,'provider_accepted');assert.doesNotMatch(emailStateLabel(sent.state),/delivered/i);
});
test('lost provider response reuses exactly the same message and idempotency key',async()=>{
 const requests=[];let attempts=0;
 const adapter=createResendBookingAdapter('key',async(url,options)=>{requests.push(options);if(++attempts===1)throw Error('timeout');return {ok:true,json:async()=>({id:'one-email'})};});
 const message=bookingEmailMessage(intent,configuration),outcomes=[];
 const pool={query:async(sql,args)=>sql.includes('claim_')?{rows:[{id:'intent',message}]}:(outcomes.push(args),{rows:[]})};
 await deliverBookingEmail(pool,adapter);await deliverBookingEmail(pool,adapter);
 assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);assert.equal(outcomes[0][2],'uncertain');assert.equal(outcomes[1][2],'provider_accepted');
});
test('member delivery projection excludes other members and technical/provider data',async()=>{
 const pool={query:async()=>({rows:[{reservation_id:'r',participant_id:'self',kind:'booking_confirmation',status:'provider_accepted',provider_id:'secret',recipient:'private'}, {participant_id:'other'}]})};
 const result=await readBookingEmails(pool,authority());assert.equal(result.length,1);assert.equal(result[0].provider_id,undefined);assert.equal(result[0].recipient,undefined);
});
test('enqueue happens through caller transaction and does not dispatch externally',async()=>{
 const before=fixture(),after=transition(before,reserve,authority(),{now}).state,queries=[];
 await enqueueBookingEmails({query:async(...args)=>queries.push(args)},before,after,authority(),reserve);
 assert.equal(queries.length,1);assert.match(queries[0][0],/enqueue_booking_email/);assert.equal(JSON.parse(queries[0][1][2]).kind,'booking_confirmation');
});
test('runtime commits booking + intent once, replays without enqueue, and rolls back on outbox failure',async()=>{
 let state=fixture('vega'),revision=0,failEmail=true,commits=0,rollbacks=0,enqueues=0;
 state.classes[0].startsAt=new Date(Date.now()+86400000).toISOString();
 const journal=new Map(),receipts=new Map();
 const pool={connect:async()=>({release(){},query:async(sql,args=[])=>{
  if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:'vega',business_id:'vega',role:'member',participant_ids:['self']}]};
  if(sql.startsWith('select state'))return {rows:[{state:structuredClone(state),revision}]};
  if(sql.startsWith('select fingerprint'))return {rows:journal.has(args[3])?[journal.get(args[3])]:[]};
  if(sql.startsWith('select event_id,discovery_state'))return {rows:[receipts.get(args[3])]};
  if(sql.includes('enqueue_booking_email')){if(failEmail)throw Error('outbox unavailable');enqueues++;}
  if(sql.startsWith('update vega_private.app_state')){state=JSON.parse(args[0]);revision++;}
  if(sql.startsWith('insert into vega_private.app_commands'))journal.set(args[3],{fingerprint:args[4],response:JSON.parse(args[5])});
  if(sql.startsWith('insert into vega_private.recovery_outbox'))receipts.set(args[4],{event_id:args[0],state:'pending'});
  if(sql==='commit')commits++;if(sql==='rollback')rollbacks++;return {rows:[]};
 }})};
 const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
 const store=createApplicationStore(pool,{bookingEmails:true,receiptPublicKey});
 await assert.rejects(store.command('member',reserve),/outbox unavailable/);
 assert.equal(rollbacks,1);assert.equal(revision,0);assert.equal(state.reservations.length,0);
 failEmail=false;const first=await store.command('member',reserve),replay=await store.command('member',reserve);
 assert.deepEqual(replay,first);assert.equal(revision,1);assert.equal(enqueues,1);assert.equal(receipts.size,1);assert.equal(commits,2);
});

