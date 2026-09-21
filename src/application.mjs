import { randomUUID } from 'node:crypto';

export class ApplicationError extends Error {
 constructor(message,status=400){ super(message); this.status=status; }
}
const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
const text=(value,max=200)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function emptyState(){return {classes:[],participants:[],reservations:[],passes:[],videos:[],events:[],products:[],orders:[],notifications:[],activity:[],preferences:[]};}
export function visibleState(state,authority){
 const result=Object.fromEntries(['classes','participants','reservations','passes','videos','events','products','orders','notifications','activity','preferences'].map(k=>[k,structuredClone(state[k]||[])]));
 if(authority.role!=='staff'){
  const own=id=>authority.participantIds.includes(id);
  for(const key of ['participants','reservations','passes','orders']) result[key]=(result[key]||[]).filter(x=>own(key==='participants'?x.id:x.participantId));
  result.notifications=(result.notifications||[]).filter(x=>own(x.participantId)&&x.status==='published');
  result.preferences=(result.preferences||[]).filter(x=>own(x.participantId));
  result.activity=[];
 }
 result.classes=(result.classes||[]).map(c=>({...c,reservedCount:state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length}));
 return result;
}
export function transition(original, command, authority, {id=randomUUID,now=()=>new Date().toISOString()}={}){
 const state=structuredClone(original), body=command.body||{};
 if(!text(body.requestId,128))fail('A request identifier is required');
 const staff=()=>{if(authority.role!=='staff')fail('Staff access required',403);};
 const own=participantId=>{if(!authority.participantIds.includes(participantId)&&authority.role!=='staff')fail('Participant authority required',403); if(!state.participants.some(p=>p.id===participantId))fail('Participant unavailable',404);};
 let result;
 if(command.action==='reserve'){
  own(body.participantId);
  const c=state.classes.find(x=>x.id===body.classId);
  if(!c||c.status!=='open'||Date.parse(c.startsAt)<=Date.parse(now()))fail('Class unavailable',409);
  if(state.reservations.some(r=>r.classId===c.id&&r.participantId===body.participantId&&['reserved','waitlisted'].includes(r.status)))fail('Already booked or waitlisted',409);
  const full=state.reservations.filter(r=>r.classId===c.id&&r.status==='reserved').length>=c.capacity;
  if(full&&!c.waitlistEnabled)fail('Class full',409);
  result={id:id(),classId:c.id,participantId:body.participantId,status:full?'waitlisted':'reserved',paymentStatus:'not_evaluated',attendanceStatus:'not_recorded',notificationStatus:'not_requested',createdAt:now()};
  state.reservations.push(result);
 }else if(['cancel','attendance'].includes(command.action)){
  const r=state.reservations.find(x=>x.id===command.id);if(!r)fail('Reservation unavailable',404);
  if(command.action==='attendance'){
   staff();if(r.status!=='reserved')fail('Only reserved participants can be checked in',409);
   if(!['present','absent','not_recorded'].includes(body.status))fail('Invalid attendance status');
   r.attendanceStatus=body.status;
  }else{own(r.participantId);if(r.attendanceStatus!=='not_recorded')fail('Recorded attendance requires staff reconciliation',409);r.status='cancelled';}
  result=r;
 }else if(command.action==='promote'){
  staff();const r=state.reservations.find(x=>x.id===command.id);if(!r||r.status!=='waitlisted')fail('Waitlist entry unavailable',409);
  const c=state.classes.find(x=>x.id===r.classId);if(!c||c.status!=='open'||Date.parse(c.startsAt)<=Date.parse(now())||state.reservations.filter(x=>x.classId===c.id&&x.status==='reserved').length>=c.capacity)fail('No capacity available',409);
  r.status='reserved';result=r;
 }else if(command.action==='class'){
  staff();if(!text(body.title)||!text(body.instructor)||!text(body.location)||!Number.isInteger(body.capacity)||body.capacity<1||body.capacity>1000||!Number.isFinite(Date.parse(body.startsAt))||!Number.isInteger(body.duration)||body.duration<1||body.duration>1440)fail('Invalid class details');
  result={id:id(),title:body.title,instructor:body.instructor,location:body.location,capacity:body.capacity,startsAt:new Date(body.startsAt).toISOString(),duration:body.duration,category:text(body.category)?body.category:'Class',status:'open',waitlistEnabled:body.waitlistEnabled===true};state.classes.push(result);
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
