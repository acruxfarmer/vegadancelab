// A projection of the authorized application response, never a transaction engine.
export const deskScope=d=>JSON.stringify([d?.context?.tenantId,d?.context?.businessId,d?.context?.userId]);
export function deskCustomer(d,id){
 const can=p=>d?.staffAccess?.permissions?.includes(p),people=(d?.participants||[]).filter(p=>p.id===id);
 if(d?.context?.role!=='staff'||!can('attendance.read')||people.length!==1)return null;
 const person=people[0],profiles=(d.profileAdministration?.participants||[]).filter(p=>p.participantId===id),profile=profiles.length===1?profiles[0]:null;
 const customers=(d.frontDesk?.customers||[]).filter(p=>p.participantId===id);
 const accounts=new Set([profile?.profile?.accountId,...(profile?.acceptances||[]).map(a=>a.accountId),...customers.map(c=>c.buyerId)].filter(Boolean));
 const review=profiles.length>1||customers.length>1||accounts.size>1||profile?.status==='Needs Staff Review';
 const linked=!review&&accounts.size===1;
 const reservations=(d.reservations||[]).filter(r=>r.participantId===id),passes=can('bookings.manage')?(d.passes||[]).filter(p=>p.participantId===id):[];
 const passIds=new Set(passes.map(p=>p.id)),balances=(d.staffAccount?.passes||[]).filter(p=>passIds.has(p.passId));
 const purchases=can('finance.read')||can('sales.manage')?(d.purchaseDrafts||[]).filter(p=>p.participantId===id):[],purchaseIds=new Set(purchases.map(p=>p.id));
 return {person,profile:can('customers.read')?profile:null,can,review,linked,customers:linked?customers:[],reservations,passes,balances,purchases,refunds:can('finance.read')?(d.refundHistory||[]).filter(r=>purchaseIds.has(r.purchaseId)):[],available:balances.reduce((n,p)=>n+p.available,0)};
}
export function frontDeskOperationsUI({getData,escape:e,load,render,notify,openAttendance,saleHTML,commerceHTML,refundHTML,date,time}){
 let selected='',query='',scope='',cachedSource,cachedId,cached;
 const sync=()=>{const next=deskScope(getData());if(next!==scope){scope=next;selected='';query='';}if(selected&&!deskCustomer(getData(),selected))selected='';};
 function scoped(){
  sync();const d=getData();if(cachedSource===d&&cachedId===selected)return cached;
  const c=deskCustomer(d,selected);cachedSource=d;cachedId=selected;
  cached={...d,participants:c?[c.person]:[],purchaseDrafts:c?.purchases||[],refundHistory:c?.refunds||[],commerceOffers:[],frontDesk:{...d?.frontDesk,customers:c?.customers||[]}};return cached;
 }
 const stamp=s=>Number.isFinite(Date.parse(s))?`${date(s)} · ${time(s)}`:'Time unavailable';
 function booking(r,c,d){
  const occurrence=d.classes.find(x=>x.id===r.classId),promotion=d.promotionOptions?.find(o=>o.reservationId===r.id);
  const status=r.attendanceStatus==='present'?'Checked in':r.attendanceStatus==='absent'?'Absent':({reserved:'Booked',waitlisted:'Waitlisted',cancelled:'Cancelled'}[r.status]||'Needs Staff Review');
  return `<article class="card"><h3>${e(occurrence?.title||'Class unavailable')}</h3><p>${e(stamp(occurrence?.startsAt))} · <strong>${e(status)}</strong></p>${c.can('bookings.manage')&&['reserved','waitlisted'].includes(r.status)&&r.attendanceStatus==='not_recorded'?`<button class="button secondary" data-staff-cancel="${e(r.id)}">${r.status==='waitlisted'?'Leave waitlist':'Cancel booking'}</button>`:''}${c.can('bookings.manage')&&promotion?`<button class="button secondary" data-review-promotion="${e(r.id)}">Review promotion</button>`:''}${c.can('attendance.write')&&r.status==='reserved'?`<button class="button secondary" data-desk-attendance="${e(r.id)}">${r.attendanceStatus==='not_recorded'?'Check in / record attendance':'Correct attendance'}</button>`:''}</article>`;
 }
 function page(){
  sync();const d=getData(),c=deskCustomer(d,selected),people=d.participants.filter(p=>`${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase()));
  let html=`<div class="page-heading"><div><h1>Front desk</h1><p>Find a customer, review their current status and help with their next step.</p></div><button class="button secondary" data-desk-refresh>Refresh customer records</button></div><form id="desk-search"><label class="field">Find existing customer<input type="search" name="query" value="${e(query)}"></label><button class="button secondary">Search</button></form><section class="card" aria-label="Customer results">${people.map(p=>`<p>${e(p.name)} <button class="button secondary" data-desk-customer="${e(p.id)}">Open ${e(p.name)}</button></p>`).join('')||'<p>No matching customers in your permitted workspace.</p>'}</section>`;
  if(!c)return html+'<p>Select an existing customer to continue.</p>';
  const upcoming=c.reservations.filter(r=>['reserved','waitlisted'].includes(r.status)&&Date.parse(d.classes.find(x=>x.id===r.classId)?.startsAt)>Date.now()),upcomingIds=new Set(upcoming.map(r=>r.id));
  html+=`<section aria-label="Selected customer"><h2>${e(c.person.name)}</h2>`;
  if(c.can('customers.read'))html+=`<section class="card"><h3>Profile & waiver</h3><p>${c.linked?'Account linked to this participant':'Needs Staff Review — account relationship is unconfirmed or conflicting.'}</p><p>Participant: ${e(c.person.name)}</p><p>${e(c.profile?.profile?.fields?.contactEmail||'Contact email not supplied')} · ${e(c.profile?.profile?.fields?.phone||'Phone not supplied')}</p><p><strong>${e(c.profile?.waiverStatus||'Needs Staff Review — waiver status unavailable')}</strong></p><p>Waivers are accepted by the member in their profile. Staff cannot accept on their behalf.</p></section>`;
  else html+='<p>Assigned-class roster and attendance only.</p>';
  if(c.can('bookings.manage'))html+=`<section class="card"><h3>Passes & credits</h3><p><strong>${e(c.available)} available credits</strong></p>${c.passes.map(p=>`<p>${e(p.label)} · ${e(c.balances.find(b=>b.passId===p.id)?.available??'Unavailable')} available</p>`).join('')||'<p>No passes recorded.</p>'}<button class="button" data-staff-book="${e(c.person.id)}">Book class / join waitlist</button></section>`;
  html+=`<h3>Upcoming bookings</h3><div class="grid">${upcoming.sort((a,b)=>Date.parse(d.classes.find(x=>x.id===a.classId)?.startsAt)-Date.parse(d.classes.find(x=>x.id===b.classId)?.startsAt)).map(r=>booking(r,c,d)).join('')||'<p>No upcoming bookings.</p>'}</div><h3>Recent bookings & attendance</h3><div class="grid">${c.reservations.filter(r=>!upcomingIds.has(r.id)).sort((a,b)=>Date.parse(d.classes.find(x=>x.id===b.classId)?.startsAt)-Date.parse(d.classes.find(x=>x.id===a.classId)?.startsAt)).slice(0,20).map(r=>booking(r,c,d)).join('')||'<p>No recent attendance.</p>'}</div>`;
  if(c.can('sales.manage'))html+=c.customers.length===1?saleHTML():'<section class="card"><h3>Class-pack sale</h3><p>Needs Staff Review — this customer has no unambiguous eligible sale relationship.</p></section>';
  if(c.can('finance.read')||c.can('sales.manage'))html+=`<section class="card"><h3>Purchases & payments</h3>${!c.can('finance.read')?'<p>Your front-desk sale receipts only. Ask a manager for wider financial history.</p>':''}${c.purchases.map(p=>`<p>${e(p.terms?.productName||'Purchase')} · ${e(p.currency||'USD')} ${(p.totalMinor/100).toFixed(2)} · <strong>${e(p.paymentStatus==='succeeded'?(p.fulfillmentStatus==='issued'?'Paid · credits issued':'Needs Staff Review — paid, credits pending'):({pending:'Payment pending',not_started:'Unpaid',failed:'Payment failed',cancelled:'Cancelled'}[p.paymentStatus]||'Needs Staff Review'))}</strong></p>`).join('')||'<p>No visible purchases.</p>'}<details><summary>Purchase details & payment actions</summary>${commerceHTML()}</details></section>`;
  if(c.can('finance.read'))html+=`<section class="card"><h3>Refund status</h3>${c.refunds.map(r=>`<p>${e(r.currency)} ${(r.amountMinor/100).toFixed(2)} · ${e(({pending:'Refund pending',completed:'Refund completed','needs-review':'Needs Staff Review'}[r.status]||r.status))}</p>`).join('')||'<p>No refunds recorded.</p>'}${c.can('refunds.manage')?`<details><summary>Review refund options</summary>${refundHTML()}</details>`:''}</section>`;
  return html+'</section>';
 }
 document.addEventListener('submit',event=>{if(event.target.id!=='desk-search')return;event.preventDefault();query=new FormData(event.target).get('query')||'';render();});
 document.addEventListener('click',async event=>{
  const b=event.target.closest('[data-desk-customer],[data-desk-refresh],[data-desk-attendance]');if(!b)return;
  const before=deskScope(getData());b.disabled=true;
  try{await load();if(deskScope(getData())!==before)return;
   if(b.dataset.deskCustomer)selected=b.dataset.deskCustomer;
   sync();render();
   if(b.dataset.deskAttendance){const c=deskCustomer(getData(),selected);if(c?.reservations.some(r=>r.id===b.dataset.deskAttendance))openAttendance(b.dataset.deskAttendance);}
  }catch(error){notify(error.message);}finally{b.disabled=false;}
 });
 return {render:page,scoped};
}
