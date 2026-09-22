import assert from 'node:assert/strict';
import {classCancellationOption} from '../src/class-cancellation.mjs';
export async function verifyClassCancellation({store,staff,m1,m2,state,command,overlap,admin,check}){
 const make=async(title,capacity=1)=>store.command(staff,command('class',{title,instructor:'Local test',location:'Local',capacity,duration:60,startsAt:'2099-10-02T12:00:00Z',creditRequired:true,waitlistEnabled:true}));
 const review=async c=>{const s=(await state()).state;return command('cancel-class',{classId:c.id,reason:'Local occurrence cancellation',impactToken:classCancellationOption(s,s.classes.find(x=>x.id===c.id),new Date().toISOString()).impactToken});};
 await store.command(staff,command('issue-credit',{participantId:'p',quantity:5,reason:'Local cancellation fixture'}));
 await store.command(staff,command('issue-credit',{participantId:'q',quantity:5,reason:'Local cancellation fixture'}));
 await check('class cancellation receipt failure rolls back occurrence, all reservations, credits and audit; concurrent replay commits once',async()=>{
  const c=await make('Atomic class cancellation'),r=await store.command(m1,command('reserve',{classId:c.id,participantId:'p'})),w=await store.command(m2,command('reserve',{classId:c.id,participantId:'q',waitlistOnly:true}));
  const cmd=await review(c),before=await state();
  await assert.rejects(store.command(m1,cmd),e=>e.status===403);assert.deepEqual(await state(),before);
  await admin.query('create trigger fail_receipt before insert on vega_private.app_commands for each row execute function vega_private.fail_receipt()');
  await assert.rejects(store.command(staff,cmd),/synthetic receipt failure/);assert.deepEqual(await state(),before);
  await admin.query('drop trigger fail_receipt on vega_private.app_commands');
  const results=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,cmd)]);assert.ok(results.every(x=>x.status==='fulfilled'));assert.deepEqual(results[0].value,results[1].value);
  const after=await state(),s=after.state;assert.equal(BigInt(after.revision),BigInt(before.revision)+1n);assert.equal(s.classes.find(x=>x.id===c.id).cancellationHistory.length,1);assert.equal(s.reservations.find(x=>x.id===r.id).status,'cancelled');assert.equal(s.reservations.find(x=>x.id===w.id).waitlistHistory.at(-1).action,'closed');assert.equal(s.creditEvents.length,before.state.creditEvents.length+1);
  const read=await store.read(m1);assert.equal(read.classes.find(x=>x.id===c.id).status,'cancelled');assert.equal(read.reservations.find(x=>x.id===r.id).status,'cancelled');assert.equal(read.classes.find(x=>x.id===c.id).cancellationHistory,undefined);
  await store.command(staff,await review(c));assert.deepEqual((await state()).state,s);
 });
 await check('concurrent class cancellation and waitlist promotion cannot confirm stale impact or strand consumed credit',async()=>{
  const c=await make('Cancellation versus promotion'),r=await store.command(m1,command('reserve',{classId:c.id,participantId:'p'})),w=await store.command(m2,command('reserve',{classId:c.id,participantId:'q',waitlistOnly:true}));
  await store.command(m1,command('cancel',{},r.id));const cmd=await review(c);
  const results=await overlap([()=>store.command(staff,cmd),()=>store.command(staff,command('promote',{},w.id))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
  let s=(await state()).state;if(s.classes.find(x=>x.id===c.id).status==='open')await store.command(staff,await review(c));
  s=(await state()).state;const final=s.reservations.find(x=>x.id===w.id);assert.equal(final.status,'cancelled');assert.equal(s.creditEvents.filter(e=>e.bookingId===w.id&&e.type==='consume').length,s.creditEvents.filter(e=>e.bookingId===w.id&&e.type==='restore').length);
 });
 await check('concurrent class cancellation and new booking serialize; attendance history blocks after database reload',async()=>{
  const c=await make('Cancellation versus booking',2),r=await store.command(m1,command('reserve',{classId:c.id,participantId:'p'})),cmd=await review(c);
  const results=await overlap([()=>store.command(staff,cmd),()=>store.command(m2,command('reserve',{classId:c.id,participantId:'q'}))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
  if((await state()).state.classes.find(x=>x.id===c.id).status==='open')await store.command(staff,await review(c));
  const a=await make('Historical attendance block'),ar=await store.command(m1,command('reserve',{classId:a.id,participantId:'p'}));
  await store.command(staff,command('attendance',{status:'present'},ar.id));await store.command(staff,command('attendance',{status:'not_recorded',reason:'Clear with history'},ar.id));await store.command(m1,command('cancel',{},ar.id));
  const before=await state();await assert.rejects(store.command(staff,await review(a)),/Attendance has been recorded/);assert.deepEqual(await state(),before);
 });
}
