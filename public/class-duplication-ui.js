const labels={title:'Class title',instructor:'Instructor',location:'Studio or location',category:'Category',capacity:'Capacity',duration:'Duration in minutes',startsAt:'Start date and time',cancellationCutoffMinutes:'Cancellation cutoff (minutes)',creditRequired:'Require one class credit',waitlistEnabled:'Allow waitlist when full'};
const display=(key,value)=>typeof value==='boolean'?(value?'Yes':'No'):key==='startsAt'?`${new Date(value).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}) · ${value}`:String(value);
export function classDuplicationUI({getData,isStaff,escape:e,modal,api,mutate,load,notify}){
 const identity=()=>isStaff()?getData()?.context?.userId:null;
 let opening=0,reviewed=null;
 const fields=details=>`<dl>${Object.entries(labels).map(([key,label])=>`<dt>${label}</dt><dd>${e(display(key,details[key]))}</dd>`).join('')}</dl>`;
 function render(classId){
  if(!isStaff())return '';const c=getData().classes.find(c=>c.id===classId),o=getData().classDuplicateOptions?.find(o=>o.classId===classId);if(!c)return '';
  const h=c.creationProvenance;
  return `<section class="card"><h2>Create from this occurrence</h2><p>${e(o?.reason||'Refresh to check availability.')}</p><button class="button secondary" data-duplicate-occurrence="${e(c.id)}">Create one occurrence from existing</button>${h?`<details><summary>Creation provenance · ${e(h.createdAt)}</summary><p>Source occurrence ${e(h.sourceClassId)}<br>New occurrence ${e(h.classId)}<br>Staff ${e(h.actorId)} · Event ${e(h.id)}</p><p>Historical snapshot only. These occurrences change independently.</p>${fields(h.details)}</details>`:''}</section>`;
 }
 function form(c,versionToken,details){
  const values=details||c,local=details?new Date(details.startsAt):null,localDate=local?new Date(local.getTime()-local.getTimezoneOffset()*60000).toISOString().slice(0,23):'';
  modal(`<h2>Create one independent occurrence</h2><p>Starting from ${e(c.title)}. The source and its participants stay unchanged. Choose a new start, then review every detail.</p><form id="occurrence-duplicate-form" data-id="${e(c.id)}" data-version="${e(versionToken)}"><div class="form-grid">${['title','instructor','location','category','capacity','duration','cancellationCutoffMinutes'].map(k=>`<label class="field">${labels[k]}<input name="${k}" value="${e(values[k]??(k==='cancellationCutoffMinutes'?90:k==='category'?'Class':''))}" ${['capacity','duration','cancellationCutoffMinutes'].includes(k)?'type="number" step="1"':'maxlength="200"'} required></label>`).join('')}<label class="field full">New start (${e(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input name="startsAt" type="datetime-local" step="0.001" value="${e(localDate)}" required></label></div>${['creditRequired','waitlistEnabled'].map(k=>`<label class="check"><input name="${k}" type="checkbox" ${values[k]?'checked':''}> ${labels[k]}</label>`).join('')}<button class="button">Review new occurrence</button><p role="alert"></p></form><p><button class="text-button" data-duplicate-occurrence="${e(c.id)}">Refresh source and start again</button></p>`);
 }
 async function open(id){
  if(!isStaff())return;reviewed=null;const actor=identity(),attempt=++opening;
  modal('<h2>Checking source occurrence</h2><p role="status">Refreshing source details…</p>');
  try{await load();if(identity()!==actor||attempt!==opening||!document.querySelector('#dialog').open)return;
   const c=getData().classes.find(c=>c.id===id),o=getData().classDuplicateOptions?.find(o=>o.classId===id);
   if(!c||!o?.allowed){modal(`<h2>Source occurrence unavailable</h2><p role="status">${e(o?.reason||'Occurrence unavailable')}</p>`);return;}
   form(c,o.versionToken);
  }catch(error){if(identity()===actor&&attempt===opening)modal(`<h2>Source occurrence unavailable</h2><p role="alert">${e(error.message)}</p>`);}
 }
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.duplicateOccurrence)void open(b.dataset.duplicateOccurrence);
  if(b.hasAttribute('data-duplicate-back')&&reviewed&&identity()===reviewed.actor){const r=reviewed;reviewed=null;form({...r.sourceDetails,id:r.classId},r.versionToken,r.details);}
  if(b.hasAttribute('data-duplicate-close'))document.querySelector('#dialog').close();
 });
 document.addEventListener('submit',async event=>{
  const f=event.target;if(!['occurrence-duplicate-form','occurrence-duplicate-confirm'].includes(f.id))return;event.preventDefault();if(!isStaff()||f.dataset.pending)return;
  const actor=identity(),b=f.querySelector('button');f.dataset.pending='true';b.disabled=true;
  try{
   if(f.id==='occurrence-duplicate-form'){
    const details=Object.fromEntries(new FormData(f));
    for(const k of ['capacity','duration','cancellationCutoffMinutes'])details[k]=Number(details[k]);
    for(const k of ['creditRequired','waitlistEnabled'])details[k]=details[k]==='on';
    details.startsAt=new Date(details.startsAt).toISOString();
    const r=await api('/api/classes/duplicate/review',{method:'POST',body:JSON.stringify({classId:f.dataset.id,versionToken:f.dataset.version,details})});
    if(identity()!==actor||!f.isConnected||!document.querySelector('#dialog').open)return;
    reviewed={...r,actor};
    modal(`<h2>Review new occurrence</h2><p>Source: ${e(r.sourceDetails.title)} · ${e(r.classId)}</p>${fields(r.details)}<p>This creates one independent occurrence with no reservations, waitlist or attendance history. Later changes never synchronize with the source.</p><form id="occurrence-duplicate-confirm"><button class="button">Confirm new occurrence</button><p role="alert"></p></form><p><button class="text-button" data-duplicate-back>Back to details</button></p><p><button class="text-button" data-duplicate-occurrence="${e(r.classId)}">Refresh source and start again</button></p>`);
   }else{
    const r=reviewed;if(!r||r.actor!==actor)throw new Error('Review the proposed occurrence again.');
    const result=await mutate('/api/classes/duplicate',{classId:r.classId,versionToken:r.versionToken,reviewToken:r.reviewToken,details:r.details});
    if(identity()!==actor||!f.isConnected||!document.querySelector('#dialog').open)return;
    reviewed=null;modal(`<h2>New occurrence created</h2><p>${e(result.title)} · ${e(result.id)}</p><p>The schedule has been refreshed. The source is unchanged. These occurrences are independent.</p><button class="button" data-duplicate-close>Return to schedule</button>`);notify('New occurrence created. Schedule refreshed.');
   }
  }catch(error){if(identity()===actor&&f.isConnected)f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;b.disabled=false;}
 });
 return {render};
}
