import assert from 'node:assert/strict';
import {rosterResults,defaultRosterFilters} from '../public/roster-navigation.js';
export async function verifyRosterNavigation({store,staff,m1,state,admin,check}){
 await check('roster filtering preserves persisted state, receipts, totals and canonical eligibility projections',async()=>{
  const before=await state(),receipts=(await admin.query('select * from vega_private.app_commands order by request_id')).rows,d=await store.read(staff),snapshot=structuredClone(d);
  for(const c of d.classes)for(const booking of ['all','reserved','waitlisted','cancelled'])for(const attendance of ['all','present','absent','not_recorded']){
   const result=rosterResults(d,c.id,{text:'',booking,attendance});assert.equal(result.total,d.reservations.filter(r=>r.classId===c.id).length);
   assert.ok(result.rows.every(r=>r.classId===c.id));
  }
  assert.deepEqual(d,snapshot);assert.deepEqual(await state(),before);assert.deepEqual((await admin.query('select * from vega_private.app_commands order by request_id')).rows,receipts);
 });
 await check('roster navigation excludes member and foreign-business occurrence data',async()=>{
  const d=await store.read(staff),c=d.classes.find(c=>d.reservations.some(r=>r.classId===c.id));assert.ok(c);
  assert.deepEqual(rosterResults(await store.read(m1),c.id,defaultRosterFilters()).rows,[]);
  const privateOccurrence=d.classes.find(c=>c.id!=='class');assert.ok(privateOccurrence);
  await admin.query("update vega_private.app_members set business_id='other' where user_id=$1",[staff]);
  try{assert.deepEqual(rosterResults(await store.read(staff),privateOccurrence.id,defaultRosterFilters()).rows,[]);}finally{await admin.query("update vega_private.app_members set business_id='studio' where user_id=$1",[staff]);}
 });
}
