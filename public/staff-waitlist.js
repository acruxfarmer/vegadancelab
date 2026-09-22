export function staffWaitlistUI({getData,isStaff,escape:e,modal,mutate,load,notify}){
 const identity=()=>isStaff()?getData()?.context?.userId:null;
 function render(classId){
  if(!isStaff())return '';
  const d=getData(),entries=(d.promotionOptions||[]).filter(o=>o.classId===classId).sort((a,b)=>a.position-b.position);
  return `<section class="card"><h2>Waitlist</h2><p>Join time, then reservation ID determines queue order. Staff promotes the earliest currently eligible participant. Ineligible entries remain in place. Waiting reserves no seat and spends no credit.</p>${entries.map(o=>{const r=d.reservations.find(r=>r.id===o.reservationId);return `<article><h3>${o.position}. ${e(d.participants.find(p=>p.id===r?.participantId)?.name||'Participant')}</h3><p>Joined ${e(r?.createdAt||'time unrecorded')} · ${e(r?.id)}</p><p>${e(o.reason)}</p><button class="button secondary" data-review-promotion="${e(o.reservationId)}">Review promotion</button></article>`;}).join('')||'<p>No waiting participants.</p>'}</section>`;
 }
 let opening=0;
 async function open(id){
  if(!isStaff())return;const actor=identity(),attempt=++opening;
  modal('<h2>Checking promotion</h2><p role="status">Refreshing capacity and eligible credits…</p>');
  try{await load();if(identity()!==actor||attempt!==opening||!document.querySelector('#dialog').open)return;
   const d=getData(),r=d.reservations.find(r=>r.id===id),o=d.promotionOptions?.find(o=>o.reservationId===id),c=d.classes.find(c=>c.id===r?.classId),p=d.participants.find(p=>p.id===r?.participantId);
   modal(`<h2>Review waitlist promotion</h2><p>${e(p?.name||'Participant')} · ${e(c?.title||'Class unavailable')}</p><p>${e(r?.status||'Entry unavailable')} · Position ${o?.position??'not waiting'}</p><p role="status">${e(o?.reason||'This entry is no longer waiting. Refresh the roster to inspect its current state.')}</p>${o?.promotable?`<p>${o.creditRequired?`Confirming consumes 1 credit from ${e(o.passLabel)}. ${o.eligibleCredits} eligible credits; expires ${e(o.expiresAt||'never')}.`:'No class credit is required.'}</p><p>${Math.max(0,c.capacity-c.reservedCount)} seats available. Capacity, queue order and credit eligibility are checked again atomically. No attendance or payment outcome is changed.</p><form id="waitlist-promotion" data-id="${e(id)}" data-pass="${e(o.passId||'')}"><button class="button">Confirm promotion</button><p role="alert"></p></form>`:''}<button class="text-button" data-review-promotion="${e(id)}">Refresh promotion review</button>`);
  }catch(error){if(identity()===actor&&attempt===opening)modal(`<h2>Promotion unavailable</h2><p role="alert">${e(error.message)}</p><button class="button" data-review-promotion="${e(id)}">Try again</button>`);}
 }
 document.addEventListener('click',event=>{const b=event.target.closest('[data-review-promotion]');if(b&&isStaff())void open(b.dataset.reviewPromotion);});
 document.addEventListener('submit',async event=>{
  const f=event.target;if(f.id!=='waitlist-promotion')return;event.preventDefault();if(!isStaff()||f.dataset.pending)return;
  const actor=identity();f.dataset.pending='true';const b=f.querySelector('button');b.disabled=true;
  try{await mutate(`/api/reservations/${encodeURIComponent(f.dataset.id)}/promote`,f.dataset.pass?{passId:f.dataset.pass}:{});if(identity()!==actor)return;
   const r=getData().reservations.find(r=>r.id===f.dataset.id);modal(`<h2>${r?.status==='reserved'?'Promotion confirmed':'Promotion processed'}</h2><p>Current booking state: ${e(r?.status||'unavailable')}. The roster and member account have been refreshed.</p><p>${r?.creditConsumption?'The booking uses one class credit.':'No class credit consumed.'} Attendance and payment remain separate.</p><button class="button" data-close-promotion>Return to roster</button>`);notify('Promotion processed. Review the current roster.');
  }catch(error){if(identity()===actor&&f.isConnected)f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;b.disabled=false;}
 });
 document.addEventListener('click',event=>{if(event.target.closest('[data-close-promotion]'))document.querySelector('#dialog').close();});
 return {render};
}
