export function paymentStatusHTML(d,e,staff,execution){
 const labels={not_started:'not started',pending:'pending',unresolved:'unresolved — do not start another payment',succeeded:'paid',failed:'failed',cancelled:'cancelled'};
 const payment=d.paymentSummary?.reason==='prepared_execution_disabled'?'attempt prepared — payment execution disabled':labels[d.paymentStatus]||'unavailable';
 const fulfillment=d.fulfillmentStatus==='issued'?'credits issued':d.paymentStatus==='succeeded'?'Paid — credits pending':'not issued';
 const canAct=!staff&&execution?.enabled&&execution.purchaseId===d.id&&d.fulfillmentStatus!=='issued';
 const retry=d.activeAttemptId&&!['failed','cancelled'].includes(d.paymentStatus);
 return `<p>Payment: ${e(payment)} · Fulfillment: ${e(fulfillment)}</p><p>Validity start: ${e(d.validFrom||'not started')} · Expiration: ${e(d.expiresAt||'not set')} · Refund window: ${e(d.refundWindowStartsAt||'not started')}</p>${d.activeAttemptId?`<p>Payment reference: ${e(d.activeAttemptId)}</p>`:''}${staff&&d.paymentSummary?`<p>Processor transaction: ${e(d.paymentSummary.paymentId||'not yet confirmed')} · Status detail: ${e(d.paymentSummary.reason||'awaiting provider')}</p>`:''}${canAct?`<form data-commerce-payment data-purchase="${e(d.id)}" data-attempt="${retry?e(d.activeAttemptId):''}"><button class="button">${retry?'Check existing payment':'Pay USD $60.00 with configured Sandbox test card'}</button><p role="alert"></p></form>`:''}`;
}
