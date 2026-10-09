// Temporary, code-pinned Development verification scope. No general enable switch.
export const rentalVerification = Object.freeze({
 reference:'vod-rental-development-verification-v1',
 serviceId:'srv-dao5cjbm8hqs73db51j0', hostname:'vega-development-web.onrender.com',
 tenantId:'vega-development',businessId:'vega-dance-lab',
 actorId:'4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',
 resourceId:'6c3a7236-9132-4be8-a64a-f4b6f80db360',
 placementId:'2960abdf-bfb3-49b1-87db-f9f95011d47f',
 bindingId:'348eac96-fc56-45a0-807d-c32d5056f7d5',
 entitlementId:'7566b16f-5d71-4c72-9ec5-6b0355a5d9f1',
 expiresAt:'2026-10-10T23:59:00.000Z'
});
export function createRentalVerificationControl(env,now=Date.now){
 const p=rentalVerification;
 // Platform identity and the existing database layer's pinned Development project
 // complement VEGA_ENV; copying the enable value to Production is insufficient.
 const configured=env.VEGA_ENV==='development'&&env.RENDER==='true'&&
  env.RENDER_SERVICE_ID===p.serviceId&&env.RENDER_EXTERNAL_HOSTNAME===p.hostname&&
  env.VEGA_RENTAL_VERIFICATION===p.expiresAt;
 return scope=>configured&&scope?.businessOwned===true&&Number.isFinite(now())&&now()<Date.parse(p.expiresAt)&&
  ['tenantId','businessId','actorId','resourceId','placementId','bindingId','entitlementId'].every(k=>scope?.[k]===p[k])
  ?{protectedHls:true,rentalAccessVerified:true,evidenceReference:p.reference,expiresAt:p.expiresAt}
  :{protectedHls:true,rentalAccessVerified:false,evidenceReference:null};
}
