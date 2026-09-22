export function memberBookingUI({getData,escape:e,modal,mutate,load,notify,date,time}){
 const data=()=>getData();
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
  const c=classFor(r.classId),pass=data().passes?.find(p=>p.id===r.creditConsumption?.passId);
  return `<article class="card"><p class="eyebrow">${e(name(r.participantId))}</p><h3>${e(c?.title||'Class')}</h3><p class="meta">${c?detail(c):'Class details unavailable'}</p><p class="pill">${e(r.status==='reserved'?'Booked':r.status)}</p><p>${r.creditConsumption?`1 credit used · ${e(pass?.label||'Class credit')}`:'No class credit consumed'}</p>${r.cancellation?`<p>${e(r.cancellation.classification)} cancellation · ${e(r.cancellation.creditOutcome.replaceAll('_',' '))}</p>`:''}${['reserved','waitlisted'].includes(r.status)?r.attendanceStatus==='not_recorded'?`<button class="button secondary" data-cancel="${e(r.id)}">Cancel reservation</button>`:'<p>Contact the studio to cancel a booking with recorded attendance.</p>':''}</article>`;
 }
 const upcoming=()=>data().reservations.filter(r=>r.status==='reserved'&&classFor(r.classId)&&future(classFor(r.classId))).sort((a,b)=>Date.parse(classFor(a.classId).startsAt)-Date.parse(classFor(b.classId).startsAt));
 function render(page,{query='',category='All'}={}){
  const refresh='<button class="button secondary" data-refresh-booking>Refresh schedule & credits</button>';
  if(page==='classes'){
   const all=ordered(data().classes.filter(future)),list=all.filter(c=>(category==='All'||c.category===category)&&`${c.title} ${c.instructor} ${c.location}`.toLowerCase().includes(query.toLowerCase()));
   return `<div class="page-heading"><div><h1>The studio schedule</h1><p>Upcoming classes · All times Pacific</p></div>${refresh}</div><div class="toolbar"><input id="search" type="search" aria-label="Search classes" placeholder="Search classes, instructors or locations" value="${e(query)}"><select id="category" aria-label="Class category">${['All',...new Set(all.map(c=>c.category).filter(Boolean))].map(c=>`<option ${category===c?'selected':''}>${e(c)}</option>`).join('')}</select></div><div class="grid">${list.map(card).join('')}</div>${list.length?'':'<p>No matching upcoming classes. Try another search or refresh the schedule.</p>'}`;
  }
  if(page==='today')return `<div class="page-heading"><div><h1>Your upcoming activity</h1><p>Your confirmed classes, in date order.</p></div>${refresh}</div><div class="grid">${upcoming().slice(0,3).map(booking).join('')||'<p>No upcoming bookings yet.</p>'}</div><p><a class="button" href="#classes">Find a class</a> <a class="text-button" href="#bookings">All bookings</a></p>`;
  if(page==='bookings'){
   const next=upcoming(),ids=new Set(next.map(r=>r.id)),history=data().reservations.filter(r=>!ids.has(r.id));
   return `<div class="page-heading"><h1>My bookings</h1>${refresh}</div><h2>Upcoming</h2><div class="grid">${next.map(booking).join('')||'<p>No upcoming bookings. <a href="#classes">Find a class</a>.</p>'}</div><h2>Past & cancelled</h2><div class="grid">${history.slice().reverse().map(booking).join('')||'<p>No past bookings.</p>'}</div>`;
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
  const o=option(c,selected),ready=o?.eligible&&future(c);
  document.querySelector('#dialog-body').innerHTML=`<p class="eyebrow">${e(c.category||'Class')}</p><h2>${e(c.title)}</h2><p class="meta">${detail(c)}</p><p>${Math.max(0,c.capacity-c.reservedCount)} places available</p><form id="member-booking" data-id="${e(c.id)}"><label class="field">Who is attending?<select name="participantId">${participants.map(p=>`<option value="${e(p.id)}" ${p.id===selected?'selected':''}>${e(p.name)}</option>`).join('')}</select></label><div class="notice" role="status">${e(!future(c)?'This class has already started.':o?.reason||'Booking eligibility is unavailable. Refresh before booking.')}</div><p>${c.creditRequired?'Booking requires 1 eligible class credit.':'No class credit is required.'}</p>${o?.passId?`<input type="hidden" name="passId" value="${e(o.passId)}"><p><strong>Use 1 credit from ${e(o.passLabel)}</strong><br>${o.eligibleCredits} eligible credits in this pass before booking.<br>${o.expiresAt?`Expires ${date(o.expiresAt)} · ${time(o.expiresAt)} Pacific`:'No expiration'}</p>`:''}<p>Cancel at least ${e(c.cancellationCutoffMinutes??90)} minutes before class start to restore a consumed credit under its original terms. Late cancellation does not restore it automatically.</p><p class="meta">Availability and eligibility are checked again when you confirm.</p><button class="button" ${ready?'':'disabled'}>Confirm booking</button><p role="alert" id="member-booking-error"></p></form>`;
 }
 async function submit(form){
  if(form.dataset.pending)return;
  form.dataset.pending='true';const button=form.querySelector('button');button.disabled=true;
  const fields=Object.fromEntries(new FormData(form)),c=classFor(form.dataset.id);
  try{
   const r=await mutate('/api/reservations',{classId:c.id,...fields},()=>{});
   const pass=data().passes?.find(p=>p.id===r.creditConsumption?.passId);
   document.querySelector('#dialog').close();location.hash='bookings';
   modal(`<h2>Booking confirmed</h2><h3>${e(c.title)}</h3><p>${e(name(r.participantId))}</p><p class="meta">${detail(c)}</p><p>${r.creditConsumption?`1 credit consumed from ${e(pass?.label||'your class credits')}.`:'No class credit consumed.'}</p><p>Your booking is saved in your upcoming activity.</p><button class="button" data-booking-done>View my bookings</button>`);
   notify('Booking confirmed.');
  }catch(error){form.querySelector('[role="alert"]').textContent=`${error.message} Refresh the schedule to check the latest booking and credit state before trying again.`;}
  finally{delete form.dataset.pending;button.disabled=false;}
 }
 return {render,open,show,submit};
}
