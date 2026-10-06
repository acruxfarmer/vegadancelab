import {reportDay,reportWeek} from './attendance-report.js';
export function financialReportAllowed(d){const c=d?.context,a=d?.staffAccess;return c?.role==='staff'&&a?.permissions?.includes('finance.read')&&['tenantId','businessId','userId'].every(k=>!!c[k]&&c[k]===a[k]);}
const amount=v=>Number.isSafeInteger(v)&&v>=0;
const currency=v=>typeof v==='string'&&/^[A-Z]{3}$/.test(v);
const validDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const sum=(rows,key)=>{const values=rows.map(r=>r[key]);const n=values.reduce((a,b)=>a+(b??0),0);return values.includes(null)||!Number.isSafeInteger(n)?null:n;};
const channel=p=>p.saleChannel==='front_desk'?'Staff-assisted':p.saleChannel==='member_self'?'Member self-purchase':'Not recorded';
const counts=(rows,key)=>Object.entries(rows.reduce((a,r)=>(a[r[key]||'unavailable']=(a[r[key]||'unavailable']||0)+1,a),{})).map(([status,count])=>({status,count}));
function total(events){const sales=events.filter(e=>e.kind==='sale'),refunds=events.filter(e=>e.kind==='refund'),gross=sum(sales,'amount'),refunded=sum(refunds,'amount');return {gross,refunded,net:gross===null||refunded===null?null:gross-refunded,saleCount:sales.length,refundCount:refunds.length};}
// All inputs are the existing server-authorized commerce projection. No business writes.
export function financialReport(d,{from='',to='',group='day',timeZone='UTC'}={}){
 if(!financialReportAllowed(d))return {error:'Your staff role does not allow financial reporting. Ask your business owner for help.'};
 if((from&&!validDay(from))||(to&&!validDay(to))||(from&&to&&from>to))return {error:'Choose a valid date range with the start on or before the end.'};
 const scoped=r=>['tenantId','businessId'].every(k=>r[k]===undefined||r[k]===d.context[k]);
 const inRange=day=>day?(!from||day>=from)&&(!to||day<=to):!from&&!to;
 const source=(d.purchaseDrafts||[]).filter(scoped),history=(d.refundHistory||[]).filter(scoped),ops=(d.refundOperations||[]).filter(scoped);
 for(const op of ops)if(!history.some(r=>r.id===op.id))history.push({...op,history:[]});
 const duplicate=(rows,key,value)=>rows.filter(r=>r[key]===value).length!==1;
 const exceptions=[],events=[],purchases=[],refunds=[];
 const note=(kind,id,reason)=>exceptions.push({kind,id,reason});
 const purchaseMap=new Map(source.map(p=>[p.id,p]));
 for(const p of source){
  const issues=[];if(!p.id||duplicate(source,'id',p.id))issues.push('Conflicting purchase records');
  if(!amount(p.totalMinor)||!currency(p.currency))issues.push('Purchase amount unavailable');
  if(p.paymentSummary&&p.paymentSummary.status!==p.paymentStatus)issues.push('Payment records disagree');
  const createdDay=reportDay(p.createdAt,timeZone),paidDay=reportDay(p.paymentConfirmedAt,timeZone);
  if(!createdDay)issues.push('Purchase date unavailable');
  if(p.paymentStatus==='succeeded'&&!paidDay)issues.push('Payment confirmation date unavailable');
  const row={id:p.id,product:p.terms?.productName||'Product unavailable',offerId:p.offerId||'unavailable',offerVersion:p.offerVersion??'unavailable',currency:currency(p.currency)?p.currency:'Unavailable',original:amount(p.totalMinor)?p.totalMinor:null,createdDay,paidDay,payment:p.paymentStatus||'unavailable',fulfillment:p.fulfillmentStatus||'unavailable',channel:channel(p),issues};
  purchases.push(row);
  if(p.paymentStatus==='succeeded')events.push({...row,kind:'sale',day:paidDay,amount:issues.length?null:p.totalMinor});
  if(['pending','unresolved'].includes(p.paymentStatus))issues.push(p.paymentStatus==='pending'?'Payment pending':'Payment unresolved');
  if(!['not_started','pending','unresolved','succeeded','failed','cancelled'].includes(p.paymentStatus))issues.push('Payment status unavailable');
  if(p.paymentStatus==='succeeded'&&p.fulfillmentStatus!=='issued')issues.push('Paid purchase awaiting fulfillment review');
 }
 for(const r of history){
  const p=purchaseMap.get(r.purchaseId),pr=purchases.find(x=>x.id===r.purchaseId),issues=[];
  const op=ops.filter(o=>o.id===r.id),provider=op[0]?.providerRefundId;
  if(!r.id||duplicate(history,'id',r.id)||op.length>1||provider&&ops.filter(o=>o.providerRefundId===provider).length>1)issues.push('Conflicting refund records');
  if(op.length===1&&((op[0].status==='completed')!==(r.status==='completed')))issues.push('Refund records disagree');
  if(!p)issues.push('Refund has no matching purchase');
  if(!amount(r.amountMinor)||!currency(r.currency)||p&&r.currency!==p.currency)issues.push('Refund amount or currency unavailable');
  if(r.status==='completed'&&p?.paymentStatus!=='succeeded')issues.push('Refund and payment records disagree');
  const completion=(r.history||[]).filter(h=>h.event==='refund-observation'&&h.status==='completed').map(h=>h.at).filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
  const completedDay=reportDay(completion,timeZone),createdDay=reportDay(r.createdAt,timeZone);
  if(!createdDay)issues.push('Refund creation date unavailable');
  if(r.status==='completed'&&!completedDay)issues.push('Refund completion date unavailable');
  const row={id:r.id,purchaseId:r.purchaseId,product:pr?.product||'Unmatched purchase',offerId:pr?.offerId||'unavailable',offerVersion:pr?.offerVersion||'unavailable',currency:currency(r.currency)?r.currency:'Unavailable',channel:pr?.channel||'Not recorded',status:r.status||'unavailable',createdDay,completedDay,amount:amount(r.amountMinor)?r.amountMinor:null,issues};refunds.push(row);
  if(r.status==='completed')events.push({...row,kind:'refund',day:completedDay,amount:issues.length?null:r.amountMinor});
  if(['pending','needs-review'].includes(r.status))issues.push(r.status==='pending'?'Refund pending':'Refund needs staff review');
  if(!['completed','pending','needs-review','failed','rejected'].includes(r.status))issues.push('Refund status unavailable');
 }
 // Conflicting over-refunds invalidate net figures rather than inventing a cap.
 for(const p of purchases){const rs=refunds.filter(r=>r.purchaseId===p.id&&r.status==='completed'),n=sum(rs,'amount');if(n!==null&&p.original!==null&&n>p.original){p.issues.push('Completed refunds exceed original purchase');for(const e of events.filter(e=>e.purchaseId===p.id&&e.kind==='refund'))e.amount=null;}}
 const missingDates=events.filter(e=>!e.day).length;
 const selected=events.filter(e=>inRange(e.day));
 const visiblePurchases=purchases.filter(p=>inRange(p.createdDay)||inRange(p.paidDay)&&p.payment==='succeeded'||selected.some(e=>e.purchaseId===p.id));
 const visibleRefunds=refunds.filter(r=>inRange(r.createdDay)||r.status==='completed'&&inRange(r.completedDay));
 for(const p of visiblePurchases)for(const reason of p.issues)note('Purchase',p.id,reason);
 for(const r of visibleRefunds)for(const reason of r.issues)note('Refund',r.id,reason);
 const grouped=(keyFn)=>{const m=new Map();for(const e of selected){const k=keyFn(e);if(!m.has(k))m.set(k,[]);m.get(k).push(e);}return [...m.values()].map(es=>({...total(es),currency:es[0].currency,product:es[0].product,offerId:es[0].offerId,offerVersion:es[0].offerVersion,channel:es[0].channel,period:es[0].day?(group==='week'?reportWeek(es[0].day):es[0].day):'Date unavailable'}));};
 const currencies=grouped(e=>e.currency).map(r=>({...r,complete:missingDates===0&&!d.recovery?.pendingCount}));
 return {error:'',currencies,products:grouped(e=>JSON.stringify([e.currency,e.offerId,e.offerVersion])),channels:grouped(e=>JSON.stringify([e.currency,e.channel])),trends:grouped(e=>JSON.stringify([e.currency,e.day?(group==='week'?reportWeek(e.day):e.day):'unavailable'])).sort((a,b)=>a.period.localeCompare(b.period)),purchases:visiblePurchases,refunds:visibleRefunds,paymentStatuses:counts(visiblePurchases,'payment'),refundStatuses:counts(visibleRefunds,'status'),purchaseCount:purchases.filter(p=>inRange(p.createdDay)).length,exceptions,needsReviewCount:new Set(exceptions.map(e=>e.kind+e.id)).size,pendingPayments:visiblePurchases.filter(p=>p.payment==='pending').length,unresolvedPayments:visiblePurchases.filter(p=>p.payment==='unresolved').length,pendingRefunds:visibleRefunds.filter(r=>r.status==='pending').length,missingDates,group,from,to,recoveryPending:d.recovery?.pendingCount||0};
}
