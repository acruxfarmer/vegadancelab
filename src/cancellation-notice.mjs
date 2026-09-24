// A recorded consequence of the canonical cancellation, never an external dispatch.
export function recordCancellationNotice(state,reservation,occurrence,event,effect,{id}){
 const restored=effect.creditOutcome==='restored';
 const creditEvent=restored?state.creditEvents.find(e=>e.bookingId===reservation.id&&e.unitId===effect.restoredCreditUnitId&&e.classCancellationEventId===event.id&&['restore','restore_after_reversal'].includes(e.type)):null;
 if(restored&&!creditEvent)throw new Error('Cancellation restoration evidence unavailable');
 const notice={id:id(),type:'occurrence-cancellation',version:1,status:'published',deliveryStatus:'disabled',
  participantId:reservation.participantId,reservationId:reservation.id,occurrenceId:occurrence.id,cancellationEventId:event.id,createdAt:event.createdAt,
  subject:'Your class has been cancelled',
  classSnapshot:Object.fromEntries(['title','startsAt','duration','instructor','location','category'].map(key=>[key,structuredClone(occurrence[key]??null)])),
  reservationSnapshot:{from:effect.from,to:effect.to},
  creditSnapshot:{outcome:effect.creditOutcome,quantity:restored?1:0,...(restored?{restoredCreditUnitId:effect.restoredCreditUnitId,creditEventId:creditEvent.id,passId:creditEvent.passId}:{})}};
 (state.notifications??=[]).push(notice);
 reservation.notificationStatus='in_app_available';
 return notice;
}
