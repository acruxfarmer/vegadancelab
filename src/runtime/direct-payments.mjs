import {ApplicationError} from '../application.mjs';
import {PAYMENT_BINDING as B,HISTORICAL_DRAFTS,digest} from '../payments.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function paymentPreparationEnabled(e){return e.VEGA_ENV==='development'&&e.VEGA_EXTERNAL_EFFECTS==='disabled'&&e.VEGA_PAYMENT_ATTEMPT_PREPARATION==='enabled'&&e.VEGA_SANDBOX_PAYMENT_EXECUTION==='disabled'&&e.SQUARE_ENVIRONMENT==='sandbox'&&e.SQUARE_APPLICATION_ID===B.applicationId&&e.SQUARE_MERCHANT_ID===B.merchantId&&e.SQUARE_LOCATION_ID===B.locationId&&uuid.test(e.VEGA_SANDBOX_PURCHASE_ID||'')&&!HISTORICAL_DRAFTS.has(e.VEGA_SANDBOX_PURCHASE_ID);}
export function sandboxPaymentEnabled(e){return e.VEGA_ENV==='development'&&e.VEGA_EXTERNAL_EFFECTS==='disabled'&&e.VEGA_SANDBOX_PAYMENT_EXECUTION==='authorized'&&e.SQUARE_ENVIRONMENT==='sandbox'&&e.SQUARE_APPLICATION_ID===B.applicationId&&e.SQUARE_MERCHANT_ID===B.merchantId&&e.SQUARE_LOCATION_ID===B.locationId&&uuid.test(e.VEGA_SANDBOX_PURCHASE_ID||'')&&!HISTORICAL_DRAFTS.has(e.VEGA_SANDBOX_PURCHASE_ID)&&!!e.SQUARE_ACCESS_TOKEN&&/^cnon:[A-Za-z0-9_-]{1,240}$/.test(e.SQUARE_SANDBOX_SOURCE_ID||'');}
export function verifyPayment(p,a){
 const invalid=reason=>({status:'unresolved',reason});
 if(!p||p.id!==a.paymentId||p.location_id!==B.locationId||p.reference_id!==a.id||p.application_details?.application_id!==B.applicationId)return invalid('provider_identity_mismatch');
 if(p.amount_money?.amount!==6000||p.amount_money?.currency!=='USD'||p.total_money?.amount!==6000||p.total_money?.currency!=='USD'||p.source_type!=='CARD'||(p.tip_money&&p.tip_money.amount!==0)||(p.app_fee_money&&p.app_fee_money.amount!==0)||(p.refunded_money&&p.refunded_money.amount!==0))return invalid('provider_terms_mismatch');
 if(!Number.isFinite(Date.parse(p.updated_at))||!Number.isFinite(Date.parse(p.created_at)))return invalid('provider_timestamp_missing');
 const status={COMPLETED:'succeeded',APPROVED:'pending',PENDING:'pending',FAILED:'failed',CANCELED:'cancelled'}[p.status];
 if(!status)return invalid('provider_status_unknown');
 return {status,reason:`square_${p.status.toLowerCase()}`,verified:true,paymentId:p.id,referenceId:p.reference_id,bindingDigest:digest(B),amount:6000,currency:'USD',providerStatus:p.status,providerCreatedAt:p.created_at,providerUpdatedAt:p.updated_at};
}
export function createDirectPayments(env,store,fetcher=fetch){
 function gate(purchaseId){if(!sandboxPaymentEnabled(env)||purchaseId!==env.VEGA_SANDBOX_PURCHASE_ID)throw new ApplicationError('Sandbox payment execution disabled for this purchase',403);}
 async function request(path,{method='GET',body}={}){
  try{const r=await fetcher(`https://${B.host}${path}`,{method,redirect:'error',headers:{Authorization:`Bearer ${env.SQUARE_ACCESS_TOKEN}`,'Square-Version':'2026-09-16','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});return {ok:r.ok,status:r.status,value:await r.json()};}
  catch{return {ok:false,status:0,value:null};}
 }
 const observe=(userId,purchaseId,attemptId,evidence)=>store.paymentCommand(userId,{action:'payment-observe',body:{purchaseId,attemptId,evidence,requestId:`observe:${attemptId}:${digest(evidence).slice(0,40)}`}});
 async function fulfill(userId,purchaseId,attemptId){
  const {attempt}=await store.paymentRead(userId,purchaseId,attemptId);
  const confirmation=await observe(userId,purchaseId,attemptId,attempt.evidence);
  if(confirmation.independentReceipt?.state!=='acknowledged')return {purchaseId,attemptId,status:'succeeded',fulfillmentStatus:'pending'};
  const issued=await store.paymentCommand(userId,{action:'payment-fulfill',body:{purchaseId,attemptId,requestId:`fulfill:${attemptId}`}});
  return {purchaseId,attemptId,status:'succeeded',fulfillmentStatus:issued.independentReceipt?.state==='acknowledged'?'issued':'pending',issuanceId:issued.issuanceId};
 }
 async function settle(userId,purchaseId,attemptId){
  gate(purchaseId);let {attempt}=await store.paymentRead(userId,purchaseId,attemptId);
  const intent=await store.paymentCommand(userId,{action:'payment-prepare',body:{purchaseId,sourceDigest:attempt.prepareSourceDigest===null?null:attempt.sourceDigest,requestId:attempt.prepareRequestId}});
  if(intent.independentReceipt?.state!=='acknowledged')return {purchaseId,attemptId,status:'pending',fulfillmentStatus:'not_issued'};
  if(attempt.status==='succeeded')return fulfill(userId,purchaseId,attemptId);
  if(['failed','cancelled'].includes(attempt.status))return {purchaseId,attemptId,status:attempt.status};
  if(attempt.prepareSourceDigest===null){
   const bound=await store.paymentCommand(userId,{action:'payment-bind-source',body:{purchaseId,attemptId,sourceDigest:digest(env.SQUARE_SANDBOX_SOURCE_ID),requestId:`source:${attemptId}`}});
   if(bound.independentReceipt?.state!=='acknowledged')return {purchaseId,attemptId,status:'pending',fulfillmentStatus:'not_issued'};
   attempt=(await store.paymentRead(userId,purchaseId,attemptId)).attempt;
  }
  if(attempt.sourceDigest!==digest(env.SQUARE_SANDBOX_SOURCE_ID))throw new ApplicationError('Original Sandbox payment source required for retry',409);
  const identity=await request('/oauth2/token/status',{method:'POST'});
  if(!identity.ok||identity.value?.client_id!==B.applicationId||identity.value?.merchant_id!==B.merchantId){await observe(userId,purchaseId,attemptId,{status:'unresolved',reason:'provider_credential_identity_unverified'});return {purchaseId,attemptId,status:'unresolved'};}
  if(!attempt.paymentId){
   if(Date.now()-Date.parse(attempt.executionStartedAt||attempt.createdAt)>15*60*1000){await observe(userId,purchaseId,attemptId,{status:'unresolved',reason:'create_retry_window_closed'});return {purchaseId,attemptId,status:'unresolved'};}
   const created=await request('/v2/payments',{method:'POST',body:{source_id:env.SQUARE_SANDBOX_SOURCE_ID,idempotency_key:attempt.idempotencyKey,amount_money:{amount:6000,currency:'USD'},location_id:B.locationId,reference_id:attempt.id,autocomplete:true,accept_partial_authorization:false}});
   const paymentId=created.value?.payment?.id;
   if(!created.ok||typeof paymentId!=='string'||! /^[A-Za-z0-9_-]{1,192}$/.test(paymentId)){
    const codes=created.value?.errors?.map(e=>e.code)||[];
    const declined=created.status===400&&!paymentId&&codes.length>0&&codes.every(c=>['CARD_DECLINED','VERIFY_CVV_FAILURE','VERIFY_AVS_FAILURE','INSUFFICIENT_FUNDS','CARD_EXPIRED'].includes(c));
    const status=declined?'failed':'unresolved';await observe(userId,purchaseId,attemptId,{status,reason:declined?'card_rejected':'create_outcome_unresolved'});return {purchaseId,attemptId,status};
   }
   await observe(userId,purchaseId,attemptId,{status:'pending',reason:'payment_id_received',paymentId});
   attempt=(await store.paymentRead(userId,purchaseId,attemptId)).attempt;
  }
  const read=await request(`/v2/payments/${encodeURIComponent(attempt.paymentId)}`);
  const evidence=read.ok?verifyPayment(read.value?.payment,attempt):{status:'unresolved',reason:'get_payment_unavailable'};
  const confirmed=await observe(userId,purchaseId,attemptId,evidence);
  if(evidence.status==='succeeded'&&confirmed.independentReceipt?.state==='acknowledged')return fulfill(userId,purchaseId,attemptId);
  return {purchaseId,attemptId,status:evidence.status,fulfillmentStatus:evidence.status==='succeeded'?'pending':'not_issued'};
 }
 return {
  async prepare(userId,body){
   if(Object.keys(body).some(k=>!['purchaseId','requestId'].includes(k))||!uuid.test(body.purchaseId||'')||typeof body.requestId!=='string'||!body.requestId.trim()||body.requestId.length>128)throw new ApplicationError('Invalid payment intent');
   if(!paymentPreparationEnabled(env)||body.purchaseId!==env.VEGA_SANDBOX_PURCHASE_ID)throw new ApplicationError('Payment preparation disabled for this purchase',403);
   const result=await store.paymentCommand(userId,{action:'payment-prepare',body:{purchaseId:body.purchaseId,requestId:body.requestId,sourceDigest:null}});
   return {...result,status:'pending',fulfillmentStatus:'not_issued',executionEnabled:false};
  },
  async start(userId,body){
   if(Object.keys(body).some(k=>!['purchaseId','requestId'].includes(k))||!uuid.test(body.purchaseId||'')||typeof body.requestId!=='string'||!body.requestId.trim()||body.requestId.length>128)throw new ApplicationError('Invalid payment intent');
   gate(body.purchaseId);
   const result=await store.paymentCommand(userId,{action:'payment-prepare',body:{purchaseId:body.purchaseId,requestId:body.requestId,sourceDigest:digest(env.SQUARE_SANDBOX_SOURCE_ID)}});
   if(result.independentReceipt?.state!=='acknowledged')return {purchaseId:body.purchaseId,attemptId:result.attemptId,status:'pending',fulfillmentStatus:'not_issued'};
   return settle(userId,body.purchaseId,result.attemptId);
  },
  async resume(userId,body){
   if(Object.keys(body).some(k=>!['purchaseId','attemptId','requestId'].includes(k))||!uuid.test(body.purchaseId||'')||!uuid.test(body.attemptId||''))throw new ApplicationError('Invalid payment lookup');
   return settle(userId,body.purchaseId,body.attemptId);
  }
 };
}
