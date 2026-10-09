import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {entitlementOperations} from './entitlements.mjs';
import {bookingAccounting} from './cancellation.mjs';
import {createRentalTerms} from './rental-policy.mjs';
import {rentalEligible} from './rental-entitlement.mjs';

const text=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const key=(p,id)=>createHash('sha256').update(JSON.stringify(['fulfillment/1',p.tenantId,p.businessId,p.id,id])).digest('hex');
const sameScope=(x,p)=>x.tenantId===p.tenantId&&x.businessId===p.businessId;
const fail=message=>{throw Error(message);};
export function fulfillmentPlan(p){
 const plan=p.terms.fulfillmentPlan;
 if(plan===undefined){
  // Compatibility is restricted to the previously supported product contract.
  // Historical offer versions are never rewritten and unknown products get no default.
  if(!['drop_in','class_pack','membership','courtesy'].includes(p.terms.productType))fail('Explicit fulfillment plan required');
  return {version:1,actions:[{id:'booking-credits',type:'BOOKING_CREDITS'}]};
 }
 if(!plan||plan.version!==1||Object.keys(plan).some(k=>!['version','actions'].includes(k))||!Array.isArray(plan.actions)||plan.actions.length>10)fail('Invalid fulfillment plan');
 if(new Set(plan.actions.map(a=>a?.id)).size!==plan.actions.length)fail('Duplicate fulfillment action');
 if(plan.actions.filter(a=>a?.type==='BOOKING_CREDITS').length>1)fail('Only one booking-credit action per plan is supported');
 for(const a of plan.actions){
  if(!a||!text(a.id)||!text(a.type)||Object.keys(a).some(k=>!['id','type','target'].includes(k)))fail('Invalid fulfillment action');
  if(a.type==='DURABLE_ACCESS'){
   const t=a.target;
   if(!t||Object.keys(t).some(k=>!['kind','id','tenantId','businessId'].includes(k))||!text(t.kind)||!text(t.id)||!sameScope(t,p))fail('Fulfillment target scope mismatch');
  }else if(a.target!==undefined)fail('Unexpected fulfillment target');
 }
 return structuredClone(plan);
}
const handlers={
 BOOKING_CREDITS:{
  fulfill(state,p,a,clock,authority){
   const o=p.terms,snapshot={id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds};
   const issuer=entitlementOperations(state,authority,clock,fail,bookingAccounting(state,authority,clock,fail),{paidProduct:snapshot});
   const grant=issuer.issue({productId:o.productId,participantId:p.participantId,issuanceRef:`purchase:${p.id}`,reason:'Verified purchase payment',requestId:clock.requestId});
   p.issuanceId=grant.id;p.validFrom=grant.validFrom;p.expiresAt=grant.expiresAt;
   return {issuanceId:grant.id,passId:grant.passId};
  },
  reverse(state,p,record){
   const units=(state.creditUnits||[]).filter(u=>u.entitlement?.issuanceId===record.outcome?.issuanceId);
   if(!units.length||units.some(u=>u.status!=='refunded'))fail('Existing booking refund must retire credits first');
  }
 },
 DURABLE_ACCESS:{
  fulfill(state,p,a,clock){
   state.accessEntitlements||=[];
   const actionId=key(p,a.id),prior=state.accessEntitlements.filter(e=>e.fulfillmentActionId===actionId);
   if(prior.length)fail('Unreconciled access entitlement already exists');
   const entitlement={id:actionId,fulfillmentActionId:actionId,purchaseId:p.id,principalId:p.buyerId,tenantId:p.tenantId,businessId:p.businessId,target:structuredClone(a.target),state:'active',createdAt:clock.now(),revokedAt:null,revocationRef:null};
   if(p.terms.rentalPolicy){
    if(a.target.kind!=='media_placement')fail('Rental requires media placement');
    const availability=(state.mediaAvailability||[]).find(x=>x.placementId===a.target.id&&sameScope(x,p));
    entitlement.rental=createRentalTerms(p.terms.rentalPolicy,{grantedAt:clock.now(),availableAt:availability?.availableAt??null});entitlement.revision=1;entitlement.corrections=[];
   }
   state.accessEntitlements.push(entitlement);return {entitlementId:entitlement.id};
  },
  reverse(state,p,record,at,ref){
   const rows=(state.accessEntitlements||[]).filter(e=>e.id===record.outcome?.entitlementId&&e.fulfillmentActionId===record.id&&e.purchaseId===p.id&&e.principalId===p.buyerId&&sameScope(e,p));
   if(rows.length!==1)fail('Access entitlement provenance mismatch');
   Object.assign(rows[0],{state:'revoked',revokedAt:at,revocationRef:ref});
  }
 }
};
// Called only inside the existing locked application-state transaction after
// payment validation. Handlers are local state transitions, never external I/O.
export function fulfillPurchase(state,purchaseId,authority,{id,now,requestId}){
 let p=state.purchaseDrafts.find(p=>p.id===purchaseId);
 if(!p||!sameScope(p,authority)||p.status!=='paid'||p.paymentStatus!=='succeeded'||!p.paymentConfirmedAt)fail('Finalized scoped purchase required');
 if(!(authority.role==='member'&&authority.userId===p.buyerId&&authority.participantIds?.length===1&&authority.participantIds[0]===p.participantId)&&!(authority.role==='staff'&&p.saleChannel==='front_desk'&&p.createdByStaffId))fail('Purchase principal mismatch');
 if((state.refundOperations||[]).some(r=>r.purchaseId===p.id&&sameScope(r,p)&&r.status!=='released'))fail('Purchase refund prevents fulfillment');
 if(p.fulfillmentStatus==='issued'&&!p.terms.fulfillmentPlan&&!state.fulfillmentActions?.some(x=>x.purchaseId===p.id))return {purchaseId:p.id,issuanceId:p.issuanceId,status:'issued'};
 const plan=fulfillmentPlan(p);
 state.fulfillmentActions||=[];
 let attempted=false;
 for(const action of plan.actions){
  p=state.purchaseDrafts.find(p=>p.id===purchaseId);
  const actionId=key(p,action.id),matches=state.fulfillmentActions.filter(x=>x.id===actionId);
  if(matches.length>1)fail('Duplicate fulfillment identity');
  let record=matches[0];
  if(record&&(record.planVersion!==plan.version||!equal(record.action,action)||!sameScope(record,p)||record.principalId!==p.buyerId||record.purchaseId!==p.id))fail('Frozen fulfillment action mismatch');
  if(record&&['fulfilled','revoked'].includes(record.status))continue;
  if(!record){record={id:actionId,purchaseId:p.id,principalId:p.buyerId,tenantId:p.tenantId,businessId:p.businessId,planVersion:plan.version,action:structuredClone(action),status:'pending',attempts:0,history:[]};state.fulfillmentActions.push(record);}
  attempted=true;record.attempts++;record.history.push({status:'pending',at:now()});
  const handler=Object.hasOwn(handlers,action.type)?handlers[action.type]:null;
  if(!handler){record.status='failed';record.error='unsupported_handler';record.history.push({status:'failed',reason:record.error,at:now()});continue;}
  // A failed local handler cannot leave partial credits/access behind. Other
  // completed actions remain committed and visible for an idempotent retry.
  const work=structuredClone(state),wp=work.purchaseDrafts.find(x=>x.id===purchaseId),wr=work.fulfillmentActions.find(x=>x.id===actionId);
  try{
   wr.outcome=handler.fulfill(work,wp,action,{id,now:()=>p.paymentConfirmedAt,requestId},authority);
   wr.status='fulfilled';delete wr.error;wr.history.push({status:'fulfilled',at:now()});
   work.activity.push({id:id(),action:'fulfillment-action-fulfilled',subjectId:p.id,fulfillmentActionId:actionId,handler:action.type,tenantId:p.tenantId,businessId:p.businessId,actorId:authority.userId,createdAt:now()});
   Object.assign(state,work);
  }catch{record.status='failed';record.error='handler_failed';record.history.push({status:'failed',reason:record.error,at:now()});}
 }
 p=state.purchaseDrafts.find(x=>x.id===purchaseId);
 if(attempted)p.fulfillmentRevision=(p.fulfillmentRevision||0)+1;
 const actions=plan.actions.map(a=>state.fulfillmentActions.find(x=>x.id===key(p,a.id)));
 p.fulfillmentStatus=actions.every(a=>a.status==='fulfilled')?'issued':actions.some(a=>a.status==='revoked')?'revoked':'pending';
 return {purchaseId:p.id,...(p.issuanceId?{issuanceId:p.issuanceId}:{}),status:p.fulfillmentStatus,actions:actions.map(a=>({id:a.id,type:a.action.type,status:a.status}))};
}
export function hasEntitlementProvenance(state,e){
 const principalId=e.principalId;
 if((state.accessEntitlements||[]).filter(x=>x.id===e.id).length!==1)return false;
 if(e.provenance?.kind==='staff_grant')return !!e.rental&&!!e.provenance.actorId&&!!e.provenance.reason&&(state.activity||[]).some(x=>x.action==='rental-complimentary-grant'&&x.subjectId===e.id&&x.actorId===e.provenance.actorId&&sameScope(x,e));
 const p=state.purchaseDrafts?.find(p=>p.id===e.purchaseId&&sameScope(p,e)&&p.buyerId===principalId&&p.status==='paid'&&p.paymentStatus==='succeeded');
 const a=state.fulfillmentActions?.find(a=>a.id===e.fulfillmentActionId&&a.purchaseId===e.purchaseId&&sameScope(a,e)&&a.principalId===principalId&&a.status==='fulfilled'&&a.action.type==='DURABLE_ACCESS'&&a.outcome?.entitlementId===e.id&&equal(a.action.target,e.target));
 if(!p||!a||e.id!==a.id||a.id!==key(p,a.action.id)||(state.fulfillmentActions||[]).filter(x=>x.id===a.id).length!==1)return false;
 try{if(!fulfillmentPlan(p).actions.some(action=>equal(action,a.action)))return false;}catch{return false;}
 return !(state.refundOperations||[]).some(r=>r.purchaseId===p.id&&sameScope(r,p)&&r.status==='completed');
}
export function hasDurableAccess(state,{principalId,tenantId,businessId,target,fulfillmentActionId,at=new Date().toISOString()}){
 return (state.accessEntitlements||[]).some(e=>{
  if(fulfillmentActionId&&e.fulfillmentActionId!==fulfillmentActionId)return false;
  if(e.state!=='active'||e.principalId!==principalId||e.tenantId!==tenantId||e.businessId!==businessId||!equal(e.target,target))return false;
  return hasEntitlementProvenance(state,e)&&rentalEligible(e,at);
 });
}
export function durableFulfillmentComplete(state,p){
 try{
  const plan=fulfillmentPlan(p),actions=plan.actions.filter(a=>a.type==='DURABLE_ACCESS');
  return actions.length>0&&plan.actions.every(a=>['BOOKING_CREDITS','DURABLE_ACCESS'].includes(a.type))&&actions.every(action=>{
   const records=(state.fulfillmentActions||[]).filter(r=>r.id===key(p,action.id));
   const grants=(state.accessEntitlements||[]).filter(e=>e.fulfillmentActionId===records[0]?.id);
   return records.length===1&&equal(records[0].action,action)&&grants.length===1&&hasEntitlementProvenance(state,grants[0]);
  });
 }catch{return false;}
}
// Existing refund coordinator remains the authority. No HTTP or caller-provided
// boolean can revoke grants: require its persisted completed refund operation.
export function reversePurchaseFulfillment(state,purchaseId,refundId,at){
 const p=state.purchaseDrafts?.find(p=>p.id===purchaseId),refund=state.refundOperations?.find(r=>r.id===refundId&&r.purchaseId===purchaseId&&r.status==='completed');
 if(!p||!refund||!sameScope(refund,p))fail('Completed canonical refund required');
 const work=structuredClone(state);
 for(const record of work.fulfillmentActions||[]){
  if(record.purchaseId!==p.id||!sameScope(record,p)||record.status==='revoked')continue;
  if(record.status==='fulfilled')handlers[record.action.type].reverse(work,p,record,at,refundId);
  record.status='revoked';record.history.push({status:'revoked',at,refundId});
 }
 Object.assign(state,work);
}
