import {bookingAccounting,cancelBooking} from './cancellation.mjs';
import {entitlementOperations} from './entitlements.mjs';
import {memberBookingOption} from './member-booking.mjs';
import {memberCancellationOption} from './member-cancellation.mjs';
import {memberAccountSummary} from './member-account.mjs';
import { randomUUID } from 'node:crypto';

export class ApplicationError extends Error {
 constructor(message,status=400){ super(message); this.status=status; }
}
const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
const text=(value,max=200)=>typeof value==='string'&&value.trim()&&value.length<=max;
function reservationView(reservation,authority){
 const result=structuredClone(reservation);
 if(authority.role!=='staff'&&result.cancellationHistory)result.cancellationHistory=result.cancellationHistory.filter(e=>e.outcome==='applied').map(e=>({action:e.action,to:e.to,createdAt:e.createdAt,creditOutcome:e.creditOutcome}));
 return result;
}
export function emptyState(){return {classes:[],participants:[],reservations:[],passes:[],videos:[],events:[],products:[],orders:[],notifications:[],activity:[],preferences:[]};}
export function visibleState(state,authority,at=new Date().toISOString()){
 const result=Object.fromEntries(['classes','participants','reservations','passes','videos','events','products','orders','notifications','activity','preferences','creditUnits','creditEvents','entitlementProducts','entitlementIssuances','memberships'].map(k=>[k,structuredClone(state[k]||[])]));
 if(authority.role!=='staff'){
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
 }
 result.classes=(result.classes||[]).map(c=>({...c,reservedCount:state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length}));
 return result;
}
export function transition(original, command, authority, {id=randomUUID,now=()=>new Date().toISOString()}={}){
 const state=structuredClone(original), body=command.body||{};
 if(!text(body.requestId,128))fail('A request identifier is required');
 const staff=()=>{if(authority.role!=='staff')fail('Staff access required',403);};
 const own=participantId=>{if(!authority.participantIds.includes(participantId)&&authority.role!=='staff')fail('Participant authority required',403); if(!state.participants.some(p=>p.id===participantId))fail('Participant unavailable',404);};
 const accounting=bookingAccounting(state,authority,{id,now},fail);
 let result;
 if(command.action==='reserve'){
  own(body.participantId);
  const c=state.classes.find(x=>x.id===body.classId);
  if(!c||c.status!=='open'||Date.parse(c.startsAt)<=Date.parse(now()))fail('Class unavailable',409);
  if(state.reservations.some(r=>r.classId===c.id&&r.participantId===body.participantId&&['reserved','waitlisted'].includes(r.status)))fail('Already booked or waitlisted',409);
  const full=state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length>=c.capacity;
  if(full&&(authority.role!=='staff'||!c.waitlistEnabled))fail('Class full',409);
  result={id:id(),classId:c.id,participantId:body.participantId,status:full?'waitlisted':'reserved',paymentStatus:'not_evaluated',attendanceStatus:'not_recorded',notificationStatus:'not_requested',createdAt:now()};
  if(body.passId!==undefined){if(!state.passes.some(p=>p.id===body.passId&&p.participantId===body.participantId))fail('Participant pass unavailable',403);result.passId=body.passId;}
  if(!full)accounting.consume(result,c);state.reservations.push(result);
 }else if(['cancel','correct-cancellation','attendance'].includes(command.action)){
  const r=state.reservations.find(x=>x.id===command.id);if(!r)fail('Reservation unavailable',404);
  if(command.action==='attendance'){
   staff();if(r.status!=='reserved')fail('Only reserved participants can be checked in',409);
   if(!['present','absent','not_recorded'].includes(body.status))fail('Invalid attendance status');
   r.attendanceStatus=body.status;
  }else{
   own(r.participantId);const cancelAt=now();
   if(command.action==='cancel'&&authority.role!=='staff'&&r.status!=='cancelled'){
    const option=memberCancellationOption(state,r,cancelAt);
    if(!option.allowed)fail(option.reason,409);
    if(body.expectedCancellationClassification!==undefined&&body.expectedCancellationClassification!==option.classification)fail('The cancellation consequence has changed. Review the current consequence before confirming again.',409);
   }
   const change=cancelBooking(state,r,state.classes.find(c=>c.id===r.classId),body,authority,accounting,{id,now:()=>cancelAt},fail,command.action==='correct-cancellation');if(change.outcome==='unchanged'&&command.action==='cancel')return {state,result:reservationView(r,authority)};state.activity.push({id:id(),action:command.action,actorId:authority.userId,subjectId:r.id,outcome:change.outcome,createdAt:cancelAt});return {state,result:{...reservationView(r,authority),outcome:change.outcome,creditOutcome:change.creditOutcome,message:change.message}};
  }
  result=r;
 }else if(command.action==='promote'){
  staff();const r=state.reservations.find(x=>x.id===command.id);if(!r||r.status!=='waitlisted')fail('Waitlist entry unavailable',409);
  const c=state.classes.find(x=>x.id===r.classId);if(!c||c.status!=='open'||Date.parse(c.startsAt)<=Date.parse(now())||state.reservations.filter(x=>x.classId===c.id&&x.status==='reserved').length>=c.capacity)fail('No capacity available',409);
  accounting.consume(r,c);r.status='reserved';result=r;
 }else if(command.action==='issue-credit'){
  staff();own(body.participantId);result=accounting.issue({participantId:body.participantId,quantity:body.quantity,reason:body.reason,requestId:body.requestId});
 }else if(['entitlement-product','issue-entitlement'].includes(command.action)){
  staff();const entitlements=entitlementOperations(state,authority,{id,now},fail,accounting);
  if(command.action==='entitlement-product')result=entitlements.product(body);
  else {own(body.participantId);result=entitlements.issue(body);}
 }else if(command.action==='class-policy'){
  staff();const c=state.classes.find(c=>c.id===body.classId);if(!c)fail('Class unavailable',404);if(!Number.isInteger(body.cancellationCutoffMinutes)||body.cancellationCutoffMinutes<0||body.cancellationCutoffMinutes>10080)fail('Invalid cancellation cutoff');const before=c.cancellationCutoffMinutes??90;c.cancellationCutoffMinutes=body.cancellationCutoffMinutes;state.activity.push({id:id(),action:'cancellation-policy',subjectId:c.id,from:before,to:c.cancellationCutoffMinutes,actorId:authority.userId,createdAt:now()});result=c;
 }else if(command.action==='class'){
  staff();if(!text(body.title)||!text(body.instructor)||!text(body.location)||!Number.isInteger(body.capacity)||body.capacity<1||body.capacity>1000||!Number.isFinite(Date.parse(body.startsAt))||!Number.isInteger(body.duration)||body.duration<1||body.duration>1440)fail('Invalid class details');
  if(body.cancellationCutoffMinutes!==undefined&&(!Number.isInteger(body.cancellationCutoffMinutes)||body.cancellationCutoffMinutes<0||body.cancellationCutoffMinutes>10080))fail('Invalid cancellation cutoff');
  result={cancellationCutoffMinutes:body.cancellationCutoffMinutes??90,creditRequired:body.creditRequired===true,id:id(),title:body.title,instructor:body.instructor,location:body.location,capacity:body.capacity,startsAt:new Date(body.startsAt).toISOString(),duration:body.duration,category:text(body.category)?body.category:'Class',status:'open',waitlistEnabled:body.waitlistEnabled===true};state.classes.push(result);
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
 return {state,result};
}
