import {readFileSync} from 'node:fs';
import {paymentTransition,digest} from '../../src/payments.mjs';
import {refundTransition} from '../../src/bounded-refunds.mjs';
import {boundedRefundReadiness} from '../../src/bounded-refund-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export const target={kind:'media_resource',id:'disposable-resource',tenantId:'vega-development',businessId:'vega-dance-lab'};
export const durable={id:'access',type:'DURABLE_ACCESS',target};
export const booking={id:'credits',type:'BOOKING_CREDITS'};
export function fixture(actions=[durable]){
 const state=structuredClone(original),p=state.purchaseDrafts[0];let n=0;
 for(const k of ['creditEvents','creditUnits','passes','entitlementIssuances','activity'])state[k]=[];
 state.participants=[{id:p.participantId}];state.classes=[];
 delete p.issuanceId;delete p.validFrom;delete p.expiresAt;p.fulfillmentStatus='pending';
 if(actions!==null)p.terms.fulfillmentPlan={version:1,actions:structuredClone(actions)};
 const a={userId:p.buyerId,role:'member',tenantId:p.tenantId,businessId:p.businessId,participantIds:[p.participantId]};
 const staff={...a,userId:'staff',role:'staff',participantIds:[]},now=()=> '2026-10-05T23:00:00Z',id=()=>`s8a-${++n}`,fail=m=>{throw Error(m);};
 const sync=()=>state.paymentAttempts[0].offerDigest=digest(state.purchaseDrafts[0].terms);sync();
 const fulfill=(authority=a)=>paymentTransition(state,{action:'payment-fulfill',body:{purchaseId:p.id,attemptId:state.paymentAttempts[0].id,requestId:`test-${++n}`}},authority,{id,now,integrationRef:state.paymentAttempts[0].integrationRef},fail);
 const proof=()=>({tenantId:a.tenantId,businessId:a.businessId,purchaseId:p.id,paymentId:state.paymentAttempts[0].paymentId,amountMinor:p.totalMinor,currency:p.currency,stateDigest:digest(state),businessReadiness:boundedRefundReadiness({state,authority:staff,purchaseId:p.id,at:now()}),providerClear:true,paymentVersion:'fixture-version',observedAt:now()});
 const refund=()=>{
  const run=(action,extra={})=>refundTransition(state,{action,body:{purchaseId:p.id,requestId:id(),reason:'Customer request',operationId:state.refundOperations?.[0]?.id}},staff,{id,now,evidence:{...proof(),...extra}},fail);
  run('refund-intent');run('refund-dispatch');run('refund-observe',{operationId:state.refundOperations[0].id,status:'completed',refundId:'fixture-refund',verified:true});
 };
 return {state,a,staff,fulfill,refund,sync};
}
