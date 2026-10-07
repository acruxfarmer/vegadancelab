import {ApplicationError} from './application.mjs';
import {entitlementActive} from './entitlements.mjs';

const fail=message=>{throw new ApplicationError(message,400);};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\u0000-\u001f]/.test(v);
export function placementContext(value){
 if(!value||Object.keys(value).some(k=>!['kind','tenantId','businessId'].includes(k))||value.kind!=='business'||!text(value.tenantId)||!text(value.businessId))fail('An existing business context is required');
 return {kind:'business',tenantId:value.tenantId,businessId:value.businessId};
}
export function placementPolicy(value,state){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Explicit access policy required');
 if(value.kind==='public'&&Object.keys(value).length===1)return {kind:'public'};
 if(value.kind!=='memberships'||Object.keys(value).some(k=>!['kind','productIds'].includes(k))||!Array.isArray(value.productIds)||!value.productIds.length||value.productIds.length>20||value.productIds.some(id=>!text(id))||new Set(value.productIds).size!==value.productIds.length)fail('Choose existing membership products');
 for(const id of value.productIds){const products=(state.entitlementProducts||[]).filter(p=>p.id===id);if(products.length!==1||products[0].type!=='membership')fail('Membership product unavailable in this context');}
 return {kind:'memberships',productIds:[...value.productIds].sort()};
}
// Qualification only: use the established validity helper on the authoritative
// issuance, corroborated by its membership period. Never read credit balances.
export function qualifiesForMembership(state,participantIds,productIds,at){
 return (state.memberships||[]).some(m=>participantIds.includes(m.participantId)&&productIds.includes(m.productId)&&
  (state.entitlementProducts||[]).filter(p=>p.id===m.productId&&p.type==='membership').length===1&&
  Array.isArray(m.periods)&&m.periods.some(period=>{
   const grants=(state.entitlementIssuances||[]).filter(g=>g.id===period.issuanceId);
   if(grants.length!==1)return false;
   const g=grants[0];
   return g.membershipId===m.id&&g.participantId===m.participantId&&g.productId===m.productId&&g.productSnapshot?.type==='membership'&&
    typeof g.validFrom==='string'&&typeof g.expiresAt==='string'&&period.startsAt===g.validFrom&&period.endsAt===g.expiresAt&&
    entitlementActive({entitlement:{validFrom:g.validFrom,expiresAt:g.expiresAt}},at);
  }));
}
