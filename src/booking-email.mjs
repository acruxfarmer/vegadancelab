import {createHash} from 'node:crypto';

// A projection of the existing booking transition, not a second event source.
export function bookingEmailIntents(before,after,authority,command){
 if(!['reserve','cancel','promote','cancel-class'].includes(command.action))return [];
 const scoped=x=>x&&(!x.tenantId||x.tenantId===authority.tenantId)&&(!x.businessId||x.businessId===authority.businessId);
 return after.reservations.filter(scoped).flatMap(r=>{
  const previous=before.reservations.find(x=>x.id===r.id&&scoped(x));
  let kind;
  if(!previous&&r.status==='reserved')kind=before.reservations.some(x=>scoped(x)&&x.classId===r.classId&&x.participantId===r.participantId&&x.status==='cancelled')?'rebooking_confirmation':'booking_confirmation';
  if(!previous&&r.status==='waitlisted'&&command.action==='reserve')kind='waitlist_joined';
  if(previous?.status==='waitlisted'&&r.status==='reserved'&&command.action==='promote')kind='waitlist_promotion';
  if(previous&&['reserved','waitlisted'].includes(previous.status)&&r.status==='cancelled')kind=command.action==='cancel-class'?'class_cancelled':previous.status==='waitlisted'?'waitlist_removed':'booking_cancellation';
  if(!kind)return [];
  const c=after.classes.find(x=>x.id===r.classId&&scoped(x)),p=after.participants.find(x=>x.id===r.participantId&&scoped(x));
  if(!c||!p)throw new Error('Booking email source unavailable');
  // Reservation identity + lifecycle transition is stable across command replays.
  const id=createHash('sha256').update(JSON.stringify([authority.tenantId,authority.businessId,r.id,kind])).digest('hex');
  return [{id,kind,reservationId:r.id,participantId:r.participantId,classId:r.classId,
   snapshot:{className:c.title,startsAt:c.startsAt,instructor:c.instructor||'',memberName:p.name,status:r.status,...(['class_cancelled','waitlist_removed'].includes(kind)?{previousStatus:previous.status}:{})}}];
 });
}

export const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(value);
const titles={class_reminder:'Reminder: your class is tomorrow',booking_confirmation:'Your booking is confirmed',booking_cancellation:'Your booking is cancelled',rebooking_confirmation:'Your rebooking is confirmed',waitlist_promotion:'Your waitlist place is confirmed',class_cancelled:'Your class has been cancelled',waitlist_joined:'You have joined the waitlist',waitlist_removed:'Your waitlist entry has been removed'};
export function bookingEmailMessage(intent,configuration){
 const s=intent.snapshot,title=titles[intent.kind];
 if(!title||!validEmail(intent.recipient)||!validEmail(configuration.sender)||!configuration.name||!Number.isFinite(Date.parse(s.startsAt)))throw new Error('Email requires review');
 const date=new Intl.DateTimeFormat('en-US',{timeZone:configuration.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(s.startsAt));
 const link=new URL('/member.html',configuration.origin);
 if(link.protocol!=='https:'||link.origin!==configuration.origin)throw new Error('Booking link requires review');
 link.searchParams.set('tenant',configuration.tenantId);link.searchParams.set('business',configuration.businessId);link.hash='bookings';
 const waiting=s.status==='waitlisted'||s.previousStatus==='waitlisted';
 const status=s.status==='waitlisted'?'Waiting — no seat reserved':s.status==='cancelled'?(waiting?'Removed from waitlist':'Cancelled'):'Confirmed';
 const explanation={class_reminder:'Your booked class is coming up. View your bookings for details or to review your cancellation options.',waitlist_joined:'You are on the waitlist. No seat is reserved and no class credit has been used. If you are promoted, we will record your confirmed booking.',waitlist_removed:'You are no longer on this waitlist. View your bookings to review your current plans.',class_cancelled:waiting?'The studio has cancelled this class. Your waitlist entry is closed; no seat was reserved.':'The studio has cancelled this class and your booking. View your bookings for the recorded cancellation and any credit restoration.',waitlist_promotion:'A place has opened up and your booking is now confirmed.'}[intent.kind]||'';
 const lines=[configuration.name,title,'',s.memberName?`Hello ${s.memberName},`:'Hello,','',s.className,`${date} (${configuration.timeZone})`,s.instructor?`Instructor: ${s.instructor}`:'',`${waiting?'Waitlist':'Booking'} status: ${status}`,'',explanation,`View your bookings: ${link.href}`,'',`Thank you,\n${configuration.name}`];
 return {from:`${configuration.name.replace(/[<>\r\n"]/g,'')} <${configuration.sender}>`,to:[intent.recipient],subject:`${configuration.name}: ${title}`,text:lines.filter(x=>x!==undefined).join('\n')};
}

export const emailStateLabel=state=>({suppressed:'Reminder not sent',intent_created:'Email queued',sending:'Email processing',provider_accepted:'Email accepted by provider',delivered:'Email delivered',failed:'Email failed — contact the studio',needs_review:'Email needs review',uncertain:'Email confirmation pending'})[state]||'Email pending';
