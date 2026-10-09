import {placementContext,placementPolicy,qualifiesForMembership} from './media-placement.mjs';
import {mediaEligible} from './media.mjs';
import {hasDurableAccess,hasEntitlementProvenance} from './fulfillment.mjs';
import {mediaAccessTarget} from './media-commerce.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
import {rentalStatus} from './rental-entitlement.mjs';
import {createRentalTerms} from './rental-policy.mjs';

// Hydrates only a server-read working copy from persisted readiness evidence;
// the session command commits the same immutable dates on the first mutation.
export function applyRentalAvailability(state,placement,binding){
 if(!state||!placement||binding?.state!=='ready')return;
 const availability=state.mediaAvailability?.find(a=>a.placementId===placement.id&&a.tenantId===placement.context.tenantId&&a.businessId===placement.context.businessId);
 const dates=[availability?.availableAt,binding.readyAt].filter(Boolean).map(Date.parse);
 if(!dates.length||dates.some(n=>!Number.isFinite(n)))return;
 for(const e of state.accessEntitlements||[])if(e.rental&&!e.rental.availableAt&&e.tenantId===placement.context.tenantId&&e.businessId===placement.context.businessId&&equal(e.target,mediaAccessTarget(placement))){const r=createRentalTerms(e.rental.policy,{grantedAt:e.createdAt,availableAt:new Date(Math.max(...dates)).toISOString()});e.rental.availableAt=r.availableAt;e.rental.startBy=r.startBy;}
}

export function rentalViewerProjection({state,placement,viewerId,authority,at}){
 if(!placement||!viewerId||authority?.userId!==viewerId||authority.tenantId!==placement.context.tenantId||authority.businessId!==placement.context.businessId)return null;
 const grants=(state?.accessEntitlements||[]).filter(e=>e.rental&&e.principalId===viewerId&&e.tenantId===placement.context.tenantId&&e.businessId===placement.context.businessId&&equal(e.target,mediaAccessTarget(placement)));
 const e=grants.find(e=>e.state==='active'&&hasDurableAccess(state,{principalId:viewerId,tenantId:e.tenantId,businessId:e.businessId,target:e.target,fulfillmentActionId:e.fulfillmentActionId,at}))||grants.find(e=>e.state==='active')||grants.at(-1);
 if(!e)return null;
 const availability=state.mediaAvailability?.find(a=>a.placementId===placement.id&&a.tenantId===e.tenantId&&a.businessId===e.businessId);
 return {entitlementId:e.id,status:rentalStatus(e,at),availability:availability?.status||'published',availableAt:e.rental.availableAt,startBy:e.rental.startBy,expiresAt:e.rental.expiresAt,policy:e.rental.policy,replayAllowed:e.rental.policy.replayAllowed,adjustments:(e.corrections||[]).map(c=>({action:c.operation,at:c.at}))};
}

export const MEDIA_ACCESS_REASONS=Object.freeze(['public_access','qualifying_membership','durable_access','authentication_required','membership_required','membership_not_current','paid_access_required','placement_unavailable','resource_unavailable','access_policy_invalid','media_suspended','media_withdrawn','rental_access']);
const decision=(allowed,reason)=>({allowed,reason});
// Canonical, presentation-free qualification decision. State is supplied only by
// the scoped server adapter, never by HTTP payloads or editable identity claims.
export function resolveMediaViewerAccess({placement,resourceAvailable,viewerId,authority,state,at,resourceId,availability}){
 if(!placement||placement.authorized!==true||placement.visible!==true||resourceId&&resourceId!==placement.resourceId)return decision(false,'placement_unavailable');
 try{placementContext(placement.context);}catch{return decision(false,'placement_unavailable');}
 if(resourceAvailable!==true)return decision(false,'resource_unavailable');
 if(availability?.status==='suspended'||availability?.status==='withdrawn')return decision(false,availability.status==='suspended'?'media_suspended':'media_withdrawn');
 const policy=placement.policy;
 if(policy?.kind==='pay_on_demand'){
  if(Object.keys(policy).length!==1)return decision(false,'access_policy_invalid');
  if(!viewerId||!authority||authority.userId!==viewerId||authority.tenantId!==placement.context.tenantId||authority.businessId!==placement.context.businessId)return decision(false,'paid_access_required');
  const current=state?.mediaAvailability?.find(x=>x.placementId===placement.id&&x.tenantId===placement.context.tenantId&&x.businessId===placement.context.businessId);
  if(current?.status==='suspended'||current?.status==='withdrawn')return decision(false,current.status==='suspended'?'media_suspended':'media_withdrawn');
  const target=mediaAccessTarget(placement),matching=(state?.accessEntitlements||[]).filter(e=>e.state==='active'&&e.principalId===viewerId&&e.tenantId===placement.context.tenantId&&e.businessId===placement.context.businessId&&equal(e.target,target)&&hasEntitlementProvenance(state,e));
  if(matching.some(e=>!e.rental))return decision(true,'durable_access');
  if(hasDurableAccess(state||{},{principalId:viewerId,tenantId:placement.context.tenantId,businessId:placement.context.businessId,target,at}))return {...decision(true,'rental_access'),rental:true};
  return decision(false,'paid_access_required');
 }
 if(policy?.kind==='public'){
  try{placementPolicy(policy,{});return decision(true,'public_access');}catch{return decision(false,'access_policy_invalid');}
 }
 if(!policy||policy.kind!=='memberships'||!Array.isArray(policy.productIds)||!policy.productIds.length||policy.productIds.length>20||new Set(policy.productIds).size!==policy.productIds.length||Object.keys(policy).some(k=>!['kind','productIds'].includes(k)))return decision(false,'access_policy_invalid');
 if(!viewerId)return decision(false,'authentication_required');
 if(!authority||authority.userId!==viewerId||authority.tenantId!==placement.context.tenantId||authority.businessId!==placement.context.businessId||authority.role!=='member')return decision(false,'membership_required');
 try{
  placementPolicy(policy,state);
  if(!mediaEligible(state,authority))return decision(false,'membership_required');
  if(qualifiesForMembership(state,authority.participantIds,policy.productIds,at))return decision(true,'qualifying_membership');
  const matching=(state.memberships||[]).some(m=>authority.participantIds.includes(m.participantId)&&policy.productIds.includes(m.productId));
  return decision(false,matching?'membership_not_current':'membership_required');
 }catch{return decision(false,'access_policy_invalid');}
}
