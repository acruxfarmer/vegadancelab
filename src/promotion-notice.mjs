// Recorded in the same aggregate transaction as promotion; never dispatches externally.
export function recordPromotionNotice(state,reservation,occurrence,event,{id}){
 const notice={id:id(),type:'waitlist-promotion',version:1,status:'published',deliveryStatus:'disabled',
  participantId:reservation.participantId,reservationId:reservation.id,occurrenceId:occurrence.id,promotionEventId:event.id,createdAt:event.createdAt,
  subject:'Your waitlist place is confirmed',
  classSnapshot:Object.fromEntries(['title','startsAt','duration','instructor','location','category'].map(key=>[key,structuredClone(occurrence[key]??null)])),
  creditSnapshot:reservation.creditConsumption?{outcome:'consumed',quantity:1,passId:reservation.creditConsumption.passId,creditEventId:reservation.creditConsumption.eventId}:{outcome:'not_required',quantity:0}};
 (state.notifications??=[]).push(notice);
 reservation.promotionNoticeId=notice.id;
 // Availability in Vega is distinct from external delivery or acknowledgement.
 reservation.notificationStatus='in_app_available';
 return notice;
}
