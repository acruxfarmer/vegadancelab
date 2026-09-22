import {memberBookingOption} from './member-booking.mjs';

// Read-only projections over the existing reservations; no separate queue or ledger.
export function orderedWaitlist(state,classId){
 return state.reservations.filter(r=>r.classId===classId&&r.status==='waitlisted').sort((a,b)=>{
  const time=r=>Number.isFinite(Date.parse(r.createdAt))?Date.parse(r.createdAt):0;
  return time(a)-time(b)||(a.id<b.id?-1:a.id>b.id?1:0);
 });
}
export function promotionOptions(state,c,at){
 const rows=orderedWaitlist(state,c.id).map((r,i)=>({reservationId:r.id,position:i+1,...memberBookingOption({...state,reservations:state.reservations.filter(x=>x.id!==r.id)},c,r.participantId,at,r.passId),...(r.creditConsumption||r.attendanceStatus!=='not_recorded'?{eligible:false,reason:'Waitlist state requires staff reconciliation; promotion blocked.'}:{})}));
 const first=rows.find(r=>r.eligible)?.reservationId;
 return rows.map(r=>({...r,promotable:r.eligible&&r.reservationId===first,reason:r.eligible&&r.reservationId!==first?'An earlier eligible participant must be promoted first.':r.reason}));
}
