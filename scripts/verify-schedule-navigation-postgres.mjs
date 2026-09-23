import assert from 'node:assert/strict';
import {scheduleResults,visibleSelection} from '../public/schedule-navigation.js';
export async function verifyScheduleNavigation({store,staff,m1,state,admin,check}){
 await check('schedule navigation filters read authorized persisted occurrences without state or receipt writes',async()=>{
  const before=await state(),receipts=(await admin.query('select * from vega_private.app_commands order by request_id')).rows,d=await store.read(staff);
  const filters={from:'',to:'',text:'',status:'all'},all=scheduleResults(d,filters);assert.equal(all.occurrences.length,d.classes.length);
  for(const status of ['open','cancelled'])assert.ok(scheduleResults(d,{...filters,status}).occurrences.every(c=>c.status===status));
  const selected=all.occurrences[0].id;assert.equal(visibleSelection(selected,all),selected);assert.equal(visibleSelection(selected,scheduleResults(d,{...filters,text:'no such occurrence 6.7'})),'');
  assert.deepEqual(scheduleResults(await store.read(m1),filters).occurrences,[]);
  assert.deepEqual(await state(),before);assert.deepEqual((await admin.query('select * from vega_private.app_commands order by request_id')).rows,receipts);
 });
}
