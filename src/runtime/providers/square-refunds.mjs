import {digest} from '../../payments.mjs';
import {PAYMENT_BINDING as B,SQUARE_INTEGRATION,squareConfigurationMatches} from './square-configuration.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const refundTransportEnabled=e=>e.VEGA_ENV==='development'&&e.VEGA_EXTERNAL_EFFECTS==='disabled'&&e.VEGA_SANDBOX_REFUND_EXECUTION==='authorized'&&uuid.test(e.VEGA_SANDBOX_REFUND_PURCHASE_ID||'')&&squareConfigurationMatches(e)&&!!e.SQUARE_ACCESS_TOKEN;
export const refundProgramTransportEnabled=e=>e.VEGA_ENV==='development'&&e.VEGA_EXTERNAL_EFFECTS==='disabled'&&e.VEGA_REFUND_PROGRAM_EXECUTION==='authorized'&&/^[a-f0-9-]{36}$/i.test(e.VEGA_REFUND_PROGRAM_PURCHASE_ID??'')&&squareConfigurationMatches(e)&&!!e.SQUARE_ACCESS_TOKEN;
export function createSquareRefundAdapter(env,fetcher=fetch,now=()=>new Date().toISOString()){
 const configured=()=>env.VEGA_ENV==='development'&&squareConfigurationMatches(env)&&!!env.SQUARE_ACCESS_TOKEN;
 const bounded=o=>uuid.test(o.purchaseId||'')&&typeof o.paymentId==='string'&&/^[A-Za-z0-9_-]{1,192}$/.test(o.paymentId)&&typeof o.attemptId==='string'&&!!o.attemptId&&o.tenantId===B.tenantId&&o.businessId===B.businessId&&Number.isSafeInteger(o.amountMinor)&&o.amountMinor>0&&o.currency===B.currency&&digest(o.integrationRef)===digest(SQUARE_INTEGRATION);
 async function request(path,method='GET',body){
  if(!configured())throw Error('Sandbox refund integration unavailable');
  const r=await fetcher(`https://${B.host}${path}`,{method,redirect:'error',headers:{Authorization:`Bearer ${env.SQUARE_ACCESS_TOKEN}`,'Square-Version':'2026-09-16','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Square evidence unavailable');
  const value=await r.json();if(!value||value.errors?.length)throw Error('Square evidence unavailable');return value;
 }
 async function identity(){
  const token=await request('/oauth2/token/status','POST');
  if(token.client_id!==B.applicationId||token.merchant_id!==B.merchantId)throw Error('Sandbox identity mismatch');
  const {location}=await request(`/v2/locations/${B.locationId}`);
  if(location?.merchant_id!==B.merchantId||location?.id!==B.locationId||location?.currency!=='USD'||location?.status!=='ACTIVE')throw Error('Sandbox location mismatch');
 }
 async function all(path,key){
  const rows=[],seen=new Set();let cursor;
  for(let page=0;page<20;page++){
   const r=await request(path+(cursor?`&cursor=${encodeURIComponent(cursor)}`:''));
   if(r[key]!==undefined&&!Array.isArray(r[key]))throw Error('Provider coverage invalid');rows.push(...(r[key]??[]));
   if(!r.cursor)return rows;if(typeof r.cursor!=='string'||seen.has(r.cursor))throw Error('Provider coverage incomplete');seen.add(r.cursor);cursor=r.cursor;
  }
  throw Error('Provider coverage incomplete');
 }
 const binding=o=>({tenantId:o.tenantId,businessId:o.businessId,purchaseId:o.purchaseId,paymentId:o.paymentId,operationId:o.id,amountMinor:o.amountMinor,currency:o.currency,observedAt:now()});
 async function readiness(o){
  if(!bounded(o))throw Error('Unsupported Sandbox purchase');await identity();
  const cutoff=now(),{payment:p}=await request(`/v2/payments/${encodeURIComponent(o.paymentId)}`);
  if(p?.id!==o.paymentId||p.status!=='COMPLETED'||p.location_id!==B.locationId||p.application_details?.application_id!==B.applicationId||p.reference_id!==o.attemptId||p.source_type!=='CARD'||p.amount_money?.amount!==o.amountMinor||p.total_money?.amount!==o.amountMinor||p.amount_money?.currency!==o.currency||p.total_money?.currency!==o.currency||(p.refunded_money?.amount??0)!==0||(p.refund_ids?.length??0)!==0||(p.tip_money?.amount??0)!==0||(p.app_fee_money?.amount??0)!==0||typeof p.version_token!=='string'||!p.version_token||!Number.isFinite(Date.parse(p.created_at)))throw Error('Payment not wholly refundable');
  const refunds=await all(`/v2/refunds?location_id=${B.locationId}&begin_time=${encodeURIComponent(p.created_at)}&end_time=${encodeURIComponent(cutoff)}&limit=100`,'refunds');
  if(refunds.some(r=>r.payment_id===o.paymentId))throw Error('Existing provider refund');
  const disputes=await all(`/v2/disputes?location_id=${B.locationId}`,'disputes');
  if(disputes.some(d=>d.disputed_payment?.payment_id===o.paymentId))throw Error('Conflicting provider dispute');
  // Re-read to detect changes across paginated acquisition. The opaque token is
  // also supplied on submission; it is compared for equality, never ordered.
  const {payment:after}=await request(`/v2/payments/${encodeURIComponent(o.paymentId)}`);
  if(digest(after)!==digest(p))throw Error('Payment changed during readiness');
  return {...binding(o),observedAt:cutoff,providerClear:true,paymentVersion:p.version_token,providerEvidenceDigest:digest({p,refunds,disputes,cutoff}),coverage:{from:p.created_at,through:cutoff,locationId:B.locationId,allRefundStatuses:true,paginationExhausted:true},provider:'square',environment:'sandbox'};
 }
 function normalize(o,r){
  if(!r||!r.id||r.payment_id!==o.paymentId||r.location_id!==B.locationId||r.amount_money?.amount!==o.amountMinor||r.amount_money?.currency!==o.currency||!['PENDING','COMPLETED','FAILED','REJECTED'].includes(r.status)||r.reason!==`Refund ${o.id}: ${o.reason}`||(o.providerRefundId&&r.id!==o.providerRefundId))throw Error('Refund evidence mismatch');
  return {...binding(o),status:r.status.toLowerCase(),refundId:r.id,verified:true,providerEvidenceDigest:digest(r)};
 }
 async function inventory(o){
  // Read-only acquisition is not the submission allowlist. Registered business
  // and integration identity are still required before any provider request.
  if(o.tenantId!==B.tenantId||o.businessId!==B.businessId||digest(o.integrationRef)!==digest(SQUARE_INTEGRATION)||typeof o.paymentId!=='string'||!o.paymentId||typeof o.purchaseId!=='string'||!Number.isSafeInteger(o.amountMinor)||o.amountMinor<=0||o.currency!==B.currency)throw Error('Unsupported Sandbox purchase');
  await identity();
  const cutoff=now(),{payment:p}=await request(`/v2/payments/${encodeURIComponent(o.paymentId)}`);
  if(p?.id!==o.paymentId||p.location_id!==B.locationId||p.application_details?.application_id!==B.applicationId||p.reference_id!==o.attemptId||p.source_type!=='CARD'||p.amount_money?.amount!==o.amountMinor||p.total_money?.amount!==o.amountMinor||p.amount_money?.currency!==o.currency||p.total_money?.currency!==o.currency||(p.tip_money?.amount??0)!==0||(p.app_fee_money?.amount??0)!==0||!p.version_token||!Number.isFinite(Date.parse(p.created_at))||Date.parse(p.created_at)>Date.parse(cutoff))throw Error('Payment binding mismatch');
  const allRows=await all(`/v2/refunds?location_id=${B.locationId}&begin_time=${encodeURIComponent(p.created_at)}&end_time=${encodeURIComponent(cutoff)}&limit=100`,'refunds');
  const rows=allRows.filter(r=>r?.payment_id===o.paymentId);
  if(rows.some(r=>r.location_id!==B.locationId||r.destination_type&&r.destination_type!=='CARD'))throw Error('Unsupported refund destination');
  const disputes=(await all(`/v2/disputes?location_id=${B.locationId}`,'disputes')).filter(d=>d?.disputed_payment?.payment_id===o.paymentId);
  const {payment:after}=await request(`/v2/payments/${encodeURIComponent(o.paymentId)}`);
  if(digest(after)!==digest(p))throw Error('Payment changed during acquisition');
  return {contract:'refund-provider-inventory/1',tenantId:o.tenantId,businessId:o.businessId,purchaseId:o.purchaseId,paymentId:o.paymentId,integrationDigest:digest(o.integrationRef),cutoff,observedAt:now(),
   payment:{id:p.id,status:p.status,amountMinor:p.amount_money.amount,currency:p.amount_money.currency,version:p.version_token,refundedMinor:p.refunded_money?.amount??0,refundIds:p.refund_ids??[]},
   refunds:rows.map(r=>({id:r.id,paymentId:r.payment_id,status:r.status?.toLowerCase(),amountMinor:r.amount_money?.amount,currency:r.amount_money?.currency,reason:r.reason??'',createdAt:r.created_at,updatedAt:r.updated_at})),
   disputes:disputes.map(d=>({id:d.id,state:d.state})),remainingOperationCapacity:Math.max(0,20-rows.length),coverage:{from:p.created_at,paginationExhausted:true,allRefundStatuses:true,paymentStable:true},provider:'square',environment:'sandbox'};
 }
 const programBound=o=>o.contract==='refund-program/1'&&o.origin!=='external'&&o.tenantId===B.tenantId&&o.businessId===B.businessId&&digest(o.integrationRef)===digest(SQUARE_INTEGRATION)&&Number.isSafeInteger(o.amountMinor)&&o.amountMinor>0&&o.amountMinor<=o.paymentAmountMinor&&o.currency===B.currency&&typeof o.paymentId==='string'&&o.paymentId&&o.providerKey===o.id;
 function programNormalize(o,r){
  if(!r?.id||r.payment_id!==o.paymentId||r.location_id!==B.locationId||r.amount_money?.amount!==o.amountMinor||r.amount_money?.currency!==o.currency||!['PENDING','COMPLETED','FAILED','REJECTED'].includes(r.status)||r.reason!==`Refund ${o.id}: ${o.reason}`||(o.providerRefundId&&o.providerRefundId!==r.id))throw Error('Refund evidence mismatch');
  return {...binding(o),status:r.status.toLowerCase(),refundId:r.id,verified:true,providerEvidenceDigest:digest(r)};
 }
 return {readiness,inventory,async submitProgram(o){
  if(!refundProgramTransportEnabled(env)||env.VEGA_REFUND_PROGRAM_PURCHASE_ID!==o.purchaseId||!programBound(o)||o.status!=='dispatching'||!o.paymentVersion)throw Error('Refund program execution disabled');
  try{await identity();const r=await request('/v2/refunds','POST',{idempotency_key:o.providerKey,payment_id:o.paymentId,amount_money:{amount:o.amountMinor,currency:o.currency},payment_version_token:o.paymentVersion,reason:`Refund ${o.id}: ${o.reason}`});return programNormalize(o,r.refund);}catch{return {...binding(o),status:'unknown'};}
 },async inspectProgram(o){
  if(!programBound(o))throw Error('Unsupported refund operation');
  if(!o.providerRefundId)return {...binding(o),status:'unknown'};
  try{await identity();return programNormalize(o,(await request(`/v2/refunds/${encodeURIComponent(o.providerRefundId)}`)).refund);}catch{return {...binding(o),status:'unknown'};}
 },async submit(o){
  if(!refundTransportEnabled(env)||env.VEGA_SANDBOX_REFUND_PURCHASE_ID!==o.purchaseId||!bounded(o)||o.providerKey!==o.id||o.status!=='dispatching'||!o.paymentVersion)throw Error('Refund execution disabled');
  try{await identity();const r=await request('/v2/refunds','POST',{idempotency_key:o.providerKey,payment_id:o.paymentId,amount_money:{amount:o.amountMinor,currency:o.currency},payment_version_token:o.paymentVersion,reason:`Refund ${o.id}: ${o.reason}`});return normalize(o,r.refund);}
  catch{return {...binding(o),status:'unknown'};}
 },async inspect(o){
  if(!bounded(o))throw Error('Unsupported Sandbox purchase');
  // A lost response with no refund ID is not interpreted as proof of absence.
  if(!o.providerRefundId)return {...binding(o),status:'unknown'};
  try{await identity();return normalize(o,(await request(`/v2/refunds/${encodeURIComponent(o.providerRefundId)}`)).refund);}
  catch{return {...binding(o),status:'unknown'};}
 }};
}
