import {cancellationClassification} from './cancellation.mjs';

// Read-only member eligibility; all credit movements remain in cancelBooking.
export function memberCancellationOption(state,r,at){
 const base={reservationId:r.id},blocked=reason=>({...base,allowed:false,reason});
 if(r.status==='cancelled')return blocked('This booking is already cancelled. No additional credit change is needed.');
 if(!['reserved','waitlisted'].includes(r.status))return blocked('This booking cannot be cancelled online. Contact the studio.');
 const c=state.classes.find(c=>c.id===r.classId);
 if(!c||!Number.isFinite(Date.parse(c.startsAt)))return blocked('Class details are unavailable. Contact the studio to cancel this booking.');
 if(Date.parse(c.startsAt)<=Date.parse(at))return blocked('This class has already started. Contact the studio about this booking.');
 if(r.attendanceStatus!=='not_recorded')return blocked('Attendance has been recorded. Contact the studio to cancel this booking.');
 const pass=state.passes.find(p=>p.id===r.creditConsumption?.passId&&p.participantId===r.participantId);
 return {...base,allowed:true,classification:cancellationClassification(c,at),cutoffAt:new Date(Date.parse(c.startsAt)-(c.cancellationCutoffMinutes??90)*60000).toISOString(),creditConsumed:!!r.creditConsumption,passLabel:pass?.label||'Class credit',expiresAt:pass?.entitlement?.expiresAt??null};
}
