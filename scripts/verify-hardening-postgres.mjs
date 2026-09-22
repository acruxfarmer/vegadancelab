// Local-only integration harness. PG_TEST_BIN must contain native initdb/pg_ctl.
// Never accepts a hosted connection string or reuses an existing database.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createApplicationStore} from '../src/runtime/application-database.mjs';
import {emptyState,transition} from '../src/application.mjs';
const bin=process.env.PG_TEST_BIN;if(!bin)throw new Error('PG_TEST_BIN required; local binaries only');
const dir=await mkdtemp(join(tmpdir(),'vega-hardening-')),password=randomUUID(),port=Number(process.env.PG_TEST_PORT||55439);
if(!Number.isInteger(port)||port<49152||port>65535)throw new Error('Use a local test port');
const exe=name=>join(resolve(bin),name+(process.platform==='win32'?'.exe':''));
function run(name,args){return new Promise((resolve,reject)=>{let output='';const p=spawn(exe(name),args,{windowsHide:true});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`${name} failed: ${output}`)));});}
const options={host:'127.0.0.1',port,database:'postgres',password,connectionTimeoutMillis:3000,statement_timeout:5000};
const admin=new pg.Pool({...options,user:'postgres'}),runtime=new pg.Pool({...options,user:'vega_app_runtime',max:8,application_name:'vega-hardening-test'});
runtime.on('error',()=>{});let started=false;const results=[];
const staff='11111111-1111-4111-8111-111111111111',m1='22222222-2222-4222-8222-222222222222',m2='33333333-3333-4333-8333-333333333333';
const store=createApplicationStore(runtime);
const command=(action,body={},id)=>({action,id,body:{requestId:randomUUID(),...body}});
async function state(){return (await admin.query("select state,revision from vega_private.app_state where business_id='studio'")).rows[0];}
async function check(name,fn){await fn();results.push(name);console.log(`PASS ${name}`);}
async function overlap(operations,beforeRelease=async()=>{}){
 const lock=await admin.connect();await lock.query('begin');await lock.query("select * from vega_private.app_state where business_id='studio' for update");
 const promises=operations.map(f=>f());const settled=Promise.allSettled(promises);
 try{
  let waiting=0;const until=Date.now()+4000;
  while(Date.now()<until){waiting=Number((await admin.query("select count(*) from pg_stat_activity where application_name='vega-hardening-test' and wait_event_type='Lock'")).rows[0].count);if(waiting===operations.length)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(waiting,operations.length,'all operations must overlap while waiting for the database lock');
  await beforeRelease();
 }finally{await lock.query('rollback');lock.release();}
 return settled;
}
try{
 const pw=join(dir,'password');await writeFile(pw,password);
 try{await run('initdb',['-D',join(dir,'data'),'-U','postgres','--pwfile',pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{await unlink(pw);}
 await run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
 await admin.query('create schema vega_private; create role anon; create role authenticated;');
 await admin.query(await readFile(new URL('../db/application-schema.sql',import.meta.url),'utf8'));
 await admin.query(`alter role vega_app_runtime login password '${password}'`);
 let seed={...emptyState(),participants:[{id:'p'},{id:'q'}],classes:[{id:'class',status:'open',capacity:1,creditRequired:true,startsAt:'2099-10-02T12:00:00Z',cancellationCutoffMinutes:90}]};
 for(const participantId of ['p','q'])seed=transition(seed,command('issue-credit',{participantId,quantity:2,reason:'Synthetic local test'}),{userId:staff,role:'staff',participantIds:[]}).state;
 await admin.query('insert into vega_private.app_state(tenant_id,business_id,state) values($1,$2,$3),($1,$4,$3)',['tenant','studio',JSON.stringify(seed),'other']);
 for(const [user,role,ids] of [[staff,'staff',[]],[m1,'member',['p']],[m2,'member',['q']]])await admin.query('insert into vega_private.app_members values($1,$2,$3,$4,$5)',[user,'tenant','studio',role,ids]);
 await check('runtime readiness',()=>store.check());
 let booking;
 await check('simultaneous last-seat bookings: one reservation, one consumption',async()=>{
  const r=await overlap([()=>store.command(m1,command('reserve',{participantId:'p',classId:'class'})),()=>store.command(m2,command('reserve',{participantId:'q',classId:'class'}))]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.status,409);booking=r.find(x=>x.status==='fulfilled').value;
  const s=(await state()).state;assert.equal(s.reservations.length,1);assert.equal(s.creditEvents.filter(e=>e.type==='consume').length,1);
 });
 await check('concurrent cancellation replay restores once and retains original history',async()=>{
  const cmd=command('cancel',{classification:'early',reason:'Synthetic cancel'},booking.id),before=await state();
  const r=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,cmd)]);assert.ok(r.every(x=>x.status==='fulfilled'));assert.deepEqual(r[0].value,r[1].value);
  const after=await state();assert.equal(BigInt(after.revision),BigInt(before.revision)+1n);assert.equal(after.state.reservations[0].cancellationHistory.length,1);assert.equal(after.state.creditEvents.filter(e=>e.type==='restore').length,1);
 });
 await check('concurrent correction replay reverses and restores exactly once',async()=>{
  for(const classification of ['late','early']){
   const cmd=command('correct-cancellation',{classification,reason:'Synthetic correction'},booking.id),before=await state();
   const r=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,cmd)]);assert.ok(r.every(x=>x.status==='fulfilled'));assert.deepEqual(r[0].value,r[1].value);
   const after=await state();assert.equal(BigInt(after.revision),BigInt(before.revision)+1n);assert.equal(r[0].value.outcome,'applied');assert.equal(after.state.creditUnits.length,before.state.creditUnits.length);
   assert.equal(after.state.creditEvents.length,before.state.creditEvents.length+1);assert.equal(after.state.creditEvents.at(-1).type,classification==='late'?'reverse_restoration':'restore_after_reversal');
  }
 });
 await check('concurrent manual issuance replay creates one grant',async()=>{
  const cmd=command('issue-credit',{participantId:'p',quantity:1,reason:'Synthetic courtesy'}),before=await state();
  const r=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,cmd)]);assert.ok(r.every(x=>x.status==='fulfilled'));assert.deepEqual(r[0].value,r[1].value);
  assert.equal((await state()).state.creditUnits.length,before.state.creditUnits.length+1);
  await assert.rejects(store.command(staff,{...cmd,body:{...cmd.body,quantity:2}}),e=>e.status===409);
 });
 await check('receipt failure rolls back state, credits and audit; same request retries safely',async()=>{
  await admin.query("create function vega_private.fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic receipt failure'; end $$; create trigger fail_receipt before insert on vega_private.app_commands for each row execute function vega_private.fail_receipt()");
  const before=await state(),cmd=command('issue-credit',{participantId:'p',quantity:1,reason:'Rollback test'});
  await assert.rejects(store.command(staff,cmd),/synthetic receipt failure/);assert.deepEqual(await state(),before);
  await admin.query('drop trigger fail_receipt on vega_private.app_commands');await store.command(staff,cmd);assert.equal((await state()).state.creditUnits.length,before.state.creditUnits.length+1);
 });
 await check('lost commit acknowledgement retries from durable receipt without another mutation',async()=>{
  let lose=true;const wrapped={connect:async()=>{const c=await runtime.connect();return {release:()=>c.release(),query:async(...args)=>{const result=await c.query(...args);if(args[0]==='commit'&&lose){lose=false;throw new Error('Synthetic lost acknowledgement');}return result;}};}};
  const uncertain=createApplicationStore(wrapped),cmd=command('issue-credit',{participantId:'p',quantity:1,reason:'Commit ambiguity'});
  await assert.rejects(uncertain.command(staff,cmd),/lost acknowledgement/);const committed=await state();await store.command(staff,cmd);assert.deepEqual(await state(),committed);
 });
 await check('member staff-operation denial and business RLS preserve all existing state',async()=>{
  const before=await state();await assert.rejects(store.command(m1,command('issue-credit',{participantId:'p',quantity:1,reason:'Unauthorized'})),e=>e.status===403);
  await assert.rejects(store.command(m1,command('reserve',{participantId:'q',classId:'class'})),e=>e.status===403);assert.deepEqual(await state(),before);
  const c=await runtime.connect();try{await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[staff]);assert.equal((await c.query("select * from vega_private.app_state where business_id='other'")).rowCount,0);assert.equal((await c.query("update vega_private.app_state set revision=revision+1 where business_id='other'")).rowCount,0);await c.query('rollback');}finally{c.release();}
 });
 await check('staff downgraded while waiting cannot execute with stale authority',async()=>{
  const before=await state();
  const r=await overlap([()=>store.command(staff,command('issue-credit',{participantId:'p',quantity:1,reason:'Stale staff'}))],()=>admin.query("update vega_private.app_members set role='member' where user_id=$1",[staff]));
  assert.equal(r[0].status,'rejected');assert.equal(r[0].reason.status,403);assert.deepEqual(await state(),before);
  await admin.query("update vega_private.app_members set role='staff' where user_id=$1",[staff]);
 });
 await check('concurrent booking replay consumes exactly once',async()=>{
  const cmd=command('reserve',{participantId:'p',classId:'class'}),before=await state();
  const r=await overlap([()=>store.command(m1,cmd),()=>store.command(m1,cmd)]);assert.ok(r.every(x=>x.status==='fulfilled'));assert.deepEqual(r[0].value,r[1].value);
  const after=await state();assert.equal(after.state.reservations.length,before.state.reservations.length+1);assert.equal(after.state.creditEvents.filter(e=>e.type==='consume').length,before.state.creditEvents.filter(e=>e.type==='consume').length+1);
 });
 await check('readiness rejects missing receipt grants, disabled RLS and elevated runtime role',async()=>{
  for(const [breakIt,repair] of [
   ['revoke insert on vega_private.app_commands from vega_app_runtime','grant insert on vega_private.app_commands to vega_app_runtime'],
   ['alter table vega_private.app_commands no force row level security','alter table vega_private.app_commands force row level security'],
   ['alter role vega_app_runtime bypassrls','alter role vega_app_runtime nobypassrls']
  ]){await admin.query(breakIt);try{await assert.rejects(store.check(),/not ready/);}finally{await admin.query(repair);}await store.check();}
 });
 console.log(JSON.stringify({status:'passed',postgres:(await admin.query('select version()')).rows[0].version,checks:results},null,2));
}finally{
 await runtime.end();await admin.end();if(started)await run('pg_ctl',['-D',join(dir,'data'),'-m','fast','-w','stop']);
}
