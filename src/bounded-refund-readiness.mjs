import {assessRefundEligibility} from './refund-eligibility.mjs';
import {digest} from './payments.mjs';

// Current authoritative application state only. This is not an assertion of
// exhaustive history, original acceptance authenticity, or provider readiness.
export function boundedRefundReadiness({state,authority,purchaseId,at}){
 const base={contract:'bounded-full-refund-readiness/1',tenantId:authority?.tenantId,businessId:authority?.businessId,purchaseId,stateDigest:digest(state),historicalCompleteness:'unknown',providerStatus:'provider_unknown',executionAuthorized:false};
 const blocked=reason=>({...base,status:'blocked',reasonCodes:[reason]});
 if(authority?.role!=='staff')return blocked('STAFF_REQUIRED');
 if(!['purchaseDrafts','paymentAttempts','entitlementIssuances','passes','creditUnits','creditEvents','reservations'].every(k=>Array.isArray(state?.[k])))return blocked('AUTHORITATIVE_STATE_UNAVAILABLE');
 // The application predates refundOperations. An absent field is its explicit
 // pre-refund representation; malformed/null inventories are never treated empty.
 // This says nothing about external refunds, which require fresh Square evidence.
 const records=Object.hasOwn(state,'refundOperations')?state.refundOperations:[];
 if(!Array.isArray(records)||records.some(r=>!r||typeof r.purchaseId!=='string'||r.tenantId!==authority.tenantId||r.businessId!==authority.businessId))return blocked('OWNED_REFUND_STATE_INVALID');
 const assessment=assessRefundEligibility({state,authority,purchaseId,at,refundRecords:records});
 return {...base,status:assessment.status==='eligible'?'ready':'blocked',reasonCodes:assessment.reasonCodes,assessment};
}
