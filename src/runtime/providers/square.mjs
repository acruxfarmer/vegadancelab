import {digest} from '../../payments.mjs';
import {qualifiedTransaction} from '../../payment-contract.mjs';
import {PAYMENT_BINDING as B,SQUARE_INTEGRATION as integrationRef,squareConfigurationMatches} from './square-configuration.mjs';

export function squareExecutionReady(e){return squareConfigurationMatches(e)&&!!e.SQUARE_ACCESS_TOKEN&&/^cnon:[A-Za-z0-9_-]{1,240}$/.test(e.SQUARE_SANDBOX_SOURCE_ID||'');}
export function verifyPayment(p,a){
 const invalid=reason=>({status:'unresolved',reason});
 if(!p||p.id!==a.paymentId||p.location_id!==B.locationId||p.reference_id!==a.id||p.application_details?.application_id!==B.applicationId)return invalid('provider_identity_mismatch');
 if(p.amount_money?.amount!==6000||p.amount_money?.currency!=='USD'||p.total_money?.amount!==6000||p.total_money?.currency!=='USD'||p.source_type!=='CARD'||(p.tip_money&&p.tip_money.amount!==0)||(p.app_fee_money&&p.app_fee_money.amount!==0)||(p.refunded_money&&p.refunded_money.amount!==0))return invalid('provider_terms_mismatch');
 if(!Number.isFinite(Date.parse(p.updated_at))||!Number.isFinite(Date.parse(p.created_at)))return invalid('provider_timestamp_missing');
 const status={COMPLETED:'succeeded',APPROVED:'pending',PENDING:'pending',FAILED:'failed',CANCELED:'cancelled'}[p.status];
 if(!status)return invalid('provider_status_unknown');
 return {normalizationVersion:1,status,reason:`provider_${status}`,verified:true,paymentId:p.id,referenceId:p.reference_id,integrationRef:{...integrationRef},transactionRef:qualifiedTransaction(integrationRef,p.id),amount:6000,currency:'USD',verification:{method:'authenticated_lookup',observedAt:new Date().toISOString(),evidenceDigest:digest(p)},providerEvidence:{provider:'square',environment:'sandbox',applicationId:B.applicationId,merchantId:B.merchantId,locationId:B.locationId,status:p.status,createdAt:p.created_at,updatedAt:p.updated_at}};
}
export function createSquareAdapter(env,fetcher=fetch){
 async function request(path,{method='GET',body}={}){
  try{const r=await fetcher(`https://${B.host}${path}`,{method,redirect:'error',headers:{Authorization:`Bearer ${env.SQUARE_ACCESS_TOKEN}`,'Square-Version':'2026-09-16','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});return {ok:r.ok,status:r.status,value:await r.json()};}
  catch{return {ok:false,status:0,value:null};}
 }
 async function identity(){
  if(!squareExecutionReady(env))return false;
  const r=await request('/oauth2/token/status',{method:'POST'});
  return r.ok&&r.value?.client_id===B.applicationId&&r.value?.merchant_id===B.merchantId;
 }
 return {
  contractVersion:1,capabilities:{immediateCard:true,idempotentSubmit:true,verifiedLookup:true},
  sourceFingerprint:()=>digest(env.SQUARE_SANDBOX_SOURCE_ID),
  validateIntent(intent,fail){if(intent.amountMinor!==6000||intent.currency!=='USD'||intent.collection!=='immediate'||intent.method!=='card'||intent.partialAllowed!==false||intent.tipsAllowed!==false)fail('Provider capability unsupported',422);},
  async submit(attempt){
   if(!await identity())return {status:'unresolved',reason:'provider_credential_identity_unverified'};
   if(Date.now()-Date.parse(attempt.executionStartedAt||attempt.createdAt)>15*60*1000)return {status:'unresolved',reason:'create_retry_window_closed'};
   const created=await request('/v2/payments',{method:'POST',body:{source_id:env.SQUARE_SANDBOX_SOURCE_ID,idempotency_key:attempt.idempotencyKey,amount_money:{amount:6000,currency:'USD'},location_id:B.locationId,reference_id:attempt.id,autocomplete:true,accept_partial_authorization:false}});
   const paymentId=created.value?.payment?.id;
   if(!created.ok||typeof paymentId!=='string'||! /^[A-Za-z0-9_-]{1,192}$/.test(paymentId)){
    const codes=created.value?.errors?.map(e=>e.code)||[];
    const declined=created.status===400&&!paymentId&&codes.length>0&&codes.every(c=>['CARD_DECLINED','VERIFY_CVV_FAILURE','VERIFY_AVS_FAILURE','INSUFFICIENT_FUNDS','CARD_EXPIRED'].includes(c));
    return {status:declined?'failed':'unresolved',reason:declined?'card_rejected':'create_outcome_unresolved'};
   }
   return {status:'pending',reason:'payment_id_received',paymentId,integrationRef:{...integrationRef},transactionRef:qualifiedTransaction(integrationRef,paymentId)};
  },
  async inspect(attempt){
   if(!await identity())return {status:'unresolved',reason:'provider_credential_identity_unverified'};
   const r=await request(`/v2/payments/${encodeURIComponent(attempt.paymentId)}`);
   return r.ok?verifyPayment(r.value?.payment,attempt):{status:'unresolved',reason:'get_payment_unavailable'};
  }
 };
}
