import {cancellationOutcome} from './member-cancellation.js';

export function memberPortalUI({getData,escape:e,date,time}){
 const stamp=value=>Number.isFinite(Date.parse(value))?`${new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))} Pacific`:'Date unavailable';
 function entitlements(){
  const d=getData(),summary=d.memberAccount;
  if(!summary)return '<section class="card"><h2>Your credits</h2><p>Credit availability is unavailable. Refresh your account to try again.</p></section>';
  const types={drop_in:'Single-class credit',class_pack:'Class pack',membership:'Membership',courtesy:'Courtesy credit'};
  return `<section aria-label="Your credits"><h2>Your credits</h2><p><strong>${summary.available} credits available now</strong> · Class restrictions and the class start date still apply. Availability is checked again when booking.</p><div class="grid">${d.passes.map(p=>{
   const s=summary.passes.find(s=>s.passId===p.id),t=p.entitlement||{},name=d.participants.find(x=>x.id===p.participantId)?.name||'Member';
   return `<article class="card"><h3>${e(p.label)}</h3><p>${e(name)} · ${e(types[t.productType]||(t.source==='staff_courtesy'?'Courtesy credit':'Studio-issued credit'))}</p><p><strong>${s.available} available now</strong>${s.expired?` · ${s.expired} expired`:''}${s.future?` · ${s.future} not yet valid`:''}${!s.unspent?' · No unspent credits':''}</p>${s.restored?`<p>${s.restored} available ${s.restored===1?'credit':'credits'} restored after cancellation, under their original terms.</p>`:''}<p>${t.validFrom?`Valid from ${e(stamp(t.validFrom))}<br>`:''}${t.expiresAt?`Expires ${e(stamp(t.expiresAt))}`:'No expiration'}</p><p>Categories: ${e(t.categories?.join(', ')||'All classes')}<br>Class restrictions: ${e(t.classIds?.length?t.classIds.map(id=>d.classes.find(c=>c.id===id)?.title||'Specific studio class').join(', '):'No specific-class restriction')}</p></article>`;
  }).join('')||'<p>No credits or entitlements have been issued.</p>'}</div><p class="meta">Updated ${e(stamp(summary.checkedAt))}. Restoring a credit does not extend its expiry.</p></section>`;
 }
 function activity(){
  const d=getData(),items=d.reservations.flatMap(r=>{
   const c=d.classes.find(c=>c.id===r.classId),pass=d.passes.find(p=>p.id===r.creditConsumption?.passId),who=d.participants.find(p=>p.id===r.participantId)?.name||'Member';
   const details={title:c?.title||'Class details unavailable',who};
   return [{...details,at:r.createdAt,label:'Booking made',detail:r.creditConsumption?`1 credit used from ${pass?.label||'class credits'}.`:'No class credit consumed.'},...(r.status==='cancelled'?[{...details,at:r.cancellation?.originalCancelledAt,label:r.cancellation?.classification==='early'?'Early cancellation':r.cancellation?.classification==='late'?'Late cancellation':'Cancellation',detail:cancellationOutcome(r,pass?.label)}]:[])];
  }).filter(x=>Number.isFinite(Date.parse(x.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,10);
  return `<section class="card"><h2>Recent booking & cancellation activity</h2>${items.map(x=>`<article><h3>${e(x.label)} · ${e(x.title)}</h3><p>${e(x.who)} · ${e(stamp(x.at))}</p><p>${e(x.detail)}</p></article>`).join('')||'<p>No dated booking or cancellation activity yet.</p>'}<p class="meta">Most recent 10 recorded booking and cancellation events. Cancellation results reflect the current recorded outcome.</p></section>`;
 }
 return {entitlements,activity};
}
