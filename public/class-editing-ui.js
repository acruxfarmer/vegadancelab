const labels={title:'Class title',instructor:'Instructor',location:'Studio or location',category:'Category',capacity:'Capacity',duration:'Duration in minutes',startsAt:'Start date and time',cancellationCutoffMinutes:'Cancellation cutoff (minutes)',creditRequired:'Require one class credit',waitlistEnabled:'Allow waitlist when full'};
const display=(key,value)=>typeof value==='boolean'?(value?'Yes':'No'):key==='startsAt'?`${new Date(value).toLocaleString()} (browser local time) · ${value}`:String(value);
export function classEditingUI({getData,isStaff,escape:e,modal,api,mutate,load,notify}){
 const identity=()=>isStaff()?getData()?.context?.userId:null;
 let opening=0,reviewed=null;
 function render(classId){
  if(!isStaff())return '';const c=getData().classes.find(c=>c.id===classId),o=getData().classEditOptions?.find(o=>o.classId===classId);if(!c)return '';
  return `<section class="card"><h2>Edit this occurrence</h2><p>${e(o?.reason||'Refresh to check editing availability.')}</p><button class="button secondary" data-edit-occurrence="${e(c.id)}">${o?.allowed?'Edit occurrence':'Check editing availability'}</button>${(c.editHistory||[]).map(h=>`<details><summary>Occurrence edited · ${e(h.createdAt)}</summary><p>Staff ${e(h.actorId)} · ${e(h.reason)} · Event ${e(h.id)}</p>${diff(Object.keys(h.after).filter(k=>h.before[k]!==h.after[k]).map(field=>({field,before:h.before[field],after:h.after[field]})))}</details>`).join('')}</section>`;
 }
 function diff(changes){return `<dl>${changes.map(x=>`<dt>${e(labels[x.field]||x.field)}</dt><dd>Before: ${e(display(x.field,x.before))}<br>After: ${e(display(x.field,x.after))}</dd>`).join('')}</dl>`;}
 function form(c,versionToken,reason=''){
  const local=new Date(c.startsAt),localDate=new Date(local.getTime()-local.getTimezoneOffset()*60000).toISOString().slice(0,23);
  modal(`<h2>Edit one occurrence</h2><p>Only this occurrence changes. Review the proposed changes before confirming.</p><form id="occurrence-edit-form" data-id="${e(c.id)}" data-version="${e(versionToken)}"><div class="form-grid">${['title','instructor','location','category','capacity','duration','cancellationCutoffMinutes'].map(k=>`<label class="field">${labels[k]}<input name="${k}" value="${e(c[k]??(k==='cancellationCutoffMinutes'?90:k==='category'?'Class':''))}" ${['capacity','duration','cancellationCutoffMinutes'].includes(k)?'type="number" step="1"':'maxlength="200"'} required></label>`).join('')}<label class="field full">Start date and time (your browser’s local time)<input name="startsAt" type="datetime-local" step="0.001" value="${e(localDate)}" required></label></div>${['creditRequired','waitlistEnabled'].map(k=>`<label class="check"><input name="${k}" type="checkbox" ${c[k]?'checked':''}> ${labels[k]}</label>`).join('')}<label class="field">Reason for this edit<textarea name="reason" required maxlength="1000">${e(reason)}</textarea></label><button class="button">Review proposed changes</button><p role="alert"></p></form><button class="text-button" data-edit-occurrence="${e(c.id)}">Refresh occurrence and start again</button>`);
 }
 async function open(id){
  if(!isStaff())return;reviewed=null;const actor=identity(),attempt=++opening;
  modal('<h2>Checking occurrence</h2><p role="status">Refreshing editing availability…</p>');
  try{await load();if(identity()!==actor||attempt!==opening||!document.querySelector('#dialog').open)return;
   const c=getData().classes.find(c=>c.id===id),o=getData().classEditOptions?.find(o=>o.classId===id);
   if(!c||!o?.allowed){modal(`<h2>Occurrence editing unavailable</h2><p role="status">${e(o?.reason||'Occurrence unavailable')}</p>`);return;}
   form(c,o.versionToken);
  }catch(error){if(identity()===actor&&attempt===opening)modal(`<h2>Occurrence editing unavailable</h2><p role="alert">${e(error.message)}</p>`);}
 }
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.editOccurrence)void open(b.dataset.editOccurrence);
  if(b.hasAttribute('data-edit-back')&&reviewed&&identity()===reviewed.actor){const r=reviewed;reviewed=null;form({...r.after,id:r.classId},r.versionToken,r.reason);}
  if(b.hasAttribute('data-edit-close'))document.querySelector('#dialog').close();
 });
 document.addEventListener('submit',async event=>{
  const f=event.target;if(!['occurrence-edit-form','occurrence-edit-confirm'].includes(f.id))return;event.preventDefault();if(!isStaff()||f.dataset.pending)return;
  const actor=identity(),b=f.querySelector('button');f.dataset.pending='true';b.disabled=true;
  try{
   if(f.id==='occurrence-edit-form'){
    const values=Object.fromEntries(new FormData(f)),{reason,...details}=values;
    for(const k of ['capacity','duration','cancellationCutoffMinutes'])details[k]=Number(details[k]);
    for(const k of ['creditRequired','waitlistEnabled'])details[k]=details[k]==='on';
    details.startsAt=new Date(details.startsAt).toISOString();
    const r=await api('/api/classes/edit/review',{method:'POST',body:JSON.stringify({classId:f.dataset.id,versionToken:f.dataset.version,details,reason})});
    if(identity()!==actor||!f.isConnected||!document.querySelector('#dialog').open)return;
    reviewed={...r,actor};
    modal(`<h2>Review occurrence changes</h2><p>${e(r.before.title)}</p>${diff(r.changes)}<p>Reason: ${e(r.reason)}</p><form id="occurrence-edit-confirm"><button class="button">Confirm occurrence changes</button><p role="alert"></p></form><button class="text-button" data-edit-back>Back to editing</button><button class="text-button" data-edit-occurrence="${e(r.classId)}">Refresh occurrence and start again</button>`);
   }else{
    const r=reviewed;if(!r||r.actor!==actor)throw new Error('Review the proposed changes again.');
    await mutate('/api/classes/edit',{classId:r.classId,versionToken:r.versionToken,reviewToken:r.reviewToken,details:r.after,reason:r.reason});
    if(identity()!==actor||!f.isConnected||!document.querySelector('#dialog').open)return;
    reviewed=null;modal('<h2>Occurrence updated</h2><p>The schedule has been refreshed. The occurrence keeps its identity and its changes are recorded in staff history.</p><button class="button" data-edit-close>Return to schedule</button>');notify('Occurrence updated. Schedule refreshed.');
   }
  }catch(error){if(identity()===actor&&f.isConnected)f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;b.disabled=false;}
 });
 return {render};
}
