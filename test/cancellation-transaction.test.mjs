import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../src/application.mjs';
import {createApplicationStore} from '../src/runtime/application-database.mjs';

test('locked store replays cancellation commands and commits blocked correction audit without moving credits',async()=>{
 let state={...emptyState(),participants:[{id:'p'}],classes:['c','d'].map(id=>({id,status:'open',startsAt:'2099-01-01T12:00:00Z',capacity:3,creditRequired:true}))},revision=0;
 const commands=new Map(),calls=[];
 let actor;
 const client={release(){},async query(sql,args){
  calls.push(sql);
  if(sql.startsWith('select set_config'))actor=args[0];
  if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:'dev',business_id:'dev',role:actor==='desk'?'staff':'member',participant_ids:['p']}]};
  if(sql.startsWith('select state')){assert.match(sql,/for update$/);return {rows:[{state,revision}]};}
  if(sql.startsWith('select fingerprint'))return {rows:commands.has(args[2]+args[3])?[commands.get(args[2]+args[3])]:[]};
  if(sql.startsWith('update vega_private.app_state')){state=JSON.parse(args[0]);revision++;}
  if(sql.startsWith('insert into vega_private.app_commands'))commands.set(args[2]+args[3],{fingerprint:args[4],response:JSON.parse(args[5])});
  return {rows:[]};
 }};
 const store=createApplicationStore({connect:async()=>client});let n=0;
 const run=(action,body={},id,user='member')=>store.command(user,{action,id,body:{requestId:`r${++n}`,...body}});
 await run('issue-credit',{participantId:'p',quantity:1,reason:'Test'},undefined,'desk');
 const bookingCommand={action:'reserve',body:{requestId:'book-one',participantId:'p',classId:'c'}};
 const booking=await store.command('member',bookingCommand),afterBooking=revision;
 assert.deepEqual(await store.command('member',bookingCommand),JSON.parse(JSON.stringify(booking)));assert.equal(revision,afterBooking);
 assert.equal(state.creditEvents.filter(e=>e.type==='consume').length,1);
 await assert.rejects(store.command('member',{...bookingCommand,body:{...bookingCommand.body,classId:'d'}}),e=>e.status===409);
 await assert.rejects(run('reserve',{participantId:'p',classId:'c'}),e=>e.status===409);
 assert.equal(revision,afterBooking);
 const cancel={action:'cancel',id:booking.id,body:{requestId:'cancel-one'}};
 const first=await store.command('member',cancel),afterCancel=revision;
 assert.deepEqual(await store.command('member',cancel),JSON.parse(JSON.stringify(first)));assert.equal(revision,afterCancel);
 await run('reserve',{participantId:'p',classId:'d'});
 const correction={action:'correct-cancellation',id:booking.id,body:{requestId:'correction-one',classification:'late',reason:'Test spent restoration'}};
 const before=JSON.stringify(state.creditUnits),blocked=await store.command('desk',correction),afterBlocked=revision;
 assert.equal(blocked.outcome,'blocked');assert.equal(state.reservations[0].cancellationHistory.at(-1).outcome,'blocked');assert.equal(JSON.stringify(state.creditUnits),before);
 assert.deepEqual(await store.command('desk',correction),JSON.parse(JSON.stringify(blocked)));assert.equal(revision,afterBlocked);
 await assert.rejects(store.command('desk',{...correction,body:{...correction.body,classification:'early'}}),e=>e.status===409);
 assert.equal(revision,afterBlocked);assert.equal(calls.at(-1),'rollback');assert.ok(calls.includes('commit'));
});
