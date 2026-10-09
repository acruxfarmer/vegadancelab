import {rentalTerms,rentalStatus} from './rental-ui.js';
import {paymentStatusHTML} from './payment-status.js';
const mediaReturnLink=(p,e)=>p.fulfillmentStatus==='issued'&&p.terms.fulfillmentPlan?.actions?.[0]?.target?.kind==='media_placement'?`<a class="button" href="/watch.html?placement=${encodeURIComponent(p.terms.fulfillmentPlan.actions[0].target.id)}">Open media</a>`:'';
export function commerceUI({escape:e,getData,mutate,notify}) {
 const money = (n,currency='USD') => `${currency} ${new Intl.NumberFormat('en-US',{style:'currency',currency}).format(n/100)}`;
 function terms(o) {
  if(o.fulfillmentPlan?.actions?.some(a=>a.type==='DURABLE_ACCESS'))return `<p>${e(o.productName)} · Viewing access</p><p><strong>${e(money(o.priceMinor,o.currency))}</strong></p>${o.rentalPolicy?rentalTerms(o.rentalPolicy,e):'<p>Viewing does not consume your access. Purchase does not transfer ownership.</p>'}<p>Full refunds require staff approval within ${e(o.refundPolicy.requestWithinDays)} days of confirmed payment. A completed full refund revokes access.</p>`;
  return `<p>${e(o.productName)} · ${e(o.quantity)} credits · ${e(o.validDays)} days after confirmed payment</p><p>Eligible classes: ${e(o.categories.join(', '))}</p><p><strong>${money(o.priceMinor,o.currency)} — ${e(o.priceLabel)}</strong></p><p>Oregon Development: non-taxable · Transaction tax: USD $0.00</p><p>Original offer refund terms: staff-approved full refunds for wholly unused packs with no active reservations, within 30 days of confirmed payment / successful purchase completion. These frozen terms remain on the purchase.</p><p>The additional approved staff refund policy permits whole unused credits at their original allocated value, including proven restored credits. Consumed value is not refundable. Requests must be strictly before the frozen cutoff; reservations must be resolved first. Unsupported cases require staff review.</p>`; }
 return {
  render() {
   const d=getData(), staff=d.context.role==='staff', offers=d.commerceOffers||[], drafts=d.purchaseDrafts||[];
   if(staff&&d.staffAccess&&!d.staffAccess.permissions.some(p=>['finance.read','sales.manage'].includes(p)))return '';
   const note=d.paymentExecution?.enabled?'Sandbox test payments are available only for the designated purchase.':'Payments are unavailable.';
   return `<section class="card" aria-label="Development purchase drafts"><h2>Development purchases</h2><p>${note} Creating an unpaid draft grants no access or credits; its validity and refund clocks have not started.</p>${offers.map(o=>`<article>${terms(o)}${!staff&&d.commerceSelfParticipantId?`<form id="commerce-draft"><input type="hidden" name="offerId" value="${e(o.id)}"><button class="button">Create unpaid draft${drafts.length?' — another purchase':''}</button><p role="alert"></p></form>`:staff?'<p>Staff status view only.</p>':'<p>Self-purchase is unavailable for this account.</p>'}</article>`).join('')||'<p>The approved Development offer is unavailable in this workspace.</p>'}<h3>${staff?'Studio purchase drafts':'Your purchase drafts'}</h3>${drafts.map(p=>`<details><summary>${e(p.terms.productName)} · ${money(p.totalMinor,p.currency)} · ${p.paymentStatus==='succeeded'?'Paid purchase':'Unpaid draft'}</summary><p>Draft: ${e(p.id)}</p><p>Created: ${e(p.createdAt)}</p>${p.saleChannel==='front_desk'?`<p>Front-desk sale · Customer: ${e(d.participants?.find(c=>c.id===p.participantId)?.name||p.participantId)}${staff?` · Recorded by staff: ${e(p.createdByStaffId)}`:''}</p>`:''}${staff?`<p>Buyer: ${e(p.buyerId)} · Participant: ${e(p.participantId)}</p>`:''}${terms(p.terms)}${rentalStatus(p.rental||(d.rentals||[]).find(r=>r.purchaseId===p.id),e)}<p>Total: ${money(p.totalMinor,p.currency)}</p>${mediaReturnLink(p,e)}${paymentStatusHTML(p,e,staff,d.paymentExecution)}</details>`).join('')||'<p>No purchase drafts yet.</p>'}</section>`;
  },
  async submitPayment(form){
   if(form.dataset.pending)return;
   form.dataset.pending='true';const button=form.querySelector('button');button.disabled=true;
   try{const body={purchaseId:form.dataset.purchase};if(form.dataset.attempt)body.attemptId=form.dataset.attempt;
    await mutate(body.attemptId?'/api/commerce/payments/resume':'/api/commerce/payments',body,()=>{throw new Error('Sandbox payment requires an authenticated account');});
    notify('Payment status refreshed. Check payment and fulfillment separately.');
   }catch(error){form.querySelector('[role="alert"]').textContent=error.message;}
   finally{delete form.dataset.pending;button.disabled=false;}
  },
  async submit(form) {
   if(form.dataset.pending)return;
   form.dataset.pending='true';const button=form.querySelector('button');button.disabled=true;
   try { await mutate('/api/commerce/drafts',{offerId:new FormData(form).get('offerId')},()=>{});notify('Unpaid draft saved. No credits issued.'); }
   catch(error){form.querySelector('[role="alert"]').textContent=error.message;}
   finally{delete form.dataset.pending;button.disabled=false;}
  }
 };
}
