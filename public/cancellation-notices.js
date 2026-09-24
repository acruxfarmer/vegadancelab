export function cancellationNoticesHTML(data,e,occurrenceId){
 const staff=data.context?.role==='staff';
 const notices=(data.notifications||[]).filter(n=>n.type==='occurrence-cancellation'&&n.status==='published'&&(staff?n.occurrenceId===occurrenceId:data.context?.participantIds?.includes(n.participantId)))
  .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0));
 if(!notices.length)return '';
 const value=x=>e(x===null||x===undefined||x===''?'unrecorded':String(x));
 return `<section class="card" aria-label="Cancellation notices"><h2>${staff?'In-app cancellation notices':'Your class cancellation notices'}</h2><p>Available in Vega. No email or SMS sent. Availability does not mean read or acknowledged.</p>${notices.map(n=>{
  const c=n.classSnapshot||{},r=data.reservations?.find(r=>r.id===n.reservationId&&r.participantId===n.participantId),current=data.classes?.find(c=>c.id===n.occurrenceId),from=n.reservationSnapshot?.from;
  const credit=n.creditSnapshot?.outcome;
  const consequence=credit==='restored'?'1 class credit was restored under its original terms. Its expiry and restrictions were unchanged; this does not establish current availability.':credit==='not_applicable'?'No class credit was consumed for this reservation. No credit was restored.':credit==='already_restored'?'The previously restored credit was unchanged. No additional credit was restored.':'Historical credit consequence unrecorded.';
  return `<article data-cancellation-notice="${e(n.id)}" style="overflow-wrap:anywhere"><h3>${e(n.subject)}</h3><p>Participant ${value(data.participants?.find(p=>p.id===n.participantId)?.name)} · ${value(n.participantId)}</p><p>Recorded at cancellation: ${value(c.title)}<br>Starts ${value(c.startsAt)} · ${value(c.duration)} minutes<br>${value(c.instructor)} · ${value(c.location)}</p><p>${from==='reserved'?'Your booked place was cancelled.':from==='waitlisted'?'Your waitlist entry was closed.':'Historical reservation state unrecorded.'}</p><p>${consequence}</p><p>Current booking: ${value(r?.status)} · Current occurrence: ${value(current?.status)}. This notice records the original cancellation; current schedule details and booking status are shown separately.</p><details><summary>Cancellation notice identity and recorded time</summary><p>Notice ${value(n.id)}<br>Reservation ${value(n.reservationId)}<br>Occurrence ${value(n.occurrenceId)}<br>Cancellation ${value(n.cancellationEventId)}<br>Recorded ${value(n.createdAt)}</p></details></article>`;
 }).join('')}</section>`;
}
