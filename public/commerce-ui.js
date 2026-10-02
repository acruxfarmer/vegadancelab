import {paymentStatusHTML} from './payment-status.js';
export function commerceUI({escape:e,getData,mutate,notify}) {
 const money = n => `USD $${(n / 100).toFixed(2)}`;
 function terms(o) { return `<p>${e(o.productName)} · ${e(o.quantity)} credits · ${e(o.validDays)} days after confirmed payment</p><p>Eligible classes: ${e(o.categories.join(', '))}</p><p><strong>${money(o.priceMinor)} — ${e(o.priceLabel)}</strong></p><p>Oregon Development: non-taxable · Transaction tax: USD $0.00</p><p>Refund policy: staff-approved full refunds for wholly unused packs with no active reservations, requested within 30 days of confirmed payment / successful purchase completion. Partial and used-pack refunds are deferred.</p>`; }
 return {
  render() {
   const d=getData(), staff=d.context.role==='staff', offers=d.commerceOffers||[], drafts=d.purchaseDrafts||[];
   const note=d.paymentExecution?.enabled?'Sandbox test payments are available only for the designated purchase.':'Payments are unavailable.';
   return `<section class="card" aria-label="Development purchase drafts"><h2>Development class-pack purchases</h2><p>${note} Creating an unpaid draft issues no credits; its validity and refund clocks have not started.</p>${offers.map(o=>`<article>${terms(o)}${!staff&&d.commerceSelfParticipantId?`<form id="commerce-draft"><input type="hidden" name="offerId" value="${e(o.id)}"><button class="button">Create unpaid draft${drafts.length?' — another purchase':''}</button><p role="alert"></p></form>`:staff?'<p>Staff status view only.</p>':'<p>Self-purchase is unavailable for this account.</p>'}</article>`).join('')||'<p>The approved Development offer is unavailable in this workspace.</p>'}<h3>${staff?'Studio purchase drafts':'Your purchase drafts'}</h3>${drafts.map(p=>`<details><summary>${e(p.terms.productName)} · ${money(p.totalMinor)} · ${p.paymentStatus==='succeeded'?'Paid purchase':'Unpaid draft'}</summary><p>Draft: ${e(p.id)}</p><p>Created: ${e(p.createdAt)}</p>${staff?`<p>Buyer: ${e(p.buyerId)} · Participant: ${e(p.participantId)}</p>`:''}${terms(p.terms)}<p>Total: ${money(p.totalMinor)}</p>${paymentStatusHTML(p,e,staff,d.paymentExecution)}</details>`).join('')||'<p>No purchase drafts yet.</p>'}</section>`;
  },
  async submitPayment(form){
   if(form.dataset.pending)return;
   form.dataset.pending='true';const button=form.querySelector('button');button.disabled=true;
   try{const body={purchaseId:form.dataset.purchase};if(form.dataset.attempt)body.attemptId=form.dataset.attempt;
    await mutate(body.attemptId?'/api/commerce/payments/resume':'/api/commerce/payments',body,()=>{throw new Error('Sandbox payment requires an authenticated account');});
    notify('Payment status refreshed. Check payment and credit issuance separately.');
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
