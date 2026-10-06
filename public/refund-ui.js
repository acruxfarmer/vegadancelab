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

export function refundProgramUI({getData,escape:e,api,mutate,notify}){
 const money=(n,c)=>`${e(c)} ${(n/100).toFixed(2)}`;
 const when=value=>Number.isFinite(Date.parse(value))?e(new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})):'unavailable';
 const messages={NO_REFUNDABLE_CREDITS:'No refundable credits remain.',REFUND_CUTOFF_REACHED:'The refund deadline has passed.',ACTIVE_OR_UNRESOLVED_RESERVATION:'Resolve the active booking through the cancellation flow first.',REFUND_ALREADY_ACTIVE:'Finish reviewing the existing refund first.',PROVIDER_PENDING:'The payment provider is still processing a refund. Keep the affected credits on hold.',OWNED_INTENT_PENDING:'A refund is already being prepared.',UNMATCHED_EXTERNAL_REFUND:'A refund was recorded outside Vega. Review it before making another refund.',EXTERNAL_DISPOSITION_REQUIRED:'Review which credits belong to the external refund.',PROVIDER_EVIDENCE_STALE:'Refresh the refund check before continuing.'};
 const reasons=values=>[...new Set((values??[]).map(value=>messages[value]??'Needs Staff Review. The available records do not support an automatic refund decision.'))].map(e).join(' ');
 const status=value=>e({'needs-review':'Needs Staff Review',pending:'Pending',completed:'Completed',failed:'Failed',rejected:'Rejected',reconciled:'Matched',ready:'Ready',blocked:'Not eligible'}[value]??'Needs Staff Review');
 const labels={'refund-intent':'Credits held for refund','refund-dispatch':'Refund submitted','refund-observation':'Refund status checked','refund-hold-released':'Credits released after confirmed failure','refund-external-recorded':'External refund recorded for review','refund-provider-bound':'Recovery match reviewed'};
 const form=(p,action,label,op='',extra='',disabled=false)=>`<form data-refund-program="${action}" data-purchase="${e(p)}" data-operation="${e(op)}">${extra}<button ${disabled?'disabled':''}>${label}</button><p role="alert"></p></form>`;
 const history=rows=>rows.map(o=>`<article class="card"><h3>${money(o.amountMinor,o.currency)} · ${status(o.status)}</h3><p>Credits: ${e(o.entitlementDisposition)}.</p><ul>${o.history.map(h=>`<li>${e(labels[h.event]??'Refund update')} · ${when(h.at)}${h.status?` · ${status(h.status)}`:''}</li>`).join('')}</ul></article>`).join('');
 return {render(){
  const d=getData(),rows=d.refundHistory??[];
  if(d.context?.role!=='staff')return rows.length?`<section aria-label="Your refund history"><h2>Your refunds</h2>${history(rows)}<p>Pending or uncertain outcomes keep affected credits unavailable. Contact the studio about a refund needing review.</p></section>`:'';
  const purchases=(d.purchaseDrafts??[]).filter(p=>p.paymentStatus==='succeeded');
  return `<section aria-label="Refund management"><h2>Refund management</h2><p>${d.refundProgram?.enabled?'Designated Sandbox execution only.':'Refund execution is disabled.'} Checks and reviewed recovery never submit another refund.</p>${purchases.map(p=>`<section class="card" data-refund-purchase="${e(p.id)}"><h3>${money(p.totalMinor,p.currency)} purchase</h3><p>${e(p.id)}</p>${history(rows.filter(o=>o.purchaseId===p.id))}${form(p.id,'preview','Check refund readiness and Square history')}<div data-refund-preview></div>${rows.filter(o=>o.purchaseId===p.id&&o.contract==='refund-program/1').map(o=>{
   if(o.origin==='external'&&o.status==='needs-review')return form(p.id,'preview','Review external refund allocation',o.id);
   if(o.recoveryAction==='bind')return form(p.id,'bind','Review possible refund match',o.id);
   if(['pending','needs-review'].includes(o.status))return o.history.some(h=>h.event==='refund-dispatch')?form(p.id,'reconcile','Check refund status',o.id):form(p.id,'execute','Submit this refund once',o.id,'',!(d.refundProgram?.enabled&&d.refundProgram.purchaseId===p.id));
   if(['failed','rejected'].includes(o.status)&&o.entitlementDisposition==='held')return form(p.id,'release','Confirm failure and release credits',o.id);
   return '';
  }).join('')}</section>`).join('')}</section>`;
 },async submit(f){
  if(f.dataset.pending)return;f.dataset.pending='true';const button=f.querySelector('button');button.disabled=true;
  const d=getData(),p=f.dataset.purchase,op=f.dataset.operation,action=f.dataset.refundProgram;
  try{
   if(action==='preview'){
    const r=await api(`/api/commerce/purchases/${encodeURIComponent(p)}/refund-reconciliation${op?`?operationId=${encodeURIComponent(op)}`:''}`);
    if(getData()!==d||!f.isConnected)return;
    const target=f.closest('[data-refund-purchase]').querySelector('[data-refund-preview]');
    const choices=(r.business?.units??[]).map((u,i)=>`<label><input type="checkbox" name="unitIds" value="${e(u.unitId)}"> Credit ${i+1}${u.restored?' (restored; history retained)':''} · ${money(u.amountMinor,r.currency)}</label>`).join('');
    target.innerHTML=`<p>Square comparison: ${status(r.status)}. Completed: ${r.completedMinor===null?'unverified':money(r.completedMinor,r.currency)}. Pending: ${r.pendingMinor===null?'unverified':money(r.pendingMinor,r.currency)}.</p><p>Checked through ${when(r.cutoff)}. ${reasons(r.reasonCodes)}</p><p>Refund eligibility: ${status(r.business?.status)}. ${reasons(r.business?.reasonCodes)}</p>${!op&&r.externalCount?form(p,'external','Record external refunds and hold affected rights'):''}${op?form(p,'resolve','Confirm reviewed credit outcome',op,choices):r.business?.status==='ready'&&r.status==='reconciled'?form(p,'prepare','Hold selected credits for refund','',`${choices}<label>Reason <input name="reason" required maxlength="120"></label>`,!(d.refundProgram?.enabled&&d.refundProgram.purchaseId===p)):''}<p>No automatic retry. A payment refund does not determine which credits to retire without business review.</p>`;
    return;
   }
   const fields=new FormData(f),body={purchaseId:p};if(op)body.operationId=op;
   if(['prepare','resolve'].includes(action))body.unitIds=fields.getAll('unitIds');
   if(fields.get('reason'))body.reason=fields.get('reason');
   await mutate(`/api/commerce/refund-program/${action}`,body,()=>{throw Error('Authenticated staff required');});
   notify('Refund record updated. Review its status and affected credits.');
  }catch(error){if(f.isConnected)f.querySelector('[role="alert"]').textContent=/^[A-Z][A-Z0-9_]*(, [A-Z][A-Z0-9_]*)*$/.test(error.message)?reasons(error.message.split(', ')):'Needs Staff Review. The action could not be confirmed. Check the current refund status before taking another action.';}finally{delete f.dataset.pending;button.disabled=false;}
 }};
}

