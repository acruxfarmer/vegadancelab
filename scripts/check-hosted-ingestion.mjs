import { createHmac, createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { squareNotificationUrl } from '../src/runtime/square-webhook.mjs';
const report={checkedAt:new Date().toISOString(),environment:'development',squareSubscriptionChanged:false};
let stage='configuration';
try {
  const env=process.env;
  if(env.VEGA_ENV!=='development'||env.SQUARE_ENVIRONMENT!=='sandbox'||env.SQUARE_WEBHOOK_NOTIFICATION_URL!==squareNotificationUrl||!env.SQUARE_WEBHOOK_SIGNATURE_KEY)throw new Error('Wrong environment');
  stage='hosted_ingestion_readiness';
  const ready=await fetch('https://vega-development-web.onrender.com/health/ingestion',{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(ready.status!==200||(await ready.json()).status!=='durable_ingestion_ready')throw new Error('Not ready');
  const event={event_id:`vega-hosted-check-${randomUUID()}`,type:'payment.created',merchant_id:'vega-synthetic-verification',data:{type:'payment',object:{payment:{id:'vega-synthetic-payment',status:'COMPLETED'}}}};
  const raw=JSON.stringify(event);
  report.eventId=event.event_id;
  report.bodySha256=createHash('sha256').update(raw).digest('hex');
  const send=async(body,valid=true)=>{
    const signature=valid?createHmac('sha256',env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(squareNotificationUrl).update(body).digest('base64'):'invalid';
    const response=await fetch(squareNotificationUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','square-environment':'Sandbox','x-square-hmacsha256-signature':signature},body});
    return {httpStatus:response.status,status:(await response.json()).status};
  };
  report.results={};
  stage='invalid_signature';report.results.invalidSignature=await send(raw,false);
  if(report.results.invalidSignature.httpStatus!==401)throw new Error('Signature gate failed');
  stage='first_delivery';report.results.firstDelivery=await send(raw);
  if(report.results.firstDelivery.httpStatus!==200||report.results.firstDelivery.status!=='stored')throw new Error('Not stored');
  stage='duplicate_delivery';report.results.duplicateDelivery=await send(raw);
  if(report.results.duplicateDelivery.httpStatus!==200||report.results.duplicateDelivery.status!=='duplicate')throw new Error('Duplicate not verified');
  stage='conflicting_delivery';report.results.conflictingDelivery=await send(JSON.stringify({...event,verificationConflict:true}));
  if(report.results.conflictingDelivery.httpStatus!==409)throw new Error('Conflict not rejected');
  report.status='hosted_http_ingestion_passed_pending_independent_database_read';
}catch{report.status='incomplete';report.stage=stage;process.exitCode=2;}
await writeFile(new URL('../docs/hosted-ingestion-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
