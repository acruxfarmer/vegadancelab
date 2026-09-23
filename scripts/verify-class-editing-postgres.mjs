import assert from 'node:assert/strict';
export async function verifyClassEditing({store,staff,m1,state,command,overlap,admin,check}){
 // Staff reads also query the existing processing queue. Empty local-only dependencies;
 // this harness does not run Square ingestion or a worker.
 await admin.query('create table vega_private.square_webhook_inbox(event_id text,event_type text,received_at timestamptz); create table vega_private.square_processing_journal(event_id text,status text,reason text); grant select on vega_private.square_webhook_inbox,vega_private.square_processing_journal to vega_app_runtime');
 const make=title=>store.command(staff,command('class',{title,instructor:'Local instructor',location:'Local studio',capacity:2,duration:60,startsAt:'2099-10-02T12:00:00Z',creditRequired:false,waitlistEnabled:true}));
 const proposal=async(c,patch={})=>{const d=await store.read(staff),o=d.classEditOptions.find(o=>o.classId===c.id);const {id,status,...details}=c;return {classId:c.id,versionToken:o.versionToken,details:{...details,title:c.title+' edited',...patch},reason:'Local schedule correction'};};
 const reviewed=async(c,patch={})=>{const b=await proposal(c,patch),r=await store.reviewClassEdit(staff,b);return command('edit-class',{...b,reviewToken:r.reviewToken});};
 await check('occurrence review is read-only; member authority denied; receipt failure rolls back edit and audit; concurrent replay commits once',async()=>{
  const c=await make('Atomic edit'),beforeReview=await state(),b=await proposal(c);await store.reviewClassEdit(staff,b);assert.deepEqual(await state(),beforeReview);
  await assert.rejects(store.reviewClassEdit(m1,b),e=>e.status===403);
  const cmd=await reviewed(c);await assert.rejects(store.command(m1,cmd),e=>e.status===403);
  await admin.query('create trigger fail_receipt before insert on vega_private.app_commands for each row execute function vega_private.fail_receipt()');
  try{await assert.rejects(store.command(staff,cmd),/synthetic receipt failure/);assert.deepEqual(await state(),beforeReview);}finally{await admin.query('drop trigger fail_receipt on vega_private.app_commands');}
  const r=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,cmd)]);assert.ok(r.every(x=>x.status==='fulfilled'));assert.deepEqual(r[0].value,r[1].value);
  const after=await state();assert.equal(BigInt(after.revision),BigInt(beforeReview.revision)+1n);const saved=after.state.classes.find(x=>x.id===c.id);assert.equal(saved.editHistory.length,1);assert.equal(saved.editHistory[0].actorId,staff);
  for(const key of Object.keys(after.state).filter(k=>!['classes','activity'].includes(k)))assert.deepEqual(after.state[key],beforeReview.state[key]);
  const s=await store.read(staff),m=await store.read(m1);const {editHistory,...staffClass}=s.classes.find(x=>x.id===c.id);assert.deepEqual(m.classes.find(x=>x.id===c.id),staffClass);
  await assert.rejects(store.command(staff,{...cmd,body:{...cmd.body,requestId:crypto.randomUUID()}}),e=>e.status===409);
 });
 await check('two reviewed edits serialize: exactly one applies and the other rejects stale review',async()=>{
  const c=await make('Two editors'),a=await reviewed(c,{capacity:3}),b=await reviewed(c,{capacity:4});
  const r=await overlap([()=>store.command(staff,a),()=>store.command(staff,b)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.status,409);assert.equal((await state()).state.classes.find(x=>x.id===c.id).editHistory.length,1);
 });
 await check('booking wins the lock: queued edit rechecks history and cannot commit',async()=>{
  const c=await make('Booking before edit'),cmd=await reviewed(c);
  const lock=await admin.connect();await lock.query('begin');await lock.query("select * from vega_private.app_state where business_id='studio' for update");
  // Commit a domain-valid booking while the edit is waiting behind this same state lock.
  let pending;
  try{
   pending=store.command(staff,cmd).then(value=>({value}),error=>({error}));
   let waiting=0;const deadline=Date.now()+4000;
   while(Date.now()<deadline){waiting=Number((await admin.query("select count(*) from pg_stat_activity where application_name='vega-hardening-test' and wait_event_type='Lock'")).rows[0].count);if(waiting)break;await new Promise(r=>setTimeout(r,20));}
   assert.equal(waiting,1,'edit must be waiting on the state lock');
   const {transition}=await import('../src/application.mjs');const row=await state();
   const next=transition(row.state,command('reserve',{classId:c.id,participantId:'p'}),{role:'member',userId:m1,participantIds:['p']});
   await lock.query("update vega_private.app_state set state=$1,revision=revision+1 where business_id='studio'",[JSON.stringify(next.state)]);await lock.query('commit');
  }finally{await lock.query('rollback');lock.release();}
  assert.equal((await pending).error?.status,409);assert.equal((await state()).state.classes.find(x=>x.id===c.id).editHistory,undefined);
  const r=(await state()).state.reservations.find(x=>x.classId===c.id);await store.command(m1,command('cancel',{},r.id));
  await assert.rejects(store.command(staff,cmd),/history exists/);
 });
 await check('concurrent booking and edit remain serializable without booking migration or credit effects',async()=>{
  const c=await make('Edit versus booking'),cmd=await reviewed(c),before=await state();
  const r=await overlap([()=>store.command(staff,cmd),()=>store.command(m1,command('reserve',{classId:c.id,participantId:'p'}))]);
  assert.equal(r[1].status,'fulfilled');if(r[0].status==='rejected')assert.equal(r[0].reason.status,409);
  const s=(await state()).state;assert.equal(s.reservations.filter(x=>x.classId===c.id).length,1);assert.deepEqual(s.creditEvents,before.state.creditEvents);
  await assert.rejects(async()=>store.command(staff,await reviewed(c)),/history exists/);
 });
}
