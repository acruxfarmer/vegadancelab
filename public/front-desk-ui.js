export function frontDeskUI({getData,escape:e,modal,mutate,notify,close}){
 const money=o=>new Intl.NumberFormat('en-US',{style:'currency',currency:o.currency}).format((o.priceMinor+o.tax.amountMinor)/100);
 function terms(o){return `<p>${e(o.productName)} · ${e(o.quantity)} credits</p><p><strong>${e(money(o))}</strong> · ${e(o.priceLabel)}</p><p>Tax: ${e(o.tax.treatment)} · ${e(o.tax.jurisdiction)}</p><p>Valid for ${e(o.validDays)} days from confirmed payment. Eligible classes: ${e(o.categories.join(', ')||'See product terms')}.</p><p>Frozen offer refund terms: staff-approved full refund for wholly unused credits with no active reservations, within ${e(o.refundPolicy.requestWithinDays)} days of confirmed payment. Existing approved whole-credit refund policy remains available through staff refund review.</p>`;}
 return {
  render(){
   const d=getData(),f=d.frontDesk;
   if(d.context.role!=='staff'||!f)return '';
   return `<section class="card" aria-label="Staff-assisted front-desk sale"><h2>Front-desk sale</h2><p>Existing customer · Class pack · Development / Sandbox</p><p>Select a customer and review the offer. Saving an unpaid sale creates no credits or booking. Payment and fulfillment are tracked separately.</p>${f.customers.length&&f.offers.length?`<form id="front-desk-select"><label class="field">Customer<select name="customerId" required><option value="">Select existing customer</option>${f.customers.map(c=>`<option value="${e(c.id)}">${e(c.name)} · ${e(c.participantId)}</option>`).join('')}</select></label><label class="field">Class pack<select name="offerId" required><option value="">Select eligible class pack</option>${f.offers.map(o=>`<option value="${e(o.id)}">${e(o.productName)} · ${e(money(o))}</option>`).join('')}</select></label><button class="button">Review sale</button><p role="alert"></p></form>`:'<p>No eligible customer and offer combination is available.</p>'}<p>This workflow uses the configured Sandbox test payment source. Physical card terminals are not supported. ${d.paymentExecution?.enabled?'Only the designated sale can be paid.':'Payment execution is disabled; saved sales remain unpaid.'}</p></section>`;
  },
  review(form){
   const data=new FormData(form),f=getData().frontDesk;
   const customer=f?.customers.find(c=>c.id===data.get('customerId')),offer=f?.offers.find(o=>o.id===data.get('offerId'));
   if(!customer||!offer){form.querySelector('[role="alert"]').textContent='Select an eligible customer and class pack.';return;}
   modal(`<h2>Review front-desk sale</h2><p>Customer / recipient: <strong>${e(customer.name)}</strong> · ${e(customer.participantId)}</p>${terms(offer)}<p>Staff records this sale for the customer. No member sign-in or impersonation is used.</p><form id="front-desk-confirm"><input type="hidden" name="customerId" value="${e(customer.id)}"><input type="hidden" name="offerId" value="${e(offer.id)}"><input type="hidden" name="offerVersion" value="${e(offer.version)}"><button class="button">Save unpaid sale · payment next</button><p role="alert"></p></form>`);
  },
  async submit(form){
   if(form.dataset.pending)return;
   form.dataset.pending='true';form.querySelector('button').disabled=true;
   try{
    const f=new FormData(form);
    await mutate('/api/commerce/front-desk/sales',{customerId:f.get('customerId'),offerId:f.get('offerId'),offerVersion:Number(f.get('offerVersion'))},()=>{throw Error('An authenticated staff account is required');});
    close();notify('Sale saved unpaid. Open its purchase history to continue or check payment. No credits issued yet.');
   }catch(error){form.querySelector('[role="alert"]').textContent=error.message;}
   finally{delete form.dataset.pending;form.querySelector('button').disabled=false;}
  }
 };
}
