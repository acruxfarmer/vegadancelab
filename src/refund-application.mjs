import {randomUUID} from 'node:crypto';
import {ApplicationError,transition as legacyTransition,visibleState as legacyView} from './application.mjs';
import {refundTransition,guardRefundBooking} from './bounded-refunds.mjs';
import {refundHistory} from './refund-reconciliation.mjs';
import {refundProgramTransition,programHolding} from './refund-program.mjs';
export {ApplicationError,emptyState} from './application.mjs';
const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
export function transition(original,command,authority,options={}){
 if(command.action.startsWith('refund-')){
  if(!options.trustedRefund)fail('Internal refund operation only',403);
  const requestId=command.body?.requestId;
  if(typeof requestId!=='string'||!requestId.trim()||requestId.length>128)fail('A request identifier is required');
  const state=structuredClone(original);
  const handler=command.action.startsWith('refund-program-')?refundProgramTransition:refundTransition;
  const result=handler(state,command,authority,{id:options.id??randomUUID,now:options.now??(()=>new Date().toISOString()),evidence:options.refundEvidence},fail);
  return {state,result};
 }
 guardRefundBooking(original,command,fail);
 const participant=command.body?.participantId??original.reservations?.find(r=>r.id===command.id)?.participantId;
 if(['reserve','promote'].includes(command.action)&&original.refundOperations?.some(o=>programHolding(o)&&o.participantId===participant))fail('Refund pending review: booking is held',409);
 return legacyTransition(original,command,authority,options);
}
export function visibleState(state,authority,at){
 const result=legacyView(state,authority,at);
 result.refundHistory=refundHistory(state,authority);
 if(authority.role==='staff')result.refundOperations=(state.refundOperations??[]).filter(o=>o.tenantId===authority.tenantId&&o.businessId===authority.businessId).map(({id,purchaseId,status,amountMinor,currency,providerRefundId})=>({id,purchaseId,status,amountMinor,currency,providerRefundId}));
 return result;
}
