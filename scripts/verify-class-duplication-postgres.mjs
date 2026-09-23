import assert from 'node:assert/strict';
export async function verifyClassDuplication({store,staff,m1,state,command,overlap,admin,check}){
 const make=()=>store.command(staff,command('class',{title:'Copy source',instructor:'Local instructor',location:'Local studio',capacity:2,duration:60,startsAt:'2099-10-02T12:00:00Z',creditRequired:false,waitlistEnabled:true}));
 const reviewed=async c=>{const d=await store.read(staff),o=d.classDuplicateOptions.find(o=>o.classId===c.id),b={classId:c.id,versionToken:o.versionToken,details:{startsAt:'2099-10-03T12:00:00Z'}};const r=await store.reviewClassDuplicate(staff,b);return command('duplicate-class',{...b,reviewToken:r.reviewToken});};
 await check('duplication review is read-only; member denied; receipt rollback and concurrent replay preserve one independent snapshot',async()=>{
  const c=await make();await store.command(m1,command('reserve',{classId:c.id,participantId:'p'}));
  const before=await state(),cmd=await reviewed(c);assert.deepEqual(await state(),before);
  await assert.rejects(store.reviewClassDuplicate(m1,cmd.body),e=>e.status===403);await assert.rejects(store.command(m1,cmd),e=>e.status===403);
  await admin.query('create trigger fail_receipt before insert on vega_private.app_commands for each row execute function vega_private.fail_receipt()');
  try{await assert.rejects(store.command(staff,cmd),/synthetic receipt failure/);assert.deepEqual(await state(),before);}finally{await admin.query('drop trigger fail_receipt on vega_private.app_commands');}
  const results=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,cmd)]);assert.ok(results.every(r=>r.status==='fulfilled'));assert.deepEqual(results[0].value,results[1].value);
  const copy=results[0].value,after=await state();assert.notEqual(copy.id,c.id);assert.equal(after.state.classes.length,before.state.classes.length+1);assert.equal(BigInt(after.revision),BigInt(before.revision)+1n);
  assert.deepEqual(after.state.classes.find(x=>x.id===c.id),before.state.classes.find(x=>x.id===c.id));
  for(const key of Object.keys(before.state).filter(k=>!['classes','activity'].includes(k)))assert.deepEqual(after.state[key],before.state[key]);
  assert.equal(after.state.reservations.filter(r=>r.classId===copy.id).length,0);assert.equal(copy.creationProvenance.actorId,staff);assert.equal(copy.creationProvenance.requestId,cmd.body.requestId);assert.equal(copy.creationProvenance.sourceClassId,c.id);assert.equal(after.state.activity.filter(e=>e.subjectId===copy.id).length,1);
  const sv=await store.read(staff),mv=await store.read(m1),{creationProvenance,...sc}=sv.classes.find(x=>x.id===copy.id);assert.deepEqual(mv.classes.find(x=>x.id===copy.id),sc);assert.equal(mv.classDuplicateOptions,undefined);
  await assert.rejects(store.command(staff,{...cmd,body:{...cmd.body,details:{startsAt:'2099-10-04T12:00:00Z'}}}),e=>e.status===409);assert.deepEqual(await state(),after);
  // Replaying a committed request remains safe even if its source later changes.
  await store.command(staff,command('class-policy',{classId:c.id,cancellationCutoffMinutes:120}));const changed=await state();assert.deepEqual(await store.command(staff,cmd),copy);assert.deepEqual(await state(),changed);
 });
 await check('source change committed ahead of a queued confirmation rejects under the same lock without creating an occurrence',async()=>{
  const c=await make(),cmd=await reviewed(c),lock=await admin.connect();let pending;
  await lock.query('begin');await lock.query("select * from vega_private.app_state where business_id='studio' for update");
  try{
   pending=store.command(staff,cmd).then(value=>({value}),error=>({error}));
   let waiting=0;const deadline=Date.now()+4000;
   while(Date.now()<deadline){waiting=Number((await admin.query("select count(*) from pg_stat_activity where application_name='vega-hardening-test' and wait_event_type='Lock'")).rows[0].count);if(waiting)break;await new Promise(r=>setTimeout(r,20));}
   assert.equal(waiting,1);const row=await state();row.state.classes.find(x=>x.id===c.id).title='Changed before confirmation';
   await lock.query("update vega_private.app_state set state=$1,revision=revision+1 where business_id='studio'",[JSON.stringify(row.state)]);await lock.query('commit');
  }finally{await lock.query('rollback');lock.release();}
  assert.equal((await pending).error?.status,409);const after=await state();assert.equal(after.state.classes.filter(x=>x.creationProvenance?.sourceClassId===c.id).length,0);
  assert.equal((await admin.query('select count(*) from vega_private.app_commands where request_id=$1',[cmd.body.requestId])).rows[0].count,'0');
 });
 await check('duplication rechecks staff authority after lock wait and scopes source lookup to assigned business',async()=>{
  const c=await make(),cmd=await reviewed(c),before=await state();
  const results=await overlap([()=>store.command(staff,cmd)],()=>admin.query("update vega_private.app_members set role='member' where user_id=$1",[staff]));
  try{assert.equal(results[0].reason?.status,403);assert.deepEqual(await state(),before);}finally{await admin.query("update vega_private.app_members set role='staff' where user_id=$1",[staff]);}
  await admin.query("update vega_private.app_members set business_id='other' where user_id=$1",[staff]);
  try{await assert.rejects(store.reviewClassDuplicate(staff,cmd.body),e=>e.status===404);await assert.rejects(store.command(staff,cmd),e=>e.status===404);}finally{await admin.query("update vega_private.app_members set business_id='studio' where user_id=$1",[staff]);}
  assert.deepEqual(await state(),before);
 });
}
