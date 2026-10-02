import {isDeepStrictEqual as equal} from 'node:util';
import {digest} from './payments.mjs';
import {financialIntent, validCompletion, validIntegration} from './payment-contract.mjs';

// Trusted owned snapshot and server-resolved authority only. No I/O or state writes.
// Refund records are an explicit caller input: omission is unknown, never absence.
export function assessRefundEligibility({state, authority, purchaseId, at, refundRecords}) {
 const result=(status,...reasonCodes)=>({contractVersion:2,status,reasonCodes,staffApprovalRequired:true,executionAuthorized:false});
 const d=state?.purchaseDrafts?.find(x=>x.id===purchaseId);
 if(!d||!authority||d.tenantId!==authority.tenantId||d.businessId!==authority.businessId||
    !(authority.role==='staff'||(authority.role==='member'&&authority.userId===d.buyerId&&authority.participantIds?.length===1&&authority.participantIds[0]===d.participantId)))
  return result('denied','OWNERSHIP_SCOPE_DENIED');
 const a=state.paymentAttempts?.find(x=>x.id===d.activeAttemptId&&x.purchaseId===d.id);
 const o=d.terms,policy=o?.refundPolicy;
 const positive=n=>Number.isSafeInteger(n)&&n>0;
 const text=s=>typeof s==='string'&&s.length>0;
 const expected={approval:'staff',kind:'full_only',whollyUnused:true,noActiveReservations:true,requestWithinDays:policy?.requestWithinDays,windowStartsAt:'confirmed_payment_successful_purchase_completion'};
 if(!equal(policy,expected)||!positive(policy?.requestWithinDays)||!o||o.tenantId!==d.tenantId||o.businessId!==d.businessId||
    !positive(d.totalMinor)||!positive(o.priceMinor)||d.subtotalMinor!==o.priceMinor||!Number.isSafeInteger(d.taxMinor)||d.taxMinor<0||d.taxMinor!==o.tax?.amountMinor||d.totalMinor!==d.subtotalMinor+d.taxMinor||
    !/^[A-Z]{3}$/.test(d.currency)||d.currency!==o.currency||!positive(o.quantity)||!text(o.productId)||!text(o.productType)||!text(o.productName)||
    o.validityStart!=='confirmed_payment'||!(o.validDays===null||positive(o.validDays))||!Array.isArray(o.categories)||!Array.isArray(o.classIds))
  return result('blocked','FROZEN_TERMS_UNSUPPORTED');
 if(!Array.isArray(refundRecords))return result('blocked','REFUND_STATE_UNRESOLVED');
 if(refundRecords.some(x=>x.purchaseId===d.id))return result('blocked','EXISTING_REFUND_OR_REVERSAL');
 if(['refunded','reversed'].includes(d.status)||['refunded','reversed'].includes(d.paymentStatus))return result('ineligible','EXISTING_REFUND_OR_REVERSAL');
 if(!a||d.status!=='paid'||d.paymentStatus!=='succeeded'||a.status!=='succeeded'||a.evidence?.status!=='succeeded'||
    !validIntegration(a.integrationRef,authority)||!validCompletion(a.evidence,a,a.integrationRef,financialIntent(d))||
    a.paymentId!==a.evidence.paymentId||!equal(a.transactionRef,a.evidence.transactionRef)||a.buyerId!==d.buyerId||a.participantId!==d.participantId||a.offerDigest!==digest(d.terms)||!equal(a.financialIntent,financialIntent(d))||
    a.paymentConfirmedAt!==d.paymentConfirmedAt||d.refundWindowStartsAt!==d.paymentConfirmedAt)
  return result('blocked','OWNED_PROVIDER_STATE_INCONSISTENT');
 const now=Date.parse(at),start=Date.parse(d.refundWindowStartsAt),end=start+policy.requestWithinDays*86400000;
 if(!Number.isFinite(now)||!Number.isFinite(start)||!Number.isSafeInteger(end)||!Number.isFinite(new Date(end).getTime())||now<start)return result('blocked','CLOCK_STATE_INCONSISTENT');
 if(now===end)return result('blocked','REFUND_CUTOFF_POLICY_UNRESOLVED');
 if(now>end)return result('ineligible','REFUND_WINDOW_EXPIRED');
 const grants=state.entitlementIssuances?.filter(x=>x.reference===`purchase:${d.id}`)||[];
 const g=grants[0],passes=state.passes?.filter(x=>x.entitlement?.issuanceId===g?.id)||[];
 const units=state.creditUnits?.filter(x=>x.entitlement?.issuanceId===g?.id)||[];
 if(d.fulfillmentStatus!=='issued'||grants.length!==1||g.id!==d.issuanceId||g.quantity!==o.quantity||g.participantId!==d.participantId||passes.length!==1||passes[0].id!==g.passId||units.length!==o.quantity||new Set(units.map(x=>x.id)).size!==o.quantity)
  return result('blocked','FULFILLMENT_STATE_INCONSISTENT');
 const snapshot={id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds};
 const entitlement={issuanceId:g.id,productId:o.productId,productName:o.productName,productType:o.productType,source:g.source,membershipId:null,validFrom:d.validFrom,expiresAt:d.expiresAt,categories:o.categories,classIds:o.classIds};
 if(!equal(g.productSnapshot,snapshot)||g.productId!==o.productId||g.membershipId!==null||!text(g.source)||passes[0].quantity!==o.quantity||passes[0].participantId!==d.participantId||!equal(passes[0].entitlement,entitlement)||d.validFrom!==d.paymentConfirmedAt||(o.validDays===null?d.expiresAt!==null:Date.parse(d.expiresAt)!==start+o.validDays*86400000))
  return result('blocked','FULFILLMENT_STATE_INCONSISTENT');
 if(!Array.isArray(state.creditEvents)||!Array.isArray(state.reservations))return result('blocked','USAGE_HISTORY_INCOMPLETE');
 const events=state.creditEvents.filter(x=>x.passId===g.passId||x.issuanceId===g.id||units.some(u=>u.id===x.unitId));
 if(units.some(x=>x.status==='reversed')||events.some(x=>/revers|refund/.test(x.type)))return result('ineligible','EXISTING_REFUND_OR_REVERSAL');
 if(units.some(x=>x.status==='spent'))return result('ineligible','ENTITLEMENT_CONSUMED');
 if(events.some(x=>x.type==='consume'||x.type==='restore'))return result('blocked','RESTORED_USAGE_POLICY_UNRESOLVED');
 if(units.some(x=>x.status!=='available'||x.passId!==g.passId||x.participantId!==d.participantId)||events.length!==o.quantity||units.some(u=>events.filter(e=>e.type==='issue'&&e.unitId===u.id&&e.source===g.source&&e.issuanceId===g.id&&e.participantId===d.participantId).length!==1))return result('blocked','USAGE_HISTORY_INCOMPLETE');
 if([passes[0],...units].some(x=>!equal(x.entitlement,passes[0].entitlement))||g.validFrom!==d.validFrom||g.expiresAt!==d.expiresAt||passes[0].entitlement.validFrom!==d.validFrom||passes[0].entitlement.expiresAt!==d.expiresAt)
  return result('blocked','FULFILLMENT_STATE_INCONSISTENT');
 if(state.reservations.some(x=>x.participantId===d.participantId&&x.status!=='cancelled'))return result('blocked','ACTIVE_OR_UNRESOLVED_RESERVATION');
 return {...result('eligible','OWNED_PAYMENT_CONFIRMED','WITHIN_FROZEN_REFUND_WINDOW','WHOLLY_UNUSED_ENTITLEMENT','NO_ACTIVE_RESERVATIONS','NO_RECORDED_REFUND_OR_REVERSAL','OWNERSHIP_MATCH'),refundAmount:{amountMinor:d.totalMinor,currency:d.currency}};
}
