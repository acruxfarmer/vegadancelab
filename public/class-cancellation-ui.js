export function classCancellationUI({getData,isStaff,escape:e,modal,mutate,load,notify}){
 const identity=()=>isStaff()?getData()?.context?.userId:null;
 function render(classId){
  if(!isStaff())return '';const c=getData().classes.find(c=>c.id===classId);if(!c)return '';
  return `<section class="card"><h2>Class cancellation</h2><p>Occurrence state: <strong>${e(c.status)}</strong></p>${c.status==='cancelled'?`<p>Cancelled ${e(c.cancelledAt)}. New bookings, waitlist joins and promotions are unavailable.</p>`:`<button class="button secondary" data-review-class-cancel="${e(c.id)}">Review class cancellation</button>`}${(c.cancellationHistory||[]).map(h=>`<article><p>${e(h.createdAt)} · Staff ${e(h.actorId)} · Event ${e(h.id)}</p><p>${e(h.reason)}</p><p>${h.affected.length} reservation transitions preserved. Credit lineage is available in operational audit.</p></article>`).join('')}</section>`;
 }
 let opening=0;
 async function open(id){
  if(!isStaff())return;const actor=identity(),attempt=++opening;
  modal('<h2>Checking class cancellation</h2><p role="status">Refreshing the occurrence and credit impact…</p>');
  try{await load();if(identity()!==actor||attempt!==opening||!document.querySelector('#dialog').open)return;
   const d=getData(),c=d.classes.find(c=>c.id===id),o=d.classCancellationOptions?.find(o=>o.classId===id);
   modal(`<h2>Review class cancellation</h2><p>${e(c?.title||'Class unavailable')} · ${e(c?.startsAt)}</p>${o?`<dl><dt>Active bookings affected</dt><dd>${o.activeBookings}</dd><dt>Waiting entries affected</dt><dd>${o.waitingEntries}</dd><dt>Expected credit restorations</dt><dd>${o.expectedRestorations}</dd><dt>In-app cancellation notices</dt><dd>${o.expectedNotices}</dd></dl>`:''}<p role="status">${e(o?.reason||'Cancellation impact unavailable. Refresh before continuing.')}</p><p>Previously cancelled reservations remain unchanged. Restored credits keep their original expiry and restrictions; an expired credit remains unusable. One in-app cancellation notice is recorded for each affected reservation. No email or SMS is sent. This does not issue a cash refund.</p>${o?.allowed?`<form id="class-cancellation-form" data-class="${e(id)}" data-impact="${e(o.impactToken)}"><label class="field">Class cancellation reason<textarea name="reason" required maxlength="1000"></textarea></label><button class="button">Confirm class cancellation</button><p role="alert"></p></form>`:''}<button class="text-button" data-review-class-cancel="${e(id)}">Refresh cancellation impact</button>`);
  }catch(error){if(identity()===actor&&attempt===opening)modal(`<h2>Class cancellation unavailable</h2><p role="alert">${e(error.message)}</p><button class="button" data-review-class-cancel="${e(id)}">Try again</button>`);}
 }
 document.addEventListener('click',event=>{const b=event.target.closest('[data-review-class-cancel]');if(b&&isStaff())void open(b.dataset.reviewClassCancel);if(event.target.closest('[data-close-class-cancel]'))document.querySelector('#dialog').close();});
 document.addEventListener('submit',async event=>{
  const f=event.target;if(f.id!=='class-cancellation-form')return;event.preventDefault();if(!isStaff()||f.dataset.pending)return;
  const actor=identity(),b=f.querySelector('button');f.dataset.pending='true';b.disabled=true;
  try{await mutate('/api/classes/cancel',{classId:f.dataset.class,impactToken:f.dataset.impact,reason:new FormData(f).get('reason')});if(identity()!==actor)return;
   const c=getData().classes.find(c=>c.id===f.dataset.class);
   modal(`<h2>${c?.status==='cancelled'?'Class cancellation confirmed':'Class cancellation processed'}</h2><p>Occurrence state: ${e(c?.status||'unavailable')}. The roster, reservations and credit account have been refreshed.</p><p>Any consumed credits were restored under their original terms. Waiting entries were closed without credit movement. Previously cancelled bookings were preserved. In-app cancellation notices are available for affected reservations. No email or SMS sent; availability does not mean read or acknowledged.</p><button class="button" data-close-class-cancel>Return to roster</button>`);notify('Class cancellation processed. The roster shows the current state.');
  }catch(error){if(identity()===actor&&f.isConnected)f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;b.disabled=false;}
 });
 return {render};
}
