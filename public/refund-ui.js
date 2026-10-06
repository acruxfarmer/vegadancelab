export function refundUI({getData,escape:e,mutate,notify}){
 return {render(){
  const d=getData();if(d.context.role!=='staff')return '';
  const p=d.purchaseDrafts?.find(p=>p.id===d.refundWorkflow?.purchaseId);if(!p)return '';
  const op=d.refundOperations?.find(o=>o.purchaseId===p.id),enabled=d.refundWorkflow?.enabled===true;
  const form=(action,label,reason=false)=>`<form data-refund-action="${action}" data-purchase="${e(p.id)}" data-operation="${e(op?.id??'')}">${reason?'<label>Reason <input name="reason" required maxlength="120"></label>':''}<button ${enabled?'':'disabled'}>${label}</button><p role="alert"></p></form>`;
  return `<section class="card" aria-label="Staff refund"><h2>Full refund</h2><p>${e(p.currency)} ${(p.totalMinor/100).toFixed(2)} · ${e(p.id)}</p>${!enabled?'<p>Refund execution is disabled.</p>':''}<p>${op?`Status: ${e(op.status)}. `:''}Pending or uncertain refunds keep the associated credits unavailable. A confirmed refund permanently retires them.</p>${!op?form('prepare','Check readiness and hold credits',true):op.status==='intent'?form('execute','Confirm full Sandbox refund'):['dispatching','unknown','pending'].includes(op.status)?form('reconcile','Check provider outcome — no resubmission'):['failed','rejected'].includes(op.status)?form('release','Confirm failure and release credits'):'<p>No further submission is available for this operation.</p>'}</section>`;
 },async submit(form){
  if(form.dataset.pending)return;form.dataset.pending='true';const button=form.querySelector('button');button.disabled=true;
  try{const body={purchaseId:form.dataset.purchase};if(form.dataset.operation)body.operationId=form.dataset.operation;const reason=new FormData(form).get('reason');if(reason)body.reason=reason;
   await mutate(`/api/commerce/refunds/${form.dataset.refundAction}`,body,()=>{throw Error('Authenticated staff required');});notify('Refund state recorded. Review the displayed outcome and recovery status.');
  }catch(error){form.querySelector('[role="alert"]').textContent=error.message;}finally{delete form.dataset.pending;button.disabled=false;}
 }};
}
