import {eligibleCredits} from './entitlements.mjs';

// Read-only explanation of the existing transaction's rules, scoped by visibleState.
export function memberBookingOption(state,c,participantId,at){
 const base={classId:c.id,participantId,creditRequired:!!c.creditRequired};
 const blocked=reason=>({...base,eligible:false,reason});
 if(!state.participants.some(p=>p.id===participantId))return blocked('Participant unavailable.');
 if(c.status!=='open'||!Number.isFinite(Date.parse(c.startsAt))||!Number.isFinite(Date.parse(at))||Date.parse(c.startsAt)<=Date.parse(at)||!Number.isInteger(c.capacity)||c.capacity<1)return blocked('This class is no longer available to book.');
 if(state.reservations.some(r=>r.classId===c.id&&r.participantId===participantId&&['reserved','waitlisted'].includes(r.status)))return blocked('You already have a booking for this class.');
 if(state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length>=c.capacity)return blocked('This class is full.');
 if(!c.creditRequired)return {...base,eligible:true,reason:'Eligible to book. No class credit is required.'};
 const units=eligibleCredits(state,c,participantId,at),unit=units[0];
 if(!unit)return blocked('No eligible class credit. Credits must cover this class and be valid now and at class start.');
 return {...base,eligible:true,reason:'Eligible to book with one class credit.',passId:unit.passId,passLabel:state.passes.find(p=>p.id===unit.passId)?.label||'Class credit',eligibleCredits:units.filter(u=>u.passId===unit.passId).length,expiresAt:unit.entitlement?.expiresAt??null};
}
