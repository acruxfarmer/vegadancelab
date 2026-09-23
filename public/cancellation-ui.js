import {cancellationOutcome} from './member-cancellation.js';
export function cancellationUI({escape:e,mutate,notify,getData}){
 const field=(name,label,type='text',value='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${e(value)}" required></label>`;
 return {
  render(page,{includeCredits=true,occurrenceId}={}){
   let source=getData();const staff=source.context.role==='staff';
   if(staff&&page==='schedule'&&occurrenceId!==undefined){if(!occurrenceId)return '';source={...source,classes:source.classes.filter(c=>c.id===occurrenceId),reservations:source.reservations.filter(r=>r.classId===occurrenceId)};}
   // Present member outcomes in plain language without modifying persisted records.
   const d=staff?source:{...source,reservations:source.reservations.map(r=>r.cancellation?{...r,cancellation:{...r.cancellation,creditOutcome:cancellationOutcome(r,source.passes?.find(p=>p.id===r.creditConsumption?.passId)?.label)}}:r)};let html='';
   if(includeCredits&&(page==='bookings'||page==='people'))html+=`<section class="card"><h2>Class credits</h2>${d.participants.map(p=>`<p>${e(p.name)}: ${(d.creditUnits||[]).filter(u=>u.participantId===p.id&&u.status==='available').length} unspent credits (eligibility applies)</p>`).join('')}<p class="meta">Only classes configured to require a credit consume one. Cancellation never creates a cash refund.</p></section>`;
   if(staff&&page==='people')html+=`<form id="issue-credit" class="card"><h2>Issue manual courtesy credits</h2><label class="field">Participant<select name="participantId">${d.participants.map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></label>${field('quantity','Number of credits','number','1')}${field('reason','Issuance reason')}<button class="button">Issue credits</button><p role="alert"></p></form><section class="card"><h2>Credit history</h2>${(d.creditEvents||[]).map(v=>`<p>${e(v.type)} · ${e(v.createdAt)} · booking ${e(v.bookingId||'issuance')} · credit ${e(v.unitId)} · actor ${e(v.actorId)}</p>`).join('')||'<p>No credit movements.</p>'}</section>`;
   if(staff&&page==='schedule'){
    html+=`<section class="card"><h2>Cancellation policies</h2>${d.classes.map(c=>`<form id="policy-${e(c.id)}" data-cancellation-policy><input type="hidden" name="classId" value="${e(c.id)}"><h3>${e(c.title)}</h3><p>${c.creditRequired?'One class credit required':'No credit consumed'}</p>${field('cancellationCutoffMinutes','Early cancellation cutoff (minutes)','number',c.cancellationCutoffMinutes??90)}<button class="button secondary">Save cutoff</button><p role="alert"></p></form>`).join('')}</section>`;
   }
   if(page==='bookings'||(staff&&page==='schedule')){
    html+=`<section class="card"><h2>Cancellation records</h2>${d.reservations.filter(r=>r.status==='cancelled').map(r=>`<article><h3>${e(d.classes.find(c=>c.id===r.classId)?.title||'Class')}</h3><p class="meta">${e(d.participants.find(p=>p.id===r.participantId)?.name||r.participantId)} · booking ${e(r.id)}</p><p>${e(r.cancellation?.classification||'Unclassified legacy cancellation')} cancel · ${e(r.cancellation?.creditOutcome||'No credit movement recorded')}</p><p class="meta">Original: ${e(r.cancellation?.originalClassification||'unclassified')} · ${e(r.cancellation?.originalCancelledAt||'time unavailable')} · cutoff ${e(r.cancellation?.cutoffMinutes??'unrecorded')} minutes</p>${r.classCancellation?'<p>Studio occurrence cancellation. Reclassification requires separate reconciliation.</p>':''}${staff&&r.cancellation&&!r.classCancellation?`<form data-cancellation-correction><input type="hidden" name="reservationId" value="${e(r.id)}"><label class="field">Classification<select name="classification"><option value="early" ${r.cancellation.classification==='early'?'selected':''}>Early cancel</option><option value="late" ${r.cancellation.classification==='late'?'selected':''}>Late cancel</option></select></label>${field('reason','Correction reason')}<button class="button secondary">Record correction</button><p role="alert"></p></form>`:''}${(r.cancellationHistory||[]).map(h=>`<p class="meta">${e(h.createdAt)} · ${e(h.action)} → ${e(h.to)} ${staff?`· ${e(h.outcome)} · ${e(h.reason||'policy classification')} · actor ${e(h.actorId)}`:''}</p>`).join('')}</article>`).join('')||'<p>No cancellation records.</p>'}</section>`;
   }
   return html;
  },
  async submit(form){
   if(form.id!=='issue-credit'&&!form.hasAttribute('data-cancellation-policy')&&!form.hasAttribute('data-cancellation-correction'))return false;
   const v=Object.fromEntries(new FormData(form));let result;
   if(form.id==='issue-credit')result=await mutate('/api/credits/issue',{...v,quantity:Number(v.quantity)},()=>{});
   else if(form.hasAttribute('data-cancellation-policy'))result=await mutate('/api/classes/policy',{...v,cancellationCutoffMinutes:Number(v.cancellationCutoffMinutes)},()=>{});
   else {const {reservationId,...body}=v;result=await mutate(`/api/reservations/${encodeURIComponent(reservationId)}/correct-cancellation`,body,()=>{});}
   notify(result?.message||'Saved.');return true;
  }
 };
}
