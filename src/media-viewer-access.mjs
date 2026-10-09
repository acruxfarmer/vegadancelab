import {placementContext,placementPolicy,qualifiesForMembership} from './media-placement.mjs';
import {mediaEligible} from './media.mjs';
import {hasDurableAccess} from './fulfillment.mjs';
import {mediaAccessTarget} from './media-commerce.mjs';

export const MEDIA_ACCESS_REASONS=Object.freeze(['public_access','qualifying_membership','durable_access','authentication_required','membership_required','membership_not_current','paid_access_required','placement_unavailable','resource_unavailable','access_policy_invalid']);
const decision=(allowed,reason)=>({allowed,reason});
// Canonical, presentation-free qualification decision. State is supplied only by
// the scoped server adapter, never by HTTP payloads or editable identity claims.
export function resolveMediaViewerAccess({placement,resourceAvailable,viewerId,authority,state,at,resourceId}){
 if(!placement||placement.authorized!==true||placement.visible!==true||resourceId&&resourceId!==placement.resourceId)return decision(false,'placement_unavailable');
 try{placementContext(placement.context);}catch{return decision(false,'placement_unavailable');}
 if(resourceAvailable!==true)return decision(false,'resource_unavailable');
 const policy=placement.policy;
 if(policy?.kind==='pay_on_demand'){
  if(Object.keys(policy).length!==1)return decision(false,'access_policy_invalid');
  if(!viewerId||!authority||authority.userId!==viewerId||authority.tenantId!==placement.context.tenantId||authority.businessId!==placement.context.businessId)return decision(false,'paid_access_required');
  return hasDurableAccess(state||{},{principalId:viewerId,tenantId:placement.context.tenantId,businessId:placement.context.businessId,target:mediaAccessTarget(placement)})?decision(true,'durable_access'):decision(false,'paid_access_required');
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
