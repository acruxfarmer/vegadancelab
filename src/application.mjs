import {bookingAccounting,cancelBooking} from './cancellation.mjs';
import {classCancellationOption,cancelClass} from './class-cancellation.mjs';
import {createClass} from './class-creation.mjs';
import {classDuplicateOption,duplicateClass} from './class-duplication.mjs';
import {classEditOption,editClass} from './class-editing.mjs';
import {entitlementOperations} from './entitlements.mjs';
import {memberBookingOption} from './member-booking.mjs';
import {orderedWaitlist,promotionOptions} from './waitlist.mjs';
import {memberCancellationOption} from './member-cancellation.mjs';
import {memberAccountSummary} from './member-account.mjs';
import { randomUUID } from 'node:crypto';

export class ApplicationError extends Error {
 constructor(message,status=400){ super(message); this.status=status; }
}
const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
const text=(value,max=200)=>typeof value==='string'&&value.trim()&&value.length<=max;
const bookableClass=(c,at)=>c&&c.status==='open'&&Number.isFinite(Date.parse(c.startsAt))&&Date.parse(c.startsAt)>Date.parse(at)&&Number.isInteger(c.capacity)&&c.capacity>0;
function reservationView(reservation,authority){
 const result=structuredClone(reservation);
 if(authority.role!=='staff'&&result.waitlistHistory)result.waitlistHistory=result.waitlistHistory.map(({action,from,to,createdAt})=>({action,from,to,createdAt}));
 if(authority.role!=='staff'&&result.attendanceHistory)result.attendanceHistory=result.attendanceHistory.map(({from,to,createdAt})=>({from,to,createdAt}));
 if(authority.role!=='staff'&&result.cancellationHistory)result.cancellationHistory=result.cancellationHistory.filter(e=>e.outcome==='applied').map(e=>({action:e.action,to:e.to,createdAt:e.createdAt,creditOutcome:e.creditOutcome}));
 return result;
}
export function emptyState(){return {classes:[],participants:[],reservations:[],passes:[],videos:[],events:[],products:[],orders:[],notifications:[],activity:[],preferences:[]};}
export function visibleState(state,authority,at=new Date().toISOString()){
 const result=Object.fromEntries(['classes','participants','reservations','passes','videos','events','products','orders','notifications','activity','preferences','creditUnits','creditEvents','entitlementProducts','entitlementIssuances','memberships'].map(k=>[k,structuredClone(state[k]||[])]));
 if(authority.role!=='staff'){
  result.classes=result.classes.map(({cancellationHistory,editHistory,creationProvenance,...c})=>c);
  const own=id=>authority.participantIds.includes(id);
  for(const key of ['participants','reservations','passes','orders','creditUnits']) result[key]=(result[key]||[]).filter(x=>own(key==='participants'?x.id:x.participantId));
  result.notifications=(result.notifications||[]).filter(x=>own(x.participantId)&&x.status==='published');
  result.preferences=(result.preferences||[]).filter(x=>own(x.participantId));
  result.activity=[];result.creditEvents=[];result.reservations=result.reservations.map(r=>reservationView(r,authority));
  result.entitlementIssuances=[];
  result.entitlementProducts=result.entitlementProducts.map(({createdBy,...p})=>p);
  result.memberships=result.memberships.filter(m=>own(m.participantId)).map(({reference,...m})=>m);
  result.bookingOptions=result.classes.flatMap(c=>result.participants.map(p=>memberBookingOption(state,c,p.id,at)));
  result.bookingCheckedAt=at;
  result.cancellationOptions=result.reservations.map(r=>memberCancellationOption(state,r,at));
  result.memberAccount=memberAccountSummary(result,at);
  for(const r of result.reservations)if(r.status==='waitlisted')r.waitlistPosition=orderedWaitlist(state,r.classId).findIndex(x=>x.id===r.id)+1;
 }
 result.classes=(result.classes||[]).map(c=>({...c,reservedCount:state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length}));
 if(authority.role==='staff'){
  result.bookingOptions=result.classes.flatMap(c=>result.participants.map(p=>memberBookingOption(state,c,p.id,at)));
  result.bookingCheckedAt=at;
  result.staffAccount=memberAccountSummary(result,at);
  result.promotionOptions=result.classes.flatMap(c=>promotionOptions(state,c,at));
  result.classCancellationOptions=state.classes.map(c=>classCancellationOption(state,c,at));
  result.classEditOptions=state.classes.map(c=>classEditOption(state,c,at));
  result.classDuplicateOptions=state.classes.map(c=>classDuplicateOption(c,at));
 }
 return result;
}
export function transition(original, command, authority, {id=randomUUID,now=()=>new Date().toISOString()}={}){
 const state=structuredClone(original), body=command.body||{};
 if(!text(body.requestId,128))fail('A request identifier is required');
 const staff=()=>{if(authority.role!=='staff')fail('Staff access required',403);};
 const own=participantId=>{if(!authority.participantIds.includes(participantId)&&authority.role!=='staff')fail('Participant authority required',403); if(!state.participants.some(p=>p.id===participantId))fail('Participant unavailable',404);};
 const accounting=['attendance','edit-class','duplicate-class'].includes(command.action)?null:bookingAccounting(state,authority,{id,now},fail);
 const waitlistEvent=(r,action,from,to)=>{(r.waitlistHistory??=[]).push({id:id(),action,from,to,actorId:authority.userId,actorRole:authority.role,requestId:body.requestId,createdAt:now()});};
 let result;
 if(command.action==='duplicate-class'){
  staff();result=duplicateClass(state,body,authority,{id,now},fail);return {state,result};
 }else if(command.action==='edit-class'){
  staff();result=editClass(state,body,authority,{id,now},fail);return {state,result};
 }else if(command.action==='cancel-class'){
  staff();result=cancelClass(state,body.classId,body,authority,{id,now},fail);return {state,result};
 }else if(command.action==='reserve'){
  own(body.participantId);
  const c=state.classes.find(x=>x.id===body.classId);
  if(!bookableClass(c,now()))fail('Class unavailable',409);
  if(state.reservations.some(r=>r.classId===c.id&&r.participantId===body.participantId&&['reserved','waitlisted'].includes(r.status)))fail('Already booked or waitlisted',409);
  const full=state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length>=c.capacity;
  if(body.waitlistOnly!==undefined&&typeof body.waitlistOnly!=='boolean')fail('Invalid waitlist intent');
  if(body.waitlistOnly===true&&(!full||!c.waitlistEnabled||body.reservationOnly===true))fail('Waitlist unavailable. Refresh and review the class before booking.',409);
  if(full&&(body.reservationOnly===true||(authority.role!=='staff'&&body.waitlistOnly!==true)||!c.waitlistEnabled))fail('Class full',409);
  result={id:id(),classId:c.id,participantId:body.participantId,status:full?'waitlisted':'reserved',paymentStatus:'not_evaluated',attendanceStatus:'not_recorded',notificationStatus:'not_requested',createdAt:now()};
  if(body.passId!==undefined){if(!state.passes.some(p=>p.id===body.passId&&p.participantId===body.participantId))fail('Participant pass unavailable',403);result.passId=body.passId;}
  if(!full)accounting.consume(result,c);else waitlistEvent(result,'joined',null,'waitlisted');state.reservations.push(result);
 }else if(['cancel','correct-cancellation','attendance'].includes(command.action)){
  if(command.action==='attendance')staff();
  const r=state.reservations.find(x=>x.id===command.id);if(!r)fail('Reservation unavailable',404);
  if(command.action==='attendance'){
   staff();if(r.status!=='reserved')fail('Only reserved participants can be checked in',409);
   if(!['present','absent','not_recorded'].includes(body.status))fail('Invalid attendance status');
   const from=r.attendanceStatus||'not_recorded',revision=r.attendanceRevision||0;
   if(body.expectedRevision!==undefined&&(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0))fail('Invalid attendance revision');
   if(body.reason!==undefined&&(typeof body.reason!=='string'||body.reason.length>1000))fail('Invalid attendance reason');
   if(from===body.status)return {state,result:{...r,outcome:'unchanged'}};
   if(body.expectedRevision!==undefined&&body.expectedRevision!==revision)fail('Attendance changed since this roster was loaded. Refresh and review before correcting it.',409);
   if((revision>0||from!=='not_recorded')&&!text(body.reason,1000))fail('A reason is required to correct attendance');
   const recordedAt=now(),historyId=id();
   (r.attendanceHistory??=[]).push({id:historyId,action:revision>0||from!=='not_recorded'?'correction':'recorded',from,to:body.status,actorId:authority.userId,createdAt:recordedAt,reason:body.reason?.trim()||'',requestId:body.requestId,revision:revision+1});
   r.attendanceStatus=body.status;r.attendanceRevision=revision+1;
   state.activity.push({id:id(),action:'attendance',actorId:authority.userId,subjectId:r.id,attendanceHistoryId:historyId,createdAt:recordedAt});
   return {state,result:{...r,outcome:'applied'}};
  }else{
   own(r.participantId);const cancelAt=now();
   if(command.action==='correct-cancellation'){staff();if(r.classCancellation)fail('Occurrence cancellation requires separate reconciliation',409);}
   if(body.expectedReservationStatus!==undefined&&body.expectedReservationStatus!=='waitlisted')fail('Invalid expected reservation status');
   if(body.expectedReservationStatus==='waitlisted'&&r.status!=='waitlisted'&&!(r.status==='cancelled'&&r.cancellation?.originalBookingStatus==='waitlisted'))fail('This entry is no longer waitlisted. Refresh and review the confirmed booking before cancelling.',409);
   const wasWaiting=r.status==='waitlisted';
   if(command.action==='cancel'&&authority.role!=='staff'&&r.status!=='cancelled'){
    const option=memberCancellationOption(state,r,cancelAt);
    if(!option.allowed)fail(option.reason,409);
    if(body.expectedCancellationClassification!==undefined&&body.expectedCancellationClassification!==option.classification)fail('The cancellation consequence has changed. Review the current consequence before confirming again.',409);
   }
   const change=cancelBooking(state,r,state.classes.find(c=>c.id===r.classId),body,authority,accounting,{id,now:()=>cancelAt},fail,command.action==='correct-cancellation');if(wasWaiting&&change.outcome==='applied')waitlistEvent(r,'left','waitlisted','cancelled');if(change.outcome==='unchanged'&&command.action==='cancel')return {state,result:reservationView(r,authority)};state.activity.push({id:id(),action:command.action,actorId:authority.userId,subjectId:r.id,outcome:change.outcome,createdAt:cancelAt});return {state,result:{...reservationView(r,authority),outcome:change.outcome,creditOutcome:change.creditOutcome,message:change.message}};
  }
  result=r;
 }else if(command.action==='promote'){
  staff();const r=state.reservations.find(x=>x.id===command.id);if(r?.status==='reserved'&&r.waitlistHistory?.some(h=>h.action==='promoted'))return {state,result:{...r,outcome:'unchanged'}};if(!r||r.status!=='waitlisted')fail('Waitlist entry unavailable',409);
  const c=state.classes.find(x=>x.id===r.classId);if(!bookableClass(c,now())||state.reservations.filter(x=>x.classId===c.id&&x.status==='reserved').length>=c.capacity)fail('No capacity available',409);
  const option=promotionOptions(state,c,now()).find(o=>o.reservationId===r.id);if(!option?.promotable)fail(option?.reason||'Promotion unavailable',409);
  if(body.passId!==undefined&&body.passId!==option.passId)fail('Eligible credit changed. Refresh and review before promotion.',409);
  accounting.consume(r,c);r.status='reserved';waitlistEvent(r,'promoted','waitlisted','reserved');result=r;
 }else if(command.action==='issue-credit'){
  staff();own(body.participantId);result=accounting.issue({participantId:body.participantId,quantity:body.quantity,reason:body.reason,requestId:body.requestId});
 }else if(['entitlement-product','issue-entitlement'].includes(command.action)){
  staff();const entitlements=entitlementOperations(state,authority,{id,now},fail,accounting);
  if(command.action==='entitlement-product')result=entitlements.product(body);
  else {own(body.participantId);result=entitlements.issue(body);}
 }else if(command.action==='class-policy'){
  staff();const c=state.classes.find(c=>c.id===body.classId);if(!c)fail('Class unavailable',404);if(!Number.isInteger(body.cancellationCutoffMinutes)||body.cancellationCutoffMinutes<0||body.cancellationCutoffMinutes>10080)fail('Invalid cancellation cutoff');const before=c.cancellationCutoffMinutes??90;c.cancellationCutoffMinutes=body.cancellationCutoffMinutes;state.activity.push({id:id(),action:'cancellation-policy',subjectId:c.id,from:before,to:c.cancellationCutoffMinutes,actorId:authority.userId,createdAt:now()});result=c;
 }else if(command.action==='class'){
  staff();result=createClass(state,body,authority,{id,now},fail);return {state,result};
 }else if(command.action==='participant'){
  staff();if(!text(body.name))fail('Participant name required');result={id:id(),name:body.name,relationship:'Studio participant'};state.participants.push(result);
 }else if(command.action==='preferences'){
  own(body.participantId);if(!['email','sms'].includes(body.channel)||!['studio_updates','class_notifications'].includes(body.purpose)||typeof body.allowed!=='boolean')fail('Invalid communication preference');
  result={participantId:body.participantId,sender:'vega',channel:body.channel,purpose:body.purpose,allowed:body.allowed,updatedAt:now()};
  state.preferences=state.preferences.filter(x=>!(x.participantId===result.participantId&&x.channel===result.channel&&x.purpose===result.purpose));state.preferences.push(result);
 }else if(command.action==='notification'){
  staff();own(body.participantId);if(!text(body.subject)||!text(body.message,4000))fail('Message details required');
  result={id:id(),participantId:body.participantId,subject:body.subject,message:body.message,status:'draft',deliveryStatus:'disabled',createdAt:now()};state.notifications.push(result);
 }else fail('Unknown operation',404);
 state.activity.push({id:id(),action:command.action,actorId:authority.userId,subjectId:result.id||result.participantId,createdAt:now()});
 return {state,result:command.action==='reserve'?reservationView(result,authority):result};
}
