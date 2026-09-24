import assert from 'node:assert/strict';
import {reservationHistory,historyResults,reservationHistoryTypes} from '../public/reservation-history.js';
export async function verifyReservationHistory({store,staff,m1,state,admin,check}){
 await check('reservation history projects persisted explicit evidence deterministically without state/revision/receipt writes',async()=>{
  const before=await state(),receipts=(await admin.query('select * from vega_private.app_commands order by request_id')).rows,first=await store.read(staff),second=await store.read(staff),types=new Set();
  for(const r of first.reservations){const h=reservationHistory(first,r.id);assert.deepEqual(h,reservationHistory(second,r.id));assert.equal(new Set(h.events.map(e=>e.eventId)).size,h.events.length);
   for(const type of ['all',...reservationHistoryTypes]){const filtered=historyResults(h,{type,text:'unrecorded'});assert.equal(filtered.total,h.events.length);assert.ok(filtered.events.every(e=>h.events.includes(e)));}
   for(const event of h.events){types.add(event.type);assert.equal(event.reservationId,r.id);assert.equal(event.participantId,r.participantId);if(event.type==='cancellation-correction'&&['blocked','unchanged'].includes(event.outcome))assert.equal(event.after.cancellationClassification,'unrecorded');}
   for(const item of r.attendanceHistory||[])assert.equal(h.events.filter(e=>e.type==='attendance-change'&&e.evidence.some(x=>x.source==='attendanceHistory'&&x.record.id===item.id)).length,1);
  }
  assert.deepEqual([...types].sort(),['attendance-change','cancellation','cancellation-correction','creation','waitlist-promotion']);assert.deepEqual(await state(),before);assert.deepEqual((await admin.query('select * from vega_private.app_commands order by request_id')).rows,receipts);
 });
 await check('reservation-history projection excludes member and foreign-business data',async()=>{
  const d=await store.read(staff),member=await store.read(m1),r=d.reservations.find(r=>r.classId!=='class');assert.ok(r);assert.deepEqual(reservationHistory(member,r.id).events,[]);
  await admin.query("update vega_private.app_members set business_id='other' where user_id=$1",[staff]);
  try{assert.deepEqual(reservationHistory(await store.read(staff),r.id).events,[]);}finally{await admin.query("update vega_private.app_members set business_id='studio' where user_id=$1",[staff]);}
 });
}
