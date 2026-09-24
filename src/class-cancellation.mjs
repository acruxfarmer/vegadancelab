import {createHash} from 'node:crypto';
import {bookingAccounting,cancelBooking} from './cancellation.mjs';
import {recordCancellationNotice} from './cancellation-notice.mjs';

const active=r=>['reserved','waitlisted'].includes(r.status);
// The preview and commit use the same cancellation engine, on an isolated copy.
function apply(state,c,authority,body,{id,now},fail){
 const eventId=id(),at=now(),accounting=bookingAccounting(state,authority,{id,now:()=>at},fail),affected=[];
 for(const r of state.reservations.filter(r=>r.classId===c.id&&active(r))){
  const from=r.status,creditStart=state.creditEvents.length;
  if(from==='waitlisted'&&(r.creditConsumption||r.restoredCreditUnitId))fail('Waiting credit state requires separate reconciliation',409);
  if(from==='reserved'&&c.creditRequired&&!r.creditConsumption)fail('Booking credit provenance requires separate reconciliation',409);
  if(r.creditConsumption){
   const debit=state.creditUnits.find(u=>u.id===r.creditConsumption.unitId);
   const consume=state.creditEvents.find(e=>e.id===r.creditConsumption.eventId&&e.type==='consume'&&e.bookingId===r.id&&e.unitId===debit?.id&&e.participantId===r.participantId);
   if(!debit||debit.status!=='spent'||debit.passId!==r.creditConsumption.passId||!consume||r.restoredCreditUnitId)fail('Booking credit lineage requires separate reconciliation',409);
  }
  const change=cancelBooking(state,r,c,{requestId:body.requestId,classification:'early',reason:body.reason},authority,accounting,{id,now:()=>at},fail);
  r.classCancellation={eventId,classId:c.id,createdAt:at};
  Object.assign(r.cancellationHistory.at(-1),{source:'class_cancellation',classCancellationEventId:eventId});
  if(from==='waitlisted')(r.waitlistHistory??=[]).push({id:id(),action:'closed',from,to:'cancelled',actorId:authority.userId,actorRole:authority.role,requestId:body.requestId,createdAt:at,classCancellationEventId:eventId});
  for(const e of state.creditEvents.slice(creditStart))Object.assign(e,{source:'class_cancellation',classCancellationEventId:eventId});
  const effect={reservationId:r.id,participantId:r.participantId,from,to:'cancelled',creditOutcome:change.creditOutcome,restoredCreditUnitId:r.restoredCreditUnitId||null};
  effect.noticeId=recordCancellationNotice(state,r,c,{id:eventId,createdAt:at},effect,{id}).id;
  affected.push(effect);
 }
 c.status='cancelled';c.cancelledAt=at;
 (c.cancellationHistory??=[]).push({id:eventId,action:'class-cancelled',actorId:authority.userId,actorRole:authority.role,createdAt:at,requestId:body.requestId,reason:body.reason,affected});
 state.activity.push({id:id(),action:'cancel-class',actorId:authority.userId,subjectId:c.id,classCancellationEventId:eventId,createdAt:at});
 return {classId:c.id,outcome:'applied',eventId,affectedCount:affected.length,noticeIds:affected.map(r=>r.noticeId)};
}

export function classCancellationOption(state,c,at){
 const rows=state.reservations.filter(r=>r.classId===c.id),bookings=rows.filter(r=>r.status==='reserved'),waiting=rows.filter(r=>r.status==='waitlisted');
 const option={classId:c.id,activeBookings:bookings.length,waitingEntries:waiting.length,expectedNotices:bookings.length+waiting.length,expectedRestorations:bookings.filter(r=>r.creditConsumption).length,allowed:false,reason:''};
 if(c.status!=='open')option.reason=c.status==='cancelled'?'This occurrence is already cancelled.':'This occurrence is not open.';
 else if(!Number.isFinite(Date.parse(c.startsAt))||Date.parse(c.startsAt)<=Date.parse(at))option.reason='Only an upcoming occurrence can be cancelled.';
 else if(rows.some(r=>(r.attendanceStatus&&r.attendanceStatus!=='not_recorded')||(r.attendanceHistory||[]).length||(r.attendanceRevision||0)>0))option.reason='Attendance has been recorded for this occurrence. Separate staff reconciliation is required.';
 else if(rows.some(r=>!['reserved','waitlisted','cancelled'].includes(r.status)))option.reason='An unsupported reservation state requires separate reconciliation.';
 else{
  try{
   const copy=structuredClone(state);let seq=0;
   apply(copy,copy.classes.find(x=>x.id===c.id),{role:'staff',userId:'preview'},{requestId:'preview',reason:'Class cancellation preview'},{id:()=>`preview-${++seq}`,now:()=>at},message=>{throw new Error(message);});
   option.allowed=true;option.reason='All active bookings will be cancelled and consumed credits restored under their original terms. Waiting entries will close without credit movement.';
  }catch(error){option.reason=error.message;}
 }
 const debitIds=new Set(bookings.map(r=>r.creditConsumption?.unitId));
 option.impactToken=createHash('sha256').update(JSON.stringify({c,rows,units:(state.creditUnits||[]).filter(u=>debitIds.has(u.id)),events:(state.creditEvents||[]).filter(e=>bookings.some(r=>r.id===e.bookingId))})).digest('hex');
 return option;
}

export function cancelClass(state,classId,body,authority,clock,fail){
 if(authority.role!=='staff')fail('Staff access required',403);
 if(typeof classId!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(classId))fail('Invalid class identifier');
 const c=state.classes.find(c=>c.id===classId);if(!c)fail('Class unavailable',404);
 if(c.status==='cancelled'&&c.cancellationHistory?.length)return {classId:c.id,outcome:'unchanged',eventId:c.cancellationHistory.at(-1).id};
 if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)fail('A class cancellation reason is required');
 const option=classCancellationOption(state,c,clock.now());
 if(!option.allowed)fail(option.reason,409);
 if(body.impactToken!==option.impactToken)fail('Class impact changed. Refresh and review the cancellation before confirming again.',409);
 return apply(state,c,authority,{...body,reason:body.reason.trim()},clock,fail);
}
