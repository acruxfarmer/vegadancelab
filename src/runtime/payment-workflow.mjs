import {ApplicationError} from '../application.mjs';
import {digest} from '../payments.mjs';
import {financialIntent,requireCapabilities,sameIntegration} from '../payment-contract.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(m,s)=>{throw new ApplicationError(m,s);};
export function createPaymentWorkflow({store,resolveAdapter,policy}){
 const gate=(mode,id)=>{if(!policy(mode,id))fail('Payment operation disabled for this purchase',403);};
 const observe=(userId,purchaseId,attemptId,evidence)=>store.paymentCommand(userId,{action:'payment-observe',body:{purchaseId,attemptId,evidence,requestId:`observe:${attemptId}:${digest(evidence).slice(0,40)}`}});
 async function fulfill(userId,purchaseId,attemptId){
  const {attempt}=await store.paymentRead(userId,purchaseId,attemptId);
  const confirmation=await observe(userId,purchaseId,attemptId,attempt.evidence);
  if(confirmation.independentReceipt?.state!=='acknowledged')return {purchaseId,attemptId,status:'succeeded',fulfillmentStatus:'pending'};
  const issued=await store.paymentCommand(userId,{action:'payment-fulfill',body:{purchaseId,attemptId,requestId:`fulfill:${attemptId}`}});
  return {purchaseId,attemptId,status:'succeeded',fulfillmentStatus:issued.independentReceipt?.state==='acknowledged'?'issued':'pending',issuanceId:issued.issuanceId};
 }
 async function settle(userId,purchaseId,attemptId){
  gate('execute',purchaseId);
  let {attempt,draft,integrationRef}=await store.paymentRead(userId,purchaseId,attemptId);
  const intent=await store.paymentCommand(userId,{action:'payment-prepare',body:{purchaseId,sourceDigest:attempt.prepareSourceDigest===null?null:attempt.sourceDigest,requestId:attempt.prepareRequestId}});
  if(intent.independentReceipt?.state!=='acknowledged')return {purchaseId,attemptId,status:'pending',fulfillmentStatus:'not_issued'};
  if(attempt.status==='succeeded')return fulfill(userId,purchaseId,attemptId);
  if(['failed','cancelled'].includes(attempt.status))return {purchaseId,attemptId,status:attempt.status};
  const adapter=resolveAdapter(integrationRef);requireCapabilities(adapter,financialIntent(draft),fail);
  if(attempt.prepareSourceDigest===null){
   const bound=await store.paymentCommand(userId,{action:'payment-bind-source',body:{purchaseId,attemptId,sourceDigest:adapter.sourceFingerprint(),requestId:`source:${attemptId}`}});
   if(bound.independentReceipt?.state!=='acknowledged')return {purchaseId,attemptId,status:'pending',fulfillmentStatus:'not_issued'};
   const fresh=await store.paymentRead(userId,purchaseId,attemptId);
   if(!sameIntegration(fresh.integrationRef,integrationRef))fail('Integration changed during execution',409);
   attempt=fresh.attempt;
  }
  if(attempt.sourceDigest!==adapter.sourceFingerprint())fail('Original payment source required for retry',409);
  if(!attempt.paymentId){
   let created;
   try{created=await adapter.submit(attempt,financialIntent(draft));}catch{created={status:'unresolved',reason:'provider_submission_unavailable'};}
   // A submit response cannot confirm or fulfill. Confirmation requires independent lookup.
   if(!created.paymentId||created.status!=='pending'){
    const safe={status:created.status==='failed'?'failed':'unresolved',reason:created.reason||'provider_submission_unresolved'};
    await observe(userId,purchaseId,attemptId,safe);return {purchaseId,attemptId,status:safe.status};
   }
   await observe(userId,purchaseId,attemptId,created);
   attempt=(await store.paymentRead(userId,purchaseId,attemptId)).attempt;
  }
  let evidence;
  try{evidence=await adapter.inspect(attempt,financialIntent(draft));}catch{evidence={status:'unresolved',reason:'provider_lookup_unavailable'};}
  const confirmed=await observe(userId,purchaseId,attemptId,evidence);
  if(evidence.status==='succeeded'&&confirmed.independentReceipt?.state==='acknowledged')return fulfill(userId,purchaseId,attemptId);
  return {purchaseId,attemptId,status:evidence.status,fulfillmentStatus:evidence.status==='succeeded'?'pending':'not_issued'};
 }
 function validate(body){if(Object.keys(body).some(k=>!['purchaseId','requestId'].includes(k))||!uuid.test(body.purchaseId||'')||typeof body.requestId!=='string'||!body.requestId.trim()||body.requestId.length>128)fail('Invalid payment intent',400);}
 async function prepare(userId,body,execute){
  validate(body);gate(execute?'execute':'prepare',body.purchaseId);
  const {draft,integrationRef}=await store.paymentContext(userId,body.purchaseId);
  const adapter=resolveAdapter(integrationRef);requireCapabilities(adapter,financialIntent(draft),fail);
  const result=await store.paymentCommand(userId,{action:'payment-prepare',body:{purchaseId:body.purchaseId,requestId:body.requestId,sourceDigest:execute?adapter.sourceFingerprint():null}});
  if(!execute)return {...result,status:'pending',fulfillmentStatus:'not_issued',executionEnabled:false};
  if(result.independentReceipt?.state!=='acknowledged')return {purchaseId:body.purchaseId,attemptId:result.attemptId,status:'pending',fulfillmentStatus:'not_issued'};
  return settle(userId,body.purchaseId,result.attemptId);
 }
 return {prepare:(u,b)=>prepare(u,b,false),start:(u,b)=>prepare(u,b,true),async resume(u,b){
  if(Object.keys(b).some(k=>!['purchaseId','attemptId','requestId'].includes(k))||!uuid.test(b.purchaseId||'')||!uuid.test(b.attemptId||''))fail('Invalid payment lookup',400);
  return settle(u,b.purchaseId,b.attemptId);
 }};
}
