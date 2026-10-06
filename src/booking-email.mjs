import {createHash} from 'node:crypto';

// A projection of the existing booking transition, not a second event source.
export function bookingEmailIntents(before,after,authority,command){
 if(!['reserve','cancel','promote','cancel-class'].includes(command.action))return [];
 const scoped=x=>x&&(!x.tenantId||x.tenantId===authority.tenantId)&&(!x.businessId||x.businessId===authority.businessId);
 return after.reservations.filter(scoped).flatMap(r=>{
  const previous=before.reservations.find(x=>x.id===r.id);
  let kind;
  if(!previous&&r.status==='reserved')kind=before.reservations.some(x=>scoped(x)&&x.classId===r.classId&&x.participantId===r.participantId&&x.status==='cancelled')?'rebooking_confirmation':'booking_confirmation';
  if(previous?.status==='waitlisted'&&r.status==='reserved'&&command.action==='promote')kind='waitlist_promotion';
  if(previous&&previous.status!=='cancelled'&&r.status==='cancelled')kind='booking_cancellation';
  if(!kind)return [];
  const c=after.classes.find(x=>x.id===r.classId&&scoped(x)),p=after.participants.find(x=>x.id===r.participantId&&scoped(x));
  if(!c||!p)throw new Error('Booking email source unavailable');
  // Reservation identity + lifecycle transition is stable across command replays.
  const id=createHash('sha256').update(JSON.stringify([authority.tenantId,authority.businessId,r.id,kind])).digest('hex');
  return [{id,kind,reservationId:r.id,participantId:r.participantId,classId:r.classId,
   snapshot:{className:c.title,startsAt:c.startsAt,instructor:c.instructor||'',memberName:p.name,status:r.status}}];
 });
}

export const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(value);
const titles={booking_confirmation:'Your booking is confirmed',booking_cancellation:'Your booking is cancelled',rebooking_confirmation:'Your rebooking is confirmed',waitlist_promotion:'Your waitlist place is confirmed'};
export function bookingEmailMessage(intent,configuration){
 const s=intent.snapshot,title=titles[intent.kind];
 if(!title||!validEmail(intent.recipient)||!validEmail(configuration.sender)||!configuration.name||!Number.isFinite(Date.parse(s.startsAt)))throw new Error('Email requires review');
 const date=new Intl.DateTimeFormat('en-US',{timeZone:configuration.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(s.startsAt));
 const link=new URL('/member.html',configuration.origin);
 if(link.protocol!=='https:'||link.origin!==configuration.origin)throw new Error('Booking link requires review');
 link.searchParams.set('tenant',configuration.tenantId);link.searchParams.set('business',configuration.businessId);link.hash='bookings';
 const lines=[configuration.name,title,'',s.memberName?`Hello ${s.memberName},`:'Hello,','',s.className,`${date} (${configuration.timeZone})`,s.instructor?`Instructor: ${s.instructor}`:'',`Booking status: ${s.status==='cancelled'?'Cancelled':'Confirmed'}`,'',intent.kind==='waitlist_promotion'?'A place has opened up and your booking is now confirmed.':'',`View your bookings: ${link.href}`,'',`Thank you,\n${configuration.name}`];
 return {from:`${configuration.name.replace(/[<>\r\n"]/g,'')} <${configuration.sender}>`,to:[intent.recipient],subject:`${configuration.name}: ${title}`,text:lines.filter(x=>x!==undefined).join('\n')};
}

export const emailStateLabel=state=>({intent_created:'Email queued',sending:'Email processing',provider_accepted:'Email accepted by provider',delivered:'Email delivered',failed:'Email failed — contact the studio',needs_review:'Email needs review',uncertain:'Email confirmation pending'})[state]||'Email pending';
