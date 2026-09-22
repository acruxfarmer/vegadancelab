import {entitlementActive} from './entitlements.mjs';

// Input is the already authority-filtered member view, never the staff audit log.
export function memberAccountSummary(view,at){
 const passes=view.passes.map(p=>{
  const units=view.creditUnits.filter(u=>u.passId===p.id&&u.participantId===p.participantId&&u.status==='available');
  const available=units.filter(u=>entitlementActive(u,at));
  return {passId:p.id,available:available.length,unspent:units.length,
   expired:units.filter(u=>u.entitlement?.expiresAt&&Date.parse(at)>=Date.parse(u.entitlement.expiresAt)).length,
   future:units.filter(u=>u.entitlement?.validFrom&&Date.parse(at)<Date.parse(u.entitlement.validFrom)).length,
   restored:available.filter(u=>u.originBookingId).length};
 });
 return {checkedAt:at,available:passes.reduce((n,p)=>n+p.available,0),passes};
}
