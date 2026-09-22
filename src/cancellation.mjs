import {entitlementEligible} from './entitlements.mjs';
// Runs only inside the existing locked application-state transaction.
export function bookingAccounting(state, authority, {id, now}, fail) {
 state.creditUnits ||= []; state.creditEvents ||= [];
 const stamp=now();
 const event=(type,unit,bookingId,extra={})=>{
  const e={id:id(),type,unitId:unit.id,passId:unit.passId,participantId:unit.participantId,bookingId,actorId:authority.userId,createdAt:stamp,...extra};
  state.creditEvents.push(e);return e;
 };
 return {
  issue(body){
   if(!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>100||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)fail('Credit quantity and reason required');
   const entitlement=body.entitlement??{source:'staff_courtesy',validFrom:stamp,expiresAt:null,categories:[],classIds:[]};
   const pass={id:id(),participantId:body.participantId,label:body.label||'Staff courtesy class credits',quantity:body.quantity,entitlement:structuredClone(entitlement),createdAt:stamp};state.passes.push(pass);
   for(let n=0;n<body.quantity;n++){const unit={id:id(),passId:pass.id,participantId:pass.participantId,status:'available',entitlement:structuredClone(entitlement)};state.creditUnits.push(unit);event('issue',unit,null,{reason:body.reason,requestId:body.requestId,source:entitlement.source,issuanceId:entitlement.issuanceId??null});}
   return pass;
  },
  consume(r,c){
   if(!c.creditRequired||r.creditConsumption)return;
   const unit=state.creditUnits.filter(u=>u.participantId===r.participantId&&u.status==='available'&&(!r.passId||u.passId===r.passId)&&entitlementEligible(u,c,stamp)).sort((a,b)=>(Date.parse(a.entitlement?.expiresAt)||Infinity)-(Date.parse(b.entitlement?.expiresAt)||Infinity))[0];
   if(!unit)fail('No eligible class credit for this participant',409);
   unit.status='spent';unit.spentByBookingId=r.id;
   const e=event('consume',unit,r.id);
   r.creditConsumption={unitId:unit.id,passId:unit.passId,eventId:e.id};
  },
  restore(r){
   if(!r.creditConsumption)return 'not_applicable';
   const debit=state.creditUnits.find(u=>u.id===r.creditConsumption.unitId&&u.participantId===r.participantId&&u.spentByBookingId===r.id);
   if(!debit)fail('Booking credit provenance unavailable',409);
   let unit=state.creditUnits.find(u=>u.id===r.restoredCreditUnitId);
   if(unit){
    if(unit.originBookingId!==r.id||unit.participantId!==r.participantId||unit.passId!==debit.passId||unit.sourceUnitId!==debit.id)fail('Credit provenance mismatch',409);
    if(unit.status!=='reversed')return 'already_restored';
    unit.status='available';event('restore_after_reversal',unit,r.id);return 'restored';
   }
   unit={id:id(),passId:debit.passId,participantId:r.participantId,status:'available',originBookingId:r.id,sourceUnitId:debit.id,...(debit.entitlement?{entitlement:structuredClone(debit.entitlement)}:{})};
   state.creditUnits.push(unit);r.restoredCreditUnitId=unit.id;event('restore',unit,r.id);return 'restored';
  },
  reverse(r){
   if(!r.restoredCreditUnitId)return 'not_applicable';
   const unit=state.creditUnits.find(u=>u.id===r.restoredCreditUnitId&&u.originBookingId===r.id&&u.participantId===r.participantId);
   if(!unit)fail('Restored credit provenance unavailable',409);
   if(unit.status==='spent')return 'blocked_spent';
   if(unit.status==='reversed')return 'already_reversed';
   if(unit.status!=='available')fail('Invalid restored credit state',409);
   unit.status='reversed';event('reverse_restoration',unit,r.id);return 'reversed';
  }
 };
}

export function cancelBooking(state,r,c,body,authority,accounting,{id,now},fail,correction=false){
 const time=now();
 if(correction&&authority.role!=='staff')fail('Staff access required',403);
 if(body.classification!==undefined&&authority.role!=='staff')fail('Staff access required',403);
 if(!correction&&r.status==='cancelled')return {reservation:r,outcome:'unchanged'};
 if(correction&&r.status!=='cancelled')fail('Only cancelled bookings can be reclassified',409);
 if(!correction&&!['reserved','waitlisted'].includes(r.status))fail('Reservation cannot be cancelled',409);
 if(r.attendanceStatus!=='not_recorded')fail('Recorded attendance requires staff reconciliation',409);
 if(!c||!Number.isFinite(Date.parse(c.startsAt)))fail('Class unavailable',409);
 const cutoff=c.cancellationCutoffMinutes??90;
 const requested=body.classification;
 if(requested!==undefined&&authority.role!=='staff')fail('Staff access required',403);
 if((correction||requested!==undefined)&&!['early','late'].includes(requested))fail('Early or late classification required');
 if((correction||requested!==undefined)&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000))fail('Staff correction reason required');
 const classification=requested??(Date.parse(time)<=Date.parse(c.startsAt)-cutoff*60000?'early':'late');
 const from=r.cancellation?.classification??null;
 if(correction&&!r.cancellation)fail('Legacy cancellation requires separate reconciliation',409);
 let creditOutcome='not_applicable',outcome='applied';
 if(correction&&from===classification)outcome='unchanged';
 else if(classification==='early')creditOutcome=accounting.restore(r);
 else if(correction) {creditOutcome=accounting.reverse(r);if(creditOutcome==='blocked_spent')outcome='blocked';}
 const history={id:id(),action:correction?'correction':'cancel',from,to:classification,outcome,creditOutcome,actorId:authority.userId,actorRole:authority.role,reason:body.reason||null,requestId:body.requestId,createdAt:time};
 r.cancellationHistory ||= [];r.cancellationHistory.push(history);
 if(outcome==='applied'){
  if(!r.cancellation)r.cancellation={originalClassification:classification,originalCancelledAt:time,cutoffMinutes:cutoff,classStartsAt:c.startsAt,originalBookingStatus:r.status};
  r.status='cancelled';r.cancellation.classification=classification;r.cancellation.creditOutcome=creditOutcome;
 }
 return {reservation:r,outcome,creditOutcome,message:outcome==='blocked'?'Correction blocked: the specific restored credit has already been spent.':outcome==='unchanged'?'Classification already matches.':'Cancellation recorded.'};
}
