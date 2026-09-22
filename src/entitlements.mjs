const validText=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function eligibleCredits(state,c,participantId,at,passId){
 return (state.creditUnits||[]).filter(u=>u.participantId===participantId&&u.status==='available'&&(!passId||u.passId===passId)&&entitlementEligible(u,c,at)).sort((a,b)=>(Date.parse(a.entitlement?.expiresAt)||Infinity)-(Date.parse(b.entitlement?.expiresAt)||Infinity));
}
export function entitlementEligible(unit,c,at){
 const e=unit.entitlement;
 if(!entitlementActive(unit,at,c.startsAt))return false;
 if(!e)return true;
 if(e.categories?.length&&!e.categories.includes(c.category))return false;
 if(e.classIds?.length&&!e.classIds.includes(c.id))return false;
 return true;
}
// Shared validity window for the booking selector and read-only account summary.
export function entitlementActive(unit,at,startsAt=at){
 const e=unit.entitlement;
 if(!e)return true; // Existing credits retain their original unrestricted terms.
 const now=Date.parse(at),start=Date.parse(startsAt);
 if(!Number.isFinite(now)||!Number.isFinite(start))return false;
 if(e.validFrom&&(now<Date.parse(e.validFrom)||start<Date.parse(e.validFrom)))return false;
 if(e.expiresAt&&(now>=Date.parse(e.expiresAt)||start>=Date.parse(e.expiresAt)))return false;
 return true;
}
export function entitlementOperations(state,authority,{id,now},fail,accounting){
 state.entitlementProducts ||= [];state.entitlementIssuances ||= [];state.memberships ||= [];
 function product(body){
  if(!validText(body.name)||!['drop_in','class_pack','membership','courtesy'].includes(body.type))fail('Product name and type required');
  if(!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>100||(body.type==='drop_in'&&body.quantity!==1))fail('Invalid product credit quantity');
  const days=body.validDays??null;
  if((days!==null&&(!Number.isInteger(days)||days<1||days>3660))||(body.type==='membership'&&days===null))fail('Validity days required for membership; otherwise 1–3660 or blank');
  const categories=body.categories??[],classIds=body.classIds??[];
  if(!Array.isArray(categories)||categories.length>30||categories.some(v=>!validText(v,100))||!Array.isArray(classIds)||classIds.length>100||classIds.some(v=>!state.classes.some(c=>c.id===v)))fail('Invalid class restrictions');
  const p={id:id(),name:body.name.trim(),type:body.type,quantity:body.quantity,validDays:days,categories:[...new Set(categories)],classIds:[...new Set(classIds)],createdAt:now(),createdBy:authority.userId};
  state.entitlementProducts.push(p);return p;
 }
 function issue(body){
  const p=state.entitlementProducts.find(p=>p.id===body.productId);
  if(!p)fail('Entitlement product unavailable',404);
  if(!validText(body.issuanceRef,128)||!validText(body.reason,1000))fail('Unique issuance reference and reason required');
  const ref=body.issuanceRef.trim(),membership=p.type==='membership';
  if(membership&&!validText(body.membershipRef,128))fail('Membership reference required');
  const memberRef=membership?body.membershipRef.trim():null;
  const period=membership?body.periodStart:null;
  if(membership&&(!validText(period)||!Number.isFinite(Date.parse(period))))fail('Membership period start required');
  const periodStart=membership?new Date(period).toISOString():null;
  const intent=JSON.stringify({productId:p.id,participantId:body.participantId,membershipRef:memberRef,periodStart});
  const prior=state.entitlementIssuances.find(x=>x.reference===ref);
  if(prior){if(prior.intent!==intent)fail('Issuance reference already belongs to a different grant',409);return {...prior,outcome:'already_issued'};}
  const stamp=now(),validFrom=periodStart||stamp;
  const expiresAt=p.validDays?new Date(Date.parse(validFrom)+p.validDays*86400000).toISOString():null;
  let m;
  if(membership){
   m=state.memberships.find(m=>m.reference===memberRef);
   if(m&&(m.participantId!==body.participantId||m.productId!==p.id))fail('Membership reference belongs to another account or product',409);
   if(m?.periods.some(x=>x.startsAt===periodStart))fail('Membership period already issued',409);
   if(m?.periods.length&&periodStart!==m.periods.at(-1).endsAt)fail('Next membership period must begin at the prior period end',409);
   if(!m){m={id:id(),reference:memberRef,participantId:body.participantId,productId:p.id,periods:[],createdAt:stamp};state.memberships.push(m);}
  }
  const grantId=id(),source=p.type==='courtesy'?'staff_courtesy':'simulated_purchase';
  const entitlement={issuanceId:grantId,productId:p.id,productName:p.name,productType:p.type,source,membershipId:m?.id??null,validFrom,expiresAt,categories:p.categories,classIds:p.classIds};
  const pass=accounting.issue({participantId:body.participantId,quantity:p.quantity,reason:body.reason,requestId:body.requestId,label:p.name,entitlement});
  const grant={id:grantId,reference:ref,intent,participantId:body.participantId,productId:p.id,productSnapshot:structuredClone(p),membershipId:m?.id??null,passId:pass.id,quantity:p.quantity,source,validFrom,expiresAt,actorId:authority.userId,reason:body.reason,createdAt:stamp};
  state.entitlementIssuances.push(grant);
  if(m)m.periods.push({startsAt:validFrom,endsAt:expiresAt,issuanceId:grantId});
  return {...grant,outcome:'issued'};
 }
 return {product,issue};
}
