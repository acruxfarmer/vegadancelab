import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {applicationDatabaseOptions,createApplicationStore} from '../src/runtime/application-database.mjs';
const member={userId:'user',role:'member',participantIds:['a']};
const staff={...member,role:'staff'};
const options={id:()=> 'new',now:()=> '2026-09-21T12:00:00Z'};
function fixture(){return {...emptyState(),participants:[{id:'a',name:'A'},{id:'b',name:'B'}],classes:[{id:'c',title:'Class',status:'open',capacity:1,startsAt:'2026-10-01T12:00:00Z',waitlistEnabled:true}]};}
const command=(action,body={},id)=>({action,id,body:{requestId:'req',...body}});
test('last seat and waitlist remain independent of money, attendance and notifications',()=>{
 const first=transition(fixture(),command('reserve',{classId:'c',participantId:'a'}),member,options);
 assert.equal(first.result.status,'reserved');assert.equal(first.result.paymentStatus,'not_evaluated');
 const second=transition(first.state,command('reserve',{classId:'c',participantId:'b'}),staff,options);
 assert.equal(second.result.status,'waitlisted');
 assert.throws(()=>transition(second.state,command('promote',{},'new'),staff,options));
});
test('participant and staff boundaries are enforced in command policy',()=>{
 assert.throws(()=>transition(fixture(),command('reserve',{classId:'c',participantId:'b'}),member,options),/authority/);
 const booked=transition(fixture(),command('reserve',{classId:'c',participantId:'a'}),member,options);
 assert.throws(()=>transition(booked.state,command('attendance',{status:'present'},'new'),member,options),/Staff/);
 const attended=transition(booked.state,command('attendance',{status:'present'},'new'),staff,options);
 assert.throws(()=>transition(attended.state,command('cancel',{},'new'),member,options),e=>e.status===409&&/Attendance has been recorded.*Contact the studio/.test(e.message));
 assert.equal(booked.state.reservations[0].attendanceStatus,'not_recorded');
});
test('member reads exclude other participants, drafts, staff events and future unknown keys',()=>{
 const s=fixture();s.notifications=[{participantId:'a',status:'draft',message:'Private draft'}];s.secretFutureModule=[1];s.activity=[{actorId:'staff'}];
 const visible=visibleState(s,member);assert.deepEqual(visible.participants,[s.participants[0]]);assert.deepEqual(visible.notifications,[]);assert.deepEqual(visible.activity,[]);assert.equal(visible.secretFutureModule,undefined);
});
test('application URL never substitutes operator or ingestion identity and ignores insecure flags',()=>{
 assert.throws(()=>applicationDatabaseOptions('postgres://postgres:secret@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres'));
 assert.throws(()=>applicationDatabaseOptions('postgres://vega_ingest_runtime:secret@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres'));
 const result=applicationDatabaseOptions('postgres://vega_app_runtime:secret@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres?sslmode=disable');assert.equal(result.ssl.rejectUnauthorized,true);
});
test('transaction errors rollback and release; actor is transaction-local',async()=>{
 const calls=[];let released=false;
 const c={query:async(sql,args)=>{calls.push([sql,args]);if(sql.startsWith('select tenant_id'))return {rows:[]};return {rows:[]};},release:()=>released=true};
 const store=createApplicationStore({connect:async()=>c});await assert.rejects(store.read('user'),/assignment/);
 assert.ok(calls.some(([s])=>s==="select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)"));assert.ok(calls.some(([s])=>s==='rollback'));assert.ok(released);
});
