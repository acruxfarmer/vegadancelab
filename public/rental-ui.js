// Customer presentation uses server-projected lifecycle values only.
const labels={scheduled:'Scheduled',ready:'Ready to start',ready_to_start:'Ready to start',starting:'Starting',active:'Active',expired:'Expired',revoked:'Revoked'};
export function rentalDate(value){const date=new Date(value);return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZoneName:undefined}).format(date):'';}
export function rentalTerms(policy,escape){
 if(!policy)return '';
 return `<div class="rental-terms"><p>Start within ${escape(policy.activationDays)} days of availability. Watch for ${escape(policy.viewingHours)} hours after your first video playback.</p><p>${policy.replayAllowed?'Replay is included during your viewing window.':'One viewing session; pause, seek and reconnect while your rental is active.'} Opening this page or watching an introduction does not start your rental.</p>${policy.releaseAt?`<p>Scheduled availability: ${escape(rentalDate(policy.releaseAt))}. Your start allowance begins when the video becomes available.</p>`:''}<p>Access expires at the displayed date and time. No new playback or replay is available after expiration.</p></div>`;
}
export function rentalStatus(rental,escape){
 if(!rental)return '';
 const status=String(rental.status||rental.state||'').toLowerCase();
 const rows=[['Available from',rental.availableAt||rental.releaseAt],['Start by',rental.startBy||rental.activationDeadlineAt],['Viewing expires',rental.expiresAt||rental.viewingExpiresAt]];
 const availability=typeof rental.availability==='object'?rental.availability.state:rental.availability;
 const message={suspended:'This video is temporarily suspended. Contact the business if you need an access adjustment.',withdrawn:'This video has been withdrawn and is unavailable.',unpublished:'This video is no longer offered for sale. Your existing viewing rights remain subject to their original terms.'}[availability];
 return `<section class="rental-status" aria-label="Your rental"><p><strong>${escape(labels[status]||'Rental access')}</strong></p>${message?`<p>${escape(message)}</p>`:''}${rows.filter(([,v])=>v).map(([k,v])=>`<p>${k}: <time datetime="${escape(v)}">${escape(rentalDate(v))}</time></p>`).join('')}${(rental.adjustments||[]).length?`<details><summary>Access adjustments</summary>${rental.adjustments.map(a=>`<p>${escape(rentalDate(a.createdAt||a.at))} · ${escape(({extend:'Viewing time extended',reset:'Activation reset',replace:'Access replaced',complimentary:'Complimentary access',revoke:'Access revoked'})[a.action]||'Access updated')}${a.customerMessage?' · '+escape(a.customerMessage):''}</p>`).join('')}</details>`:''}</section>`;
}
export function rentalPolicyFields(policy={},escape){
 const number=(name,label,value,min,max)=>`<label class="field">${label}<input type="number" name="${name}" value="${escape(value)}" min="${min}" max="${max}" step="1" required></label>`;
 return `<fieldset><legend>Rental terms</legend>${number('activationDays','Days to start after availability',policy.activationDays??30,1,3650)}${number('viewingHours','Viewing hours after first play',policy.viewingHours??48,1,8760)}<label><input type="checkbox" name="replayAllowed" ${policy.replayAllowed!==false?'checked':''}>Allow replay within the viewing window</label><label class="field">Release date and time (your local time)<input type="datetime-local" name="releaseAt" value="${escape(policy.releaseAt?localDateInput(policy.releaseAt):'')}"></label><p>Changes apply to future purchases. Existing purchased terms and valid checkout quotes are preserved.</p></fieldset>`;
}
function localDateInput(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):'';}
export function readRentalPolicy(form){return {activationDays:Number(form.get('activationDays')),viewingHours:Number(form.get('viewingHours')),replayAllowed:form.has('replayAllowed'),releaseAt:form.get('releaseAt')?new Date(form.get('releaseAt')).toISOString():null};}
