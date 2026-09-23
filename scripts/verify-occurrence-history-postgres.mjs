import assert from 'node:assert/strict';
import {occurrenceHistory} from '../public/occurrence-history.js';
export async function verifyOccurrenceHistory({store,staff,m1,state,admin,check}){
 await check('occurrence history reads persisted lifecycle evidence once without state, revision or receipt writes',async()=>{
  const before=await state(),receipts=(await admin.query('select * from vega_private.app_commands order by request_id')).rows;
  const first=await store.read(staff),second=await store.read(staff),types=new Set();
  for(const c of first.classes){const h=occurrenceHistory(first,c.id);assert.deepEqual(h,occurrenceHistory(second,c.id));for(const e of h)types.add(e.type);
   for(const e of c.editHistory||[])assert.equal(h.filter(x=>x.type==='edit'&&x.eventId===e.id).length,1);
   for(const e of c.cancellationHistory||[])assert.equal(h.filter(x=>x.type==='cancellation'&&x.eventId===e.id).length,1);
   if(c.creationProvenance){assert.equal(h.filter(e=>e.type==='creation-from-existing').length,1);assert.ok(h.every(e=>e.occurrenceId===c.id));}
  }
  assert.deepEqual([...types].sort(),['cancellation','creation','creation-from-existing','edit']);assert.deepEqual(await state(),before);assert.deepEqual((await admin.query('select * from vega_private.app_commands order by request_id')).rows,receipts);
 });
 await check('occurrence history remains staff-only and respects database business scoping',async()=>{
  const d=await store.read(staff),member=await store.read(m1),copy=d.classes.find(c=>c.creationProvenance);
  assert.ok(copy);assert.deepEqual(occurrenceHistory(member,copy.id),[]);assert.equal(member.classes.find(c=>c.id===copy.id).creationProvenance,undefined);assert.deepEqual(member.activity,[]);
  await admin.query("update vega_private.app_members set business_id='other' where user_id=$1",[staff]);
  try{assert.deepEqual(occurrenceHistory(await store.read(staff),copy.id),[]);}finally{await admin.query("update vega_private.app_members set business_id='studio' where user_id=$1",[staff]);}
 });
}
