import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../application.mjs';

// Request bodies never carry evidence or policy. Provider acquisition and
// business commits are separate; the locked store rechecks staff membership.
export function createRefundProgram({store,adapter,enabled=()=>false,id=randomUUID,now=()=>new Date().toISOString()}){
 const fail=(message,status=409)=>{throw new ApplicationError(message,status);};
 const command=(user,action,body,evidence)=>store.refundCommand(user,{action:`refund-program-${action}`,body},evidence);
 async function context(user,body){
  if(!body||typeof body.purchaseId!=='string'||typeof body.requestId!=='string'||!body.requestId||Object.keys(body).some(k=>!['purchaseId','operationId','requestId','reason','unitIds','refundId'].includes(k)))fail('Invalid refund program request',400);
  return store.refundContext(user,body.purchaseId,body.operationId);
 }
 const acquire=async c=>({stateDigest:c.stateDigest,inventory:await adapter.inventory(c.purchase)});
 const operation=(c,b)=>{if(!c.operation||c.operation.id!==b.operationId||c.operation.contract!=='refund-program/1')fail('Refund unavailable',404);return c.operation;};
 return {
  async prepare(user,body){
   if(!enabled(body?.purchaseId))fail('Refund program execution disabled',503);
   const c=await context(user,body);return command(user,'intent',body,await acquire(c));
  },
  async execute(user,body){
   if(!enabled(body?.purchaseId))fail('Refund program execution disabled',503);
   const c=await context(user,body),op=operation(c,body);
   if(op.status!=='intent')return {refund:op,reconciliationRequired:true,executionAuthorized:false};
   const ack=await store.operation(op.actorId,op.intentReceiptId);
   if(ack.pending||ack.independentReceipt?.state!=='acknowledged')fail('Refund intent awaits independent recovery acknowledgment');
   const claimed=await command(user,'dispatch',{...body,requestId:`refund-program-dispatch:${id()}`},await acquire(c));
   if(!claimed.independentReceipt?.operationId)fail('Dispatch recovery capture unavailable');
   let outcome;try{outcome=await adapter.submitProgram(claimed.refund);}catch{outcome={tenantId:op.tenantId,businessId:op.businessId,purchaseId:op.purchaseId,operationId:op.id,paymentId:op.paymentId,status:'unknown',observedAt:now()};}
   return command(user,'observe',{...body,requestId:`refund-program-observe:${id()}`},outcome);
  },
  async reconcile(user,body){const c=await context(user,body),op=operation(c,body);return command(user,'observe',{...body,requestId:`refund-program-observe:${id()}`},await adapter.inspectProgram(op));},
  async release(user,body){const c=await context(user,body),op=operation(c,body);return command(user,'release',body,await adapter.inspectProgram(op));},
  async external(user,body){const c=await context(user,body);return command(user,'external',body,await acquire(c));},
  async resolve(user,body){const c=await context(user,body);operation(c,body);return command(user,'external-resolve',body,await acquire(c));},
  async bind(user,body){const c=await context(user,body);operation(c,body);return command(user,'bind',body,await acquire(c));}
 };
}
