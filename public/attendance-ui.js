import {reservationHistoryHTML,defaultHistoryFilters} from './reservation-history.js';
import {occurrenceOption,studioDate} from './schedule-navigation.js';
import {defaultRosterFilters,rosterResults,rosterFilterControls,attendanceLabel} from './roster-navigation.js';

export function attendanceUI({getData,isStaff,escape:e,modal,mutate,notify,date,time,render}){
 const label=status=>e(attendanceLabel(status));
 let scope='',filters=defaultRosterFilters(),visibleIds=new Set(),active=null,generation=0,historySelection=null;
 function closeActive(){if(active){const dialog=document.querySelector('#dialog');if(dialog?.querySelector('[data-roster-attendance]')){dialog.close();dialog.querySelector('#dialog-body')?.replaceChildren();}active=null;generation++;}}
 function reconcile(occurrenceId){
  const d=getData(),id=isStaff()&&d?.classes.some(c=>c.id===occurrenceId)?occurrenceId:'';
  const next=id?JSON.stringify([d.context.userId,d.context.tenantId,d.context.businessId,id]):'';
  if(scope!==next){historySelection=null;closeActive();filters=defaultRosterFilters();visibleIds=new Set();scope=next;generation++;}
 }
 function roster(selectedClass,occurrences=getData().classes,navigation='',error=''){
  if(!isStaff())return '';
  const d=getData(),c=occurrences.find(c=>c.id===selectedClass),rows=d.reservations.filter(r=>r.classId===c?.id),name=id=>d.participants.find(p=>p.id===id)?.name||id;
  reconcile(c?.id);
  const result=rosterResults(d,c?.id,filters);visibleIds=new Set(result.rows.map(r=>r.id));
  if(active&&(!visibleIds.has(active.id)||d.reservations.find(r=>r.id===active.id)?.participantId!==active.participantId))closeActive();
  if(historySelection&&(!visibleIds.has(historySelection.id)||d.reservations.find(r=>r.id===historySelection.id)?.participantId!==historySelection.participantId))historySelection=null;
  const header=`<div class="page-heading"><div><h1>Schedule & rosters</h1><p>Find an occurrence to view its roster and recorded history.</p></div><button class="button secondary" data-refresh-booking>Refresh roster</button></div>${navigation}<div class="toolbar"><label>Select class<select id="roster-class" aria-label="Select class" ${occurrences.length?'':'disabled'}><option value="">Select an occurrence</option>${occurrences.map(x=>`<option value="${e(x.id)}" ${x.id===c?.id?'selected':''}>${e(occurrenceOption(x))}</option>`).join('')}</select></label></div>`;
  if(!c)return header+`<section class="card" id="schedule-selection-empty"><h2>${error?'Check the date range and filters':occurrences.length?'Select an occurrence':'No matching occurrences'}</h2><p>${occurrences.length?'Choose an occurrence above to view its roster, controls and history.':'Adjust the filters or choose All dates. No occurrence is selected.'}</p></section>`;
  return header+`<section class="card" id="selected-roster"><h2>${e(c.title)}</h2><p>${studioDate(c.startsAt)?`${date(c.startsAt)} · ${time(c.startsAt)} Pacific`:'Start date and time: unrecorded'} · ${e(c.instructor)} · ${e(c.location)}</p><p>Occurrence ${e(c.id)} · Status: ${e(c.status||'unrecorded')}</p><p>${rows.filter(r=>r.status==='reserved').length} booked · Capacity ${e(c.capacity)}</p>${rosterFilterControls(filters,result,e)}<div class="table-wrap"><table><thead><tr><th>Participant</th><th>Booking</th><th>Attendance</th><th>Action</th></tr></thead><tbody>${result.rows.map(r=>`<tr data-reservation-id="${e(r.id)}"><td>${e(name(r.participantId))}<small class="roster-identity">Participant ${e(r.participantId)}<br>Reservation ${e(r.id)}</small></td><td>${e(r.status)}</td><td>${label(r.attendanceStatus)}</td><td><button class="button secondary small" data-attendance-open="${e(r.id)}">${r.status==='reserved'?'Record / correct attendance':'View attendance history'}</button><button type="button" class="text-button" data-reservation-history-open="${e(r.id)}">View reservation history</button></td></tr>`).join('')||`<tr><td colspan="4">${rows.length?'No matching reservation rows. Reset roster filters to see the full roster.':'No reservations on this roster.'}</td></tr>`}</tbody></table></div></section>${historySelection?reservationHistoryHTML(d,historySelection.id,e,historySelection.filters):''}`;
 }
 function open(id){
  if(!isStaff()||!scope||!visibleIds.has(id))return;
  const d=getData(),r=d.reservations.find(r=>r.id===id);if(!r)return;
  const c=d.classes.find(c=>c.id===r.classId),p=d.participants.find(p=>p.id===r.participantId),correction=(r.attendanceRevision||0)>0||r.attendanceStatus&&r.attendanceStatus!=='not_recorded';
  generation++;active={id,scope,participantId:r.participantId};
  modal(`<p data-roster-attendance>Participant ${e(r.participantId)} · Reservation ${e(r.id)}</p><h2>Attendance · ${e(p?.name||r.participantId)}</h2><p>${e(c?.title||r.classId)} · ${c?`${date(c.startsAt)} ${time(c.startsAt)} Pacific`:''}</p><p>Current attendance: <strong>${label(r.attendanceStatus)}</strong> · Booking: ${e(r.status)}</p>${r.status==='reserved'?`<form id="attendance-form" data-id="${e(r.id)}" data-revision="${r.attendanceRevision||0}"><label class="field">Attendance<select name="status">${['present','absent','not_recorded'].map(s=>`<option value="${s}" ${(r.attendanceStatus||'not_recorded')===s?'selected':''}>${label(s)}</option>`).join('')}</select></label><label class="field">${correction?'Correction reason':'Note (optional)'}<textarea name="reason" maxlength="1000" ${correction?'required':''}></textarea></label><p>Only attendance changes. No additional credit is consumed and no booking, cancellation or payment outcome is changed.</p><button class="button">Save attendance</button><p role="alert"></p></form>`:'<p>This booking cannot receive attendance changes.</p>'}<h3>Attendance history</h3>${(r.attendanceHistory||[]).map(h=>`<article><p>${e(h.createdAt)} · ${label(h.from)} → ${label(h.to)}</p><p>Actor ${e(h.actorId)} · Revision ${e(h.revision)}${h.reason?` · ${e(h.reason)}`:''}</p></article>`).join('')||'<p>No detailed attendance history recorded. Any existing legacy state has no detailed lineage.</p>'}`);
 }
 document.addEventListener('click',event=>{const b=event.target.closest('[data-attendance-open]');if(b&&isStaff())open(b.dataset.attendanceOpen);});
 document.querySelector('#dialog')?.addEventListener('close',()=>{if(!document.querySelector('#dialog').open&&active){active=null;generation++;}});
 document.addEventListener('submit',async event=>{
  const f=event.target;if(f.id!=='attendance-form')return;event.preventDefault();if(!isStaff()||f.dataset.pending)return;
  if(active?.id!==f.dataset.id||!visibleIds.has(f.dataset.id))return;
  const submittedGeneration=generation;
  f.dataset.pending='true';const b=f.querySelector('button');b.disabled=true;
  try{const fields=Object.fromEntries(new FormData(f));await mutate(`/api/reservations/${encodeURIComponent(f.dataset.id)}/attendance`,{...fields,expectedRevision:Number(f.dataset.revision)});if(isStaff()&&generation===submittedGeneration&&visibleIds.has(f.dataset.id)){open(f.dataset.id);notify('Attendance saved. The roster shows the current result.');}}
  catch(error){f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;b.disabled=false;}
 });
 document.addEventListener('submit',event=>{if(event.target.id!=='roster-filters')return;event.preventDefault();if(!isStaff()||!scope)return;filters=Object.fromEntries(new FormData(event.target));render();document.querySelector('#roster-filters button')?.focus();});
 document.addEventListener('click',event=>{if(!event.target.closest('[data-reset-roster-filters]')||!isStaff()||!scope)return;filters=defaultRosterFilters();render();document.querySelector('[data-reset-roster-filters]')?.focus();});
 document.addEventListener('click',event=>{
  const b=event.target.closest('[data-reservation-history-open]');
  if(b&&isStaff()&&scope&&visibleIds.has(b.dataset.reservationHistoryOpen)){
   const r=getData().reservations.find(r=>r.id===b.dataset.reservationHistoryOpen);if(!r)return;
   if(historySelection?.id!==r.id)historySelection={id:r.id,participantId:r.participantId,filters:defaultHistoryFilters()};render();document.querySelector('#reservation-history')?.focus();
  }
  if(event.target.closest('[data-close-reservation-history]')){const id=historySelection?.id;historySelection=null;render();[...document.querySelectorAll('[data-reservation-history-open]')].find(b=>b.dataset.reservationHistoryOpen===id)?.focus();}
 });
 document.addEventListener('submit',event=>{
  if(event.target.id!=='reservation-history-filters')return;event.preventDefault();
  if(!isStaff()||!scope||!historySelection||!visibleIds.has(historySelection.id))return;
  historySelection.filters=Object.fromEntries(new FormData(event.target));render();document.querySelector('#reservation-history-filters button')?.focus();
 });
 document.addEventListener('click',event=>{
  if(!event.target.closest('[data-reset-history-filters]')||!isStaff()||!scope||!historySelection)return;
  historySelection.filters=defaultHistoryFilters();render();document.querySelector('[data-reset-history-filters]')?.focus();
 });
 return {render:roster,reconcile};
}
