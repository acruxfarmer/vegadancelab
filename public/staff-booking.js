import {cancellationUI} from './cancellation-ui.js';
import {memberPortalUI} from './member-portal.js';
import {cancellationOutcome} from './member-cancellation.js';

export function staffBookingUI({getData,isStaff,escape:e,modal,load,mutate,notify,render,date,time}){
 let selected='',search='',opening=0;
 const d=()=>getData(),actor=()=>isStaff()?d()?.context?.userId:null;
 const stamp=s=>Number.isFinite(Date.parse(s))?`${date(s)} · ${time(s)} Pacific`:'Date unavailable';
 function scoped(){
  const source=d(),own=x=>x.participantId===selected;
  return {...source,participants:source.participants.filter(p=>p.id===selected),reservations:source.reservations.filter(own),passes:source.passes.filter(own),creditUnits:(source.creditUnits||[]).filter(own),creditEvents:(source.creditEvents||[]).filter(own),memberAccount:{...source.staffAccount,available:(source.staffAccount?.passes||[]).filter(s=>source.passes.some(p=>p.id===s.passId&&own(p))).reduce((n,p)=>n+p.available,0)}};
 }
 const credits=memberPortalUI({getData:scoped,escape:e,date,time});
 const adjustments=cancellationUI({getData:scoped,escape:e,mutate,notify});
 function booking(r){
  const c=d().classes.find(c=>c.id===r.classId),pass=d().passes.find(p=>p.id===r.creditConsumption?.passId);
  return `<article class="card"><h3>${e(c?.title||'Class unavailable')}</h3><p>${e(stamp(c?.startsAt))} · ${e(r.status)} · Attendance: ${e(r.attendanceStatus||'not recorded')}</p><p>${r.creditConsumption?`1 credit consumed from ${e(pass?.label||'class credits')}`:'No class credit consumed'}</p>${r.status==='cancelled'?`<p>${e(cancellationOutcome(r,pass?.label))}</p>`:''}${['reserved','waitlisted'].includes(r.status)&&r.attendanceStatus==='not_recorded'?`<button class="button secondary" data-staff-cancel="${e(r.id)}">Cancel booking</button>`:''}<p class="meta">Booking ${e(r.id)}</p></article>`;
 }
 function page(){
  if(!isStaff())return null;
  const member=d().participants.find(p=>p.id===selected),list=d().participants.filter(p=>`${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase()));
  let html=`<div class="page-heading"><div><h1>Member booking support</h1><p>Find a member to review bookings, credits and attributable adjustments.</p></div><button class="button secondary" data-refresh-booking>Refresh schedule & credits</button></div><form id="staff-member-search"><label class="field">Find member by name or participant ID<input name="query" value="${e(search)}" type="search"></label><button class="button secondary">Search members</button></form><div class="card">${list.map(p=>`<p>${e(p.name)} · ${e(p.id)} <button class="button secondary small" data-staff-member="${e(p.id)}">Open account</button></p>`).join('')||'<p>No matching members.</p>'}</div>`;
  if(!member)return html+'<p>Select a member to open their account.</p>';
  const records=scoped().reservations,upcoming=records.filter(r=>r.status==='reserved'&&Date.parse(d().classes.find(c=>c.id===r.classId)?.startsAt)>Date.now()).sort((a,b)=>Date.parse(d().classes.find(c=>c.id===a.classId)?.startsAt)-Date.parse(d().classes.find(c=>c.id===b.classId)?.startsAt)),ids=new Set(upcoming.map(r=>r.id));
  html+=`<section aria-label="Selected member"><h2>${e(member.name)}</h2><p>Participant ${e(member.id)}</p><button class="button" data-staff-book="${e(member.id)}">Book a class for this member</button><h2>Upcoming bookings</h2><div class="grid">${upcoming.map(booking).join('')||'<p>No upcoming bookings.</p>'}</div><h2>Recent bookings</h2><div class="grid">${records.filter(r=>!ids.has(r.id)).sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)).slice(0,20).map(booking).join('')||'<p>No recent bookings.</p>'}</div>${credits.entitlements()}${adjustments.render('people',{includeCredits:false})}<p>Correction rules: late to early restores the original consumed credit once. Early to late reverses only that booking’s restored credit; if it has been spent, the correction is blocked. Every correction retains the original record and records the staff actor and reason.</p>${adjustments.render('bookings',{includeCredits:false})}</section>`;
  return html;
 }
 function bookingForm(participantId,classId){
  const classes=d().classes.filter(c=>Date.parse(c.startsAt)>Date.now()),c=classes.find(c=>c.id===classId)||classes[0],o=d().bookingOptions?.find(o=>o.participantId===participantId&&o.classId===c?.id),p=d().participants.find(p=>p.id===participantId);
  return `<h2>Book for ${e(p?.name||'member')}</h2><form id="staff-reserve" data-participant="${e(participantId)}"><label class="field">Class<select name="classId">${classes.map(x=>`<option value="${e(x.id)}" ${x.id===c?.id?'selected':''}>${e(x.title)} · ${e(stamp(x.startsAt))}</option>`).join('')}</select></label>${c?`<p>${e(c.instructor)} · ${e(c.location)} · ${Math.max(0,c.capacity-c.reservedCount)} places available</p>`:'<p>No upcoming classes.</p>'}<p role="status">${e(o?.reason||'Eligibility unavailable. Refresh before booking.')}</p>${o?.passId?`<input type="hidden" name="passId" value="${e(o.passId)}"><p>Confirming consumes 1 credit from <strong>${e(o.passLabel)}</strong>. ${o.eligibleCredits} eligible credits in this pass. ${o.expiresAt?`Expires ${e(stamp(o.expiresAt))}.`:'No expiration.'}</p>`:c&&!c.creditRequired?'<p>No class credit will be consumed.</p>':''}<p>Capacity and entitlement eligibility are checked again at confirmation. A full class will be rejected.</p><button class="button" ${o?.eligible?'':'disabled'}>Confirm staff booking</button><p role="alert"></p></form>`;
 }
 function cancelForm(id){
  const r=d().reservations.find(r=>r.id===id),c=d().classes.find(c=>c.id===r?.classId),p=d().participants.find(p=>p.id===r?.participantId),pass=d().passes.find(p=>p.id===r?.creditConsumption?.passId);
  if(!r||!c||!['reserved','waitlisted'].includes(r.status)||r.attendanceStatus!=='not_recorded')return '<h2>Cancellation unavailable</h2><p>Refresh the account. Already cancelled, invalid or attendance-recorded bookings cannot be cancelled again here.</p>';
  return `<h2>Staff cancellation</h2><p>${e(p?.name)} · ${e(c.title)} · ${e(stamp(c.startsAt))}</p><p>${r.creditConsumption?`Early restores the consumed credit to ${e(pass?.label||'its original pass')} under its original terms. Late leaves it spent.`:'No credit was consumed; either classification leaves the credit balance unchanged.'}</p><p>Policy cutoff: ${e(c.cancellationCutoffMinutes??90)} minutes before class. Staff classification and reason are recorded.</p><form id="staff-cancel" data-id="${e(id)}"><label class="field">Cancellation classification<select name="classification" required><option value="">Choose early or late</option><option value="early">Early — restore consumed credit</option><option value="late">Late — keep consumed credit spent</option></select></label><label class="field">Cancellation reason<input name="reason" required maxlength="1000"></label><button class="button danger">Confirm staff cancellation</button><p role="alert"></p></form>`;
 }
 async function open(kind,id){
  const identity=actor(),attempt=++opening;modal('<h2>Loading current account</h2>');
  try{await load();if(!isStaff()||actor()!==identity||attempt!==opening||!document.querySelector('#dialog').open)return;document.querySelector('#dialog-body').innerHTML=kind==='book'?bookingForm(id):cancelForm(id);}
  catch(error){if(isStaff()&&actor()===identity)document.querySelector('#dialog-body').innerHTML=`<h2>Unable to load account</h2><p role="alert">${e(error.message)}</p>`;}
 }
 async function submit(form){
  if(!isStaff()||form.dataset.pending)return;form.dataset.pending='true';const identity=actor(),button=form.querySelector('button');button.disabled=true;
  try{
   const values=Object.fromEntries(new FormData(form)),cancel=form.id==='staff-cancel';
   const result=await mutate(cancel?`/api/reservations/${encodeURIComponent(form.dataset.id)}/cancel`:'/api/reservations',cancel?values:{...values,participantId:form.dataset.participant,reservationOnly:true},()=>{});
   if(!isStaff()||actor()!==identity)return;
   const pass=d().passes.find(p=>p.id===result.creditConsumption?.passId);
   modal(`<h2>${cancel?'Staff cancellation recorded':'Staff booking confirmed'}</h2><p>${e(d().participants.find(p=>p.id===result.participantId)?.name)} · ${e(d().classes.find(c=>c.id===result.classId)?.title)}</p>${cancel?`<p>${e(result.cancellation?.classification)} cancellation</p>`:''}<p>${cancel?e(cancellationOutcome(result,pass?.label)):result.creditConsumption?`1 credit consumed from ${e(pass?.label||'class credits')}.`:'No class credit consumed.'}</p><p>The member account and audit are updated.</p><button class="button" data-staff-done>Return to member account</button>`);
  }catch(error){if(form.isConnected&&actor()===identity)form.querySelector('[role="alert"]').textContent=`${error.message} Close this dialog and refresh the member account before retrying.`;}
  finally{delete form.dataset.pending;}
 }
 document.addEventListener('click',event=>{
  if(!isStaff())return;const b=event.target.closest('button');if(!b)return;
  if(b.dataset.staffMember||b.dataset.person){event.preventDefault();event.stopImmediatePropagation();selected=b.dataset.staffMember||b.dataset.person;location.hash='people';render();}
  if(b.dataset.staffBook)void open('book',b.dataset.staffBook);
  if(b.dataset.staffCancel)void open('cancel',b.dataset.staffCancel);
  if(b.hasAttribute('data-staff-done'))document.querySelector('#dialog').close();
 },true);
 document.addEventListener('change',event=>{if(isStaff()&&event.target.matches('#staff-reserve select'))document.querySelector('#dialog-body').innerHTML=bookingForm(event.target.form.dataset.participant,event.target.value);});
 document.addEventListener('submit',event=>{
  if(!isStaff())return;
  if(event.target.id==='staff-member-search'){event.preventDefault();search=new FormData(event.target).get('query')||'';render();}
  if(['staff-reserve','staff-cancel'].includes(event.target.id)){event.preventDefault();void submit(event.target);}
 });
 return {render:page};
}
