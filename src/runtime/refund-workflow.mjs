import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../application.mjs';

export function createRefundWorkflow({store,adapter,enabled=()=>false,id=randomUUID,now=()=>new Date().toISOString()}){
 const deny=()=>{throw new ApplicationError('Refund workflow disabled',503);};
 async function context(userId,body){
  if(!enabled())deny();
  if(!body||typeof body.purchaseId!=='string'||typeof body.requestId!=='string'||!body.requestId||Object.keys(body).some(k=>!['purchaseId','requestId','reason','operationId'].includes(k)))throw new ApplicationError('Invalid refund request');
  return store.refundContext(userId,body.purchaseId);
 }
 const command=(userId,action,body,evidence)=>store.refundCommand(userId,{action,body},evidence);
 const ack=async(userId,op)=>{
  const receipt=await store.operation(op.actorId,op.intentReceiptId);
  if(receipt.pending||receipt.independentReceipt?.state!=='acknowledged')throw new ApplicationError('Refund intent awaits independent recovery acknowledgment',409);
 };
 return {
  async prepare(userId,body){
   const c=await context(userId,body);
   if(c.operation)return command(userId,'refund-intent',body);
   const evidence=await adapter.readiness(c.purchase);
   return command(userId,'refund-intent',body,{...evidence,stateDigest:c.stateDigest,ownedComplete:c.ownedComplete});
  },
  async execute(userId,body){
   const c=await context(userId,body),op=c.operation;
   if(!op||op.id!==body.operationId)throw new ApplicationError('Refund unavailable',404);
   if(op.status!=='intent')return {refund:op,executionAuthorized:false,reconciliationRequired:true};
   await ack(userId,op);
   const evidence=await adapter.readiness(op);
   // Unique internal request ID: command replay can never replay dispatch authority.
   const claimed=await command(userId,'refund-dispatch',{...body,requestId:`refund-dispatch:${id()}`},evidence);
   // The transaction has durably captured the marker in the existing outbox.
   // If commit acknowledgment is lost, this call throws and never submits.
   if(!claimed.independentReceipt?.operationId)throw new ApplicationError('Dispatch recovery capture unavailable',409);
   let outcome;
   try{outcome=await adapter.submit(claimed.refund);}catch{outcome={...evidence,operationId:op.id,status:'unknown',observedAt:now()};}
   return command(userId,'refund-observe',{...body,requestId:`refund-observe:${id()}`},outcome);
  },
  async reconcile(userId,body){
   const c=await context(userId,body),op=c.operation;
   if(!op||op.id!==body.operationId)throw new ApplicationError('Refund unavailable',404);
   const evidence=await adapter.inspect(op);
   return command(userId,'refund-observe',{...body,requestId:`refund-observe:${id()}`},evidence);
  },
  async release(userId,body){
   const c=await context(userId,body),op=c.operation;
   if(!op||op.id!==body.operationId)throw new ApplicationError('Refund unavailable',404);
   return command(userId,'refund-release',body,await adapter.inspect(op));
  }
 };
}
