import {randomUUID} from 'node:crypto';
import {ApplicationError,transition as legacyTransition,visibleState as legacyView} from './application.mjs';
import {refundTransition,guardRefundBooking} from './bounded-refunds.mjs';
export {ApplicationError,emptyState} from './application.mjs';
const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
export function transition(original,command,authority,options={}){
 if(command.action.startsWith('refund-')){
  if(!options.trustedRefund)fail('Internal refund operation only',403);
  const requestId=command.body?.requestId;
  if(typeof requestId!=='string'||!requestId.trim()||requestId.length>128)fail('A request identifier is required');
  const state=structuredClone(original);
  const result=refundTransition(state,command,authority,{id:options.id??randomUUID,now:options.now??(()=>new Date().toISOString()),evidence:options.refundEvidence},fail);
  return {state,result};
 }
 guardRefundBooking(original,command,fail);
 return legacyTransition(original,command,authority,options);
}
export function visibleState(state,authority,at){
 const result=legacyView(state,authority,at);
 if(authority.role==='staff')result.refundOperations=(state.refundOperations??[]).filter(o=>o.tenantId===authority.tenantId&&o.businessId===authority.businessId).map(({id,purchaseId,status,amountMinor,currency,providerRefundId})=>({id,purchaseId,status,amountMinor,currency,providerRefundId}));
 return result;
}
