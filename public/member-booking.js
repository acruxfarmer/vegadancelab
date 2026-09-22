import {cancellationOutcome} from './member-cancellation.js';
import {memberPortalUI} from './member-portal.js';
export function memberBookingUI({getData,escape:e,modal,mutate,load,notify,date,time}){
 const data=()=>getData();
 const portal=memberPortalUI({getData,escape:e,date,time});
 const classFor=id=>data().classes.find(c=>c.id===id);
 const name=id=>data().participants.find(p=>p.id===id)?.name||'Participant';
 const detail=c=>`${date(c.startsAt)} · ${time(c.startsAt)} Pacific<br>${e(c.instructor)} · ${e(c.duration)} minutes<br>${e(c.location)}`;
 const ordered=items=>[...items].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
 const future=c=>Date.parse(c.startsAt)>Date.now();
 const option=(c,p)=>data().bookingOptions?.find(o=>o.classId===c.id&&o.participantId===p);
 function card(c){
  const booked=data().reservations.filter(r=>r.classId===c.id&&['reserved','waitlisted'].includes(r.status));
  return `<article class="card"><p class="eyebrow">${e(c.category||'Class')}</p><h3>${e(c.title)}</h3><p class="meta">${detail(c)}</p><p>${c.status!=='open'?'Unavailable':`${Math.max(0,c.capacity-c.reservedCount)} places available`}</p>${booked.map(r=>`<p class="pill">${e(name(r.participantId))} · ${e(r.status==='reserved'?'Booked':r.status)}</p>`).join('')}<p>${c.creditRequired?'1 eligible class credit required':'No class credit required'}</p><button class="button secondary" data-class="${e(c.id)}">View class</button></article>`;
 }
 function booking(r){
  const c=classFor(r.classId),pass=data().passes?.find(p=>p.id===r.creditConsumption?.passId),cancel=data().cancellationOptions?.find(o=>o.reservationId===r.id);
  const past=c&&!future(c),status=r.status==='cancelled'?(r.cancellation?.originalBookingStatus==='waitlisted'?'Left waitlist':'Cancelled'):r.attendanceStatus==='present'?'Attended':r.attendanceStatus==='absent'?'Marked absent':past&&r.status==='reserved'?'Past booking · attendance not recorded':r.status==='reserved'?'Booked':r.status==='waitlisted'?`Waitlisted · Position ${r.waitlistPosition||'unavailable'}`:r.status;
  return `<article class="card"><p class="eyebrow">${e(name(r.participantId))}</p><h3>${e(c?.title||'Class')}</h3><p class="meta">${c?detail(c):'Class details unavailable'}</p><p class="pill">${e(status)}</p>${r.status==='waitlisted'?'<p>No seat is reserved. Waiting consumes no credit. Staff promotes the earliest currently eligible entry when capacity permits; joining does not guarantee a place.</p>':''}<p>${r.creditConsumption?`1 credit used · ${e(pass?.label||'Class credit')}`:'No class credit consumed'}</p>${r.status==='cancelled'&&r.cancellation?.originalBookingStatus!=='waitlisted'?`<p>${e(r.cancellation?.classification==='early'?'Early cancellation':r.cancellation?.classification==='late'?'Late cancellation':'Cancellation outcome')} · ${e(cancellationOutcome(r,pass?.label))}</p>`:''}${['reserved','waitlisted'].includes(r.status)?cancel?.allowed?`<button class="button secondary" data-cancel="${e(r.id)}">${r.status==='waitlisted'?'Leave waitlist':'Cancel reservation'}</button>`:`<p>${e(cancel?.reason||'Refresh to check cancellation availability.')}</p>`:''}</article>`;
 }
 const upcoming=()=>data().reservations.filter(r=>['reserved','waitlisted'].includes(r.status)&&classFor(r.classId)&&future(classFor(r.classId))).sort((a,b)=>Date.parse(classFor(a.classId).startsAt)-Date.parse(classFor(b.classId).startsAt));
 function render(page,{query='',category='All'}={}){
  const refresh='<button class="button secondary" data-refresh-booking>Refresh schedule & credits</button>';
  const recent=items=>[...items].sort((a,b)=>(Date.parse(classFor(b.classId)?.startsAt)||0)-(Date.parse(classFor(a.classId)?.startsAt)||0));
  if(page==='passes')return `<div class="page-heading"><h1>Passes & membership</h1>${refresh}</div>${portal.entitlements()}`;
  if(page==='classes'){
   const all=ordered(data().classes.filter(future)),list=all.filter(c=>(category==='All'||c.category===category)&&`${c.title} ${c.instructor} ${c.location}`.toLowerCase().includes(query.toLowerCase()));
   return `<div class="page-heading"><div><h1>The studio schedule</h1><p>Upcoming classes · All times Pacific</p></div>${refresh}</div><div class="toolbar"><input id="search" type="search" aria-label="Search classes" placeholder="Search classes, instructors or locations" value="${e(query)}"><select id="category" aria-label="Class category">${['All',...new Set(all.map(c=>c.category).filter(Boolean))].map(c=>`<option ${category===c?'selected':''}>${e(c)}</option>`).join('')}</select></div><div class="grid">${list.map(card).join('')}</div>${list.length?'':'<p>No matching upcoming classes. Try another search or refresh the schedule.</p>'}`;
  }
  if(page==='today')return `<div class="page-heading"><div><h1>Your Vega account</h1><p>Your bookings, class history and credits in one place.</p></div>${refresh}</div><h2>Upcoming bookings</h2><div class="grid">${upcoming().slice(0,3).map(booking).join('')||'<p>No upcoming bookings yet.</p>'}</div><p><a class="button" href="#classes">Find a class</a> <a class="text-button" href="#bookings">All bookings</a></p>${portal.entitlements()}<h2>Past & attended classes</h2><div class="grid">${recent(data().reservations.filter(r=>r.status!=='cancelled'&&classFor(r.classId)&&!future(classFor(r.classId)))).slice(0,3).map(booking).join('')||'<p>No past classes recorded yet.</p>'}</div><h2>Recent cancelled bookings</h2><div class="grid">${data().reservations.filter(r=>r.status==='cancelled').sort((a,b)=>(Date.parse(b.cancellation?.originalCancelledAt)||0)-(Date.parse(a.cancellation?.originalCancelledAt)||0)).slice(0,3).map(booking).join('')||'<p>No cancelled bookings.</p>'}</div>${portal.activity()}`;
  if(page==='bookings'){
   const next=upcoming(),ids=new Set(next.map(r=>r.id)),history=data().reservations.filter(r=>!ids.has(r.id));
   return `<div class="page-heading"><h1>My bookings</h1>${refresh}</div><h2>Upcoming</h2><div class="grid">${next.map(booking).join('')||'<p>No upcoming bookings. <a href="#classes">Find a class</a>.</p>'}</div><h2>Past & cancelled</h2><div class="grid">${recent(history).map(booking).join('')||'<p>No past bookings.</p>'}</div>${portal.activity()}`;
  }
  return null;
 }
 let opening=0;
 async function open(id){
  const current=++opening;
  modal('<h2>Checking class availability</h2><p role="status">Refreshing schedule and eligible credits…</p>');
  try{await load();if(current!==opening||!document.querySelector('#dialog').open)return;show(id);}
  catch(error){if(current===opening&&document.querySelector('#dialog').open)document.querySelector('#dialog-body').innerHTML=`<h2>Unable to check this class</h2><p role="alert">${e(error.message)}</p><button class="button" data-class="${e(id)}">Try again</button>`;}
 }
 function show(id,participantId){
  const c=classFor(id);if(!c)return;
  const participants=data().participants,selected=participants.find(p=>p.id===participantId)?.id||participants[0]?.id;
  const o=option(c,selected),waiting=o?.waitlistEligible===true,ready=(o?.eligible||waiting)&&future(c);
  document.querySelector('#dialog-body').innerHTML=`<p class="eyebrow">${e(c.category||'Class')}</p><h2>${e(c.title)}</h2><p class="meta">${detail(c)}</p><p>${Math.max(0,c.capacity-c.reservedCount)} places available</p><form id="member-booking" data-id="${e(c.id)}" data-waitlist="${waiting?'true':'false'}"><label class="field">Who is attending?<select name="participantId">${participants.map(p=>`<option value="${e(p.id)}" ${p.id===selected?'selected':''}>${e(p.name)}</option>`).join('')}</select></label><div class="notice" role="status">${e(!future(c)?'This class has already started.':o?.reason||'Booking eligibility is unavailable. Refresh before booking.')}</div>${waiting?'<p>Join the waitlist without reserving a seat or spending a credit. Staff promotion requires available capacity and an eligible credit at that time. Entries are ordered by join time; staff promotes the earliest currently eligible entry. No automatic promotion or notification is sent.</p>':''}<p>${c.creditRequired?'Booking requires 1 eligible class credit.':'No class credit is required.'}</p>${o?.passId?`<input type="hidden" name="passId" value="${e(o.passId)}"><p><strong>Use 1 credit from ${e(o.passLabel)}</strong><br>${o.eligibleCredits} eligible credits in this pass before booking.<br>${o.expiresAt?`Expires ${date(o.expiresAt)} · ${time(o.expiresAt)} Pacific`:'No expiration'}</p>`:''}<p>Cancel at least ${e(c.cancellationCutoffMinutes??90)} minutes before class start to restore a consumed credit under its original terms. Late cancellation does not restore it automatically.</p><p class="meta">Availability and eligibility are checked again when you confirm.</p><button class="button" ${ready?'':'disabled'}>${waiting?'Join waitlist':'Confirm booking'}</button><p role="alert" id="member-booking-error"></p></form>`;
 }
 async function submit(form){
  if(form.dataset.pending)return;
  form.dataset.pending='true';const button=form.querySelector('button');button.disabled=true;
  const fields=Object.fromEntries(new FormData(form)),c=classFor(form.dataset.id);
  try{
   const response=await mutate('/api/reservations',{classId:c.id,...fields,...(form.dataset.waitlist==='true'?{waitlistOnly:true}:{})},()=>{});
   const r=data().reservations.find(r=>r.id===response.id)||response;
   if(r.status==='cancelled'){modal('<h2>Entry already cancelled</h2><p>The earlier request was recovered, but this entry has since been cancelled. Review your current bookings and credits.</p><button class="button" data-booking-done>View my bookings</button>');return;}
   const pass=data().passes?.find(p=>p.id===r.creditConsumption?.passId);
   document.querySelector('#dialog').close();location.hash='bookings';
   modal(`<h2>${r.status==='waitlisted'?'Waitlist joined':'Booking confirmed'}</h2><h3>${e(c.title)}</h3><p>${e(name(r.participantId))}</p><p class="meta">${detail(c)}</p><p>${r.creditConsumption?`1 credit consumed from ${e(pass?.label||'your class credits')}.`:'No class credit consumed.'}</p><p>${r.status==='waitlisted'?'You are waiting for a place. No seat is reserved and no credit has been consumed. Staff must confirm promotion.':'Your booking is saved in your upcoming activity.'}</p><button class="button" data-booking-done>View my bookings</button>`);
   notify(r.status==='waitlisted'?'Waitlist joined. No credit consumed.':'Booking confirmed.');
  }catch(error){form.querySelector('[role="alert"]').textContent=`${error.message} Refresh the schedule to check the latest booking and credit state before trying again.`;}
  finally{delete form.dataset.pending;button.disabled=false;}
 }
 return {render,open,show,submit};
}
