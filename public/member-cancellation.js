export function cancellationOutcome(r,passLabel='your class pass'){
 const c=r.cancellation;
 if(!c)return 'The credit outcome for this cancellation was not recorded. Contact the studio if you need help.';
 if(!r.creditConsumption)return 'No class credit was consumed for this booking. No credit was restored.';
 if(['restored','already_restored'].includes(c.creditOutcome))return `1 credit was restored to ${passLabel}. Its original restrictions and expiry still apply.`;
 if(c.classification==='late'||['reversed','already_reversed'].includes(c.creditOutcome))return `Your consumed credit remains spent. No credit was restored to ${passLabel}.`;
 return 'The credit outcome could not be confirmed. Check your pass balance or contact the studio.';
}

export function cancellationConsequence(option){
 if(!option?.allowed)return option?.reason||'Cancellation details are unavailable. Refresh or contact the studio.';
 if(!option.creditConsumed)return 'No class credit was consumed for this booking. Cancelling will not change your credit balance.';
 return option.classification==='early'?`1 credit will be restored to ${option.passLabel}. Its original restrictions and expiry will still apply.`:`Your consumed credit will remain spent. No credit will be restored to ${option.passLabel}.`;
}

export function memberCancellationUI({getData,isMember,escape:e,modal,load,mutate,notify,date,time}){
 const dialog=()=>document.querySelector('#dialog');
 const body=()=>document.querySelector('#dialog-body');
 const identity=()=>isMember()?getData()?.context?.userId:null;
 const passLabel=r=>getData()?.passes?.find(p=>p.id===r.creditConsumption?.passId)?.label||'your class pass';
 function result(r,title='Booking cancelled'){
  const c=getData()?.classes.find(c=>c.id===r.classId);if(r.classCancellation){modal(`<h2>Class cancelled by studio</h2><h3>${e(c?.title||'Class')}</h3><p>${e(cancellationOutcome(r,passLabel(r)))}</p><button class="button" data-booking-done>View my bookings</button>`);return;}if(r.cancellation?.originalBookingStatus==='waitlisted'){modal(`<h2>Waitlist left</h2><h3>${e(c?.title||'Class')}</h3><p>No seat was reserved and no credit was consumed or restored.</p><button class="button" data-booking-done>View my bookings</button>`);return;}
  modal(`<h2>${e(title)}</h2><h3>${e(c?.title||'Class booking')}</h3><p>${e(r.cancellation?.classification?`${r.cancellation.classification==='early'?'Early':'Late'} cancellation recorded.`:'Cancellation recorded.')}</p><p role="status">${e(cancellationOutcome(r,passLabel(r)))}</p><p>Your booking and credit state are updated.</p><button class="button" data-booking-done>View my bookings</button>`);
 }
 let opening=0;
 async function open(id){
  const actor=identity(),attempt=++opening;
  modal('<h2>Checking cancellation</h2><p role="status">Loading the current booking and cancellation consequence…</p>');
  try{
   await load();if(identity()!==actor||attempt!==opening||!dialog().open)return;
   const d=getData(),r=d.reservations.find(r=>r.id===id),option=d.cancellationOptions?.find(o=>o.reservationId===id);
   if(r?.status==='cancelled'){result(r,'Booking already cancelled');return;}
   const c=d.classes.find(c=>c.id===r?.classId);
   if(!r||!option?.allowed){body().innerHTML=`<h2>Unable to cancel online</h2><p role="alert">${e(!r?'This booking is unavailable. Refresh your bookings or contact the studio.':cancellationConsequence(option))}</p><button class="button secondary" data-cancellation-keep>Close</button>`;return;}
   if(r.status==='waitlisted'){body().innerHTML=`<h2>Leave this waitlist?</h2><h3>${e(c.title)}</h3><p>Leaving releases your waitlist position. It does not change credits or cancel a confirmed booking. Rejoining puts you at the end of the queue.</p><form id="member-cancellation" data-id="${e(id)}" data-waitlist="true"><button class="button danger" type="submit">Confirm leave waitlist</button><button class="button secondary" type="button" data-cancellation-keep>Keep waiting</button><p role="alert"></p><button class="text-button" type="button" data-review-cancellation="${e(id)}" hidden>Review current booking</button></form>`;return;}
   body().innerHTML=`<h2>Cancel this booking?</h2><h3>${e(c.title)}</h3><p>${date(c.startsAt)} · ${time(c.startsAt)} Pacific</p><p><strong>${option.classification==='early'?'Early cancellation':'Late cancellation'}</strong></p><div class="notice">${e(cancellationConsequence(option))}</div>${option.creditConsumed&&option.expiresAt?`<p>Original credit expiry: ${date(option.expiresAt)} · ${time(option.expiresAt)} Pacific.</p>`:''}<p>Early cancellation deadline: ${date(option.cutoffAt)} · ${time(option.cutoffAt)} Pacific.</p><p class="meta">If the consequence changes before confirmation, you will be asked to review it again.</p><form id="member-cancellation" data-id="${e(id)}" data-classification="${e(option.classification)}"><button class="button danger" type="submit">Confirm ${option.classification} cancellation</button> <button class="button secondary" type="button" data-cancellation-keep>Keep booking</button><p role="alert"></p><button class="text-button" type="button" data-review-cancellation="${e(id)}" hidden>Review current booking</button></form>`;
  }catch(error){if(identity()===actor&&attempt===opening&&dialog().open)body().innerHTML=`<h2>Unable to check cancellation</h2><p role="alert">${e(error.message)} No cancellation was submitted.</p><button class="button" data-review-cancellation="${e(id)}">Try again</button>`;}
 }
 async function submit(form){
  if(form.dataset.pending)return;
  const actor=identity();form.dataset.pending='true';const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{
   const r=await mutate(`/api/reservations/${encodeURIComponent(form.dataset.id)}/cancel`,form.dataset.waitlist==='true'?{expectedReservationStatus:'waitlisted'}:{expectedCancellationClassification:form.dataset.classification},()=>{});
   if(identity()!==actor)return;
   result(r);notify(r.cancellation?.originalBookingStatus==='waitlisted'?'Waitlist left. Credits unchanged.':'Booking cancelled. Your credit outcome is shown in the confirmation.');
  }catch(error){
   if(identity()!==actor||!form.isConnected)return;
   form.querySelector('[role="alert"]').textContent=`${error.message} Review the current booking to confirm its status before trying again.`;
   form.querySelector('[data-review-cancellation]').hidden=false;
  }finally{delete form.dataset.pending;buttons.filter(b=>b.type!=='submit').forEach(b=>b.disabled=false);}
 }
 document.addEventListener('click',event=>{
  if(!isMember())return;const b=event.target.closest('button');if(!b)return;
  if(b.dataset.cancel||b.dataset.reviewCancellation){event.preventDefault();event.stopImmediatePropagation();void open(b.dataset.cancel||b.dataset.reviewCancellation);}
  else if(b.hasAttribute('data-cancellation-keep'))dialog().close();
 },true);
 document.addEventListener('submit',event=>{if(event.target.id==='member-cancellation'){event.preventDefault();void submit(event.target);}});
 return {open,submit};
}
