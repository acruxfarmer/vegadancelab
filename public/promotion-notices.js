export function promotionNoticesHTML(data,e,occurrenceId){
 const staff=data.context?.role==='staff';
 const notices=(data.notifications||[]).filter(n=>n.type==='waitlist-promotion'&&n.status==='published'&&(staff?n.occurrenceId===occurrenceId:data.context?.participantIds?.includes(n.participantId)))
  .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0));
 if(!notices.length)return '';
 const value=x=>e(x===null||x===undefined||x===''?'unrecorded':String(x));
 return `<section class="card" aria-label="Promotion notices"><h2>${staff?'In-app promotion notices':'Your waitlist promotion notices'}</h2><p>Available in Vega. No email or SMS sent. Availability does not mean read or acknowledged.</p>${notices.map(n=>{
  const c=n.classSnapshot||{},r=data.reservations?.find(r=>r.id===n.reservationId&&r.participantId===n.participantId),current=data.classes?.find(c=>c.id===n.occurrenceId);
  return `<article data-promotion-notice="${e(n.id)}" style="overflow-wrap:anywhere"><h3>${e(n.subject)}</h3><p>Participant ${value(data.participants?.find(p=>p.id===n.participantId)?.name)} · ${value(n.participantId)}</p><p>Recorded at promotion: ${value(c.title)}<br>Starts ${value(c.startsAt)} · ${value(c.duration)} minutes<br>${value(c.instructor)} · ${value(c.location)}</p><p>${n.creditSnapshot?.outcome==='consumed'?'1 class credit consumed at promotion.':n.creditSnapshot?.outcome==='not_required'?'No class credit required at promotion.':'Historical credit consequence unrecorded.'}</p><p>Current booking: ${value(r?.status)} · Current occurrence: ${value(current?.status)}. This notice records the original promotion; current schedule details and booking status may have changed.</p><details><summary>Notice identity and recorded time</summary><p>Notice ${value(n.id)}<br>Reservation ${value(n.reservationId)}<br>Occurrence ${value(n.occurrenceId)}<br>Promotion ${value(n.promotionEventId)}<br>Recorded ${value(n.createdAt)}</p></details></article>`;
 }).join('')}</section>`;
}
