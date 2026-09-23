import {occurrenceOption,studioDate} from './schedule-navigation.js';
const label=status=>({present:'Present',absent:'Absent',not_recorded:'Not recorded'}[status]||'Not recorded');

export function attendanceUI({getData,isStaff,escape:e,modal,mutate,notify,date,time}){
 function roster(selectedClass,occurrences=getData().classes,navigation='',error=''){
  if(!isStaff())return '';
  const d=getData(),c=occurrences.find(c=>c.id===selectedClass),rows=d.reservations.filter(r=>r.classId===c?.id),name=id=>d.participants.find(p=>p.id===id)?.name||id;
  const header=`<div class="page-heading"><div><h1>Schedule & rosters</h1><p>Find an occurrence to view its roster and recorded history.</p></div><button class="button secondary" data-refresh-booking>Refresh roster</button></div>${navigation}<div class="toolbar"><label>Select class<select id="roster-class" aria-label="Select class" ${occurrences.length?'':'disabled'}><option value="">Select an occurrence</option>${occurrences.map(x=>`<option value="${e(x.id)}" ${x.id===c?.id?'selected':''}>${e(occurrenceOption(x))}</option>`).join('')}</select></label></div>`;
  if(!c)return header+`<section class="card" id="schedule-selection-empty"><h2>${error?'Check the date range and filters':occurrences.length?'Select an occurrence':'No matching occurrences'}</h2><p>${occurrences.length?'Choose an occurrence above to view its roster, controls and history.':'Adjust the filters or choose All dates. No occurrence is selected.'}</p></section>`;
  return header+`<section class="card" id="selected-roster"><h2>${e(c.title)}</h2><p>${studioDate(c.startsAt)?`${date(c.startsAt)} · ${time(c.startsAt)} Pacific`:'Start date and time: unrecorded'} · ${e(c.instructor)} · ${e(c.location)}</p><p>Occurrence ${e(c.id)} · Status: ${e(c.status||'unrecorded')}</p><p>${rows.filter(r=>r.status==='reserved').length} booked · Capacity ${e(c.capacity)}</p><div class="table-wrap"><table><thead><tr><th>Participant</th><th>Booking</th><th>Attendance</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${e(name(r.participantId))}</td><td>${e(r.status)}</td><td>${label(r.attendanceStatus)}</td><td><button class="button secondary small" data-attendance-open="${e(r.id)}">${r.status==='reserved'?'Record / correct attendance':'View attendance history'}</button></td></tr>`).join('')||'<tr><td colspan="4">No reservations on this roster.</td></tr>'}</tbody></table></div></section>`;
 }
 function open(id){
  if(!isStaff())return;
  const d=getData(),r=d.reservations.find(r=>r.id===id);if(!r)return;
  const c=d.classes.find(c=>c.id===r.classId),p=d.participants.find(p=>p.id===r.participantId),correction=(r.attendanceRevision||0)>0||r.attendanceStatus&&r.attendanceStatus!=='not_recorded';
  modal(`<h2>Attendance · ${e(p?.name||r.participantId)}</h2><p>${e(c?.title||r.classId)} · ${c?`${date(c.startsAt)} ${time(c.startsAt)} Pacific`:''}</p><p>Current attendance: <strong>${label(r.attendanceStatus)}</strong> · Booking: ${e(r.status)}</p>${r.status==='reserved'?`<form id="attendance-form" data-id="${e(r.id)}" data-revision="${r.attendanceRevision||0}"><label class="field">Attendance<select name="status">${['present','absent','not_recorded'].map(s=>`<option value="${s}" ${(r.attendanceStatus||'not_recorded')===s?'selected':''}>${label(s)}</option>`).join('')}</select></label><label class="field">${correction?'Correction reason':'Note (optional)'}<textarea name="reason" maxlength="1000" ${correction?'required':''}></textarea></label><p>Only attendance changes. No additional credit is consumed and no booking, cancellation or payment outcome is changed.</p><button class="button">Save attendance</button><p role="alert"></p></form>`:'<p>This booking cannot receive attendance changes.</p>'}<h3>Attendance history</h3>${(r.attendanceHistory||[]).map(h=>`<article><p>${e(h.createdAt)} · ${label(h.from)} → ${label(h.to)}</p><p>Actor ${e(h.actorId)} · Revision ${e(h.revision)}${h.reason?` · ${e(h.reason)}`:''}</p></article>`).join('')||'<p>No detailed attendance history recorded. Any existing legacy state has no detailed lineage.</p>'}`);
 }
 document.addEventListener('click',event=>{const b=event.target.closest('[data-attendance-open]');if(b&&isStaff())open(b.dataset.attendanceOpen);});
 document.addEventListener('submit',async event=>{
  const f=event.target;if(f.id!=='attendance-form')return;event.preventDefault();if(!isStaff()||f.dataset.pending)return;
  f.dataset.pending='true';const b=f.querySelector('button');b.disabled=true;
  try{const fields=Object.fromEntries(new FormData(f));await mutate(`/api/reservations/${encodeURIComponent(f.dataset.id)}/attendance`,{...fields,expectedRevision:Number(f.dataset.revision)});if(isStaff()){open(f.dataset.id);notify('Attendance saved. The roster shows the current result.');}}
  catch(error){f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;b.disabled=false;}
 });
 return {render:roster};
}
