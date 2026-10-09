import {isDeepStrictEqual as equal} from 'node:util';
import {fulfillmentPlan} from './fulfillment.mjs';
const scope=(x,c)=>x?.tenantId===c?.tenantId&&x?.businessId===c?.businessId;
export const mediaAccessTarget=p=>({kind:'media_placement',id:p.id,tenantId:p.context.tenantId,businessId:p.context.businessId});
// Commerce links live in the business aggregate, never on canonical media.
export function mediaOffer(state,placement,{activeOnly=true}={}){
 const links=(state?.mediaCommerceLinks||[]).filter(l=>l.placementId===placement?.id&&scope(l,placement.context));
 if(links.length!==1)return null;
 const offers=(state.commerceOffers||[]).filter(o=>o.id===links[0].offerId&&o.version===links[0].offerVersion&&scope(o,placement.context));
 if(offers.length!==1)return null;
 const o=offers[0],availability=(state.commerceOfferAvailability||[]).filter(x=>x.offerId===o.id&&x.offerVersion===o.version&&scope(x,o));
 if(availability.length!==1||activeOnly&&availability[0].active!==true)return null;
 try{
  const plan=fulfillmentPlan({terms:o,...placement.context});
  if(plan.actions.length!==1||plan.actions[0].type!=='DURABLE_ACCESS'||!equal(plan.actions[0].target,mediaAccessTarget(placement)))return null;
 }catch{return null;}
 if(o.productType!=='digital_access'||!Number.isSafeInteger(o.priceMinor)||o.priceMinor<=0||!/^[A-Z]{3}$/.test(o.currency)||o.tax?.amountMinor!==0)return null;
 return {...o,active:availability[0].active};
}
export function mediaOfferSummary(state,placement){
 if(!placement?.authorized||!placement.visible||placement.policy?.kind!=='pay_on_demand')return null;
 const o=mediaOffer(state,placement);return o?{id:o.id,version:o.version,title:o.productName,priceMinor:o.priceMinor,currency:o.currency,tenantId:o.tenantId,businessId:o.businessId}:null;
}
export function attachMediaOffer(state,body,a,material,{id,now},fail){
 if(a.role!=='staff')fail('Business staff required',403);
 if(Object.keys(body).some(k=>!['requestId','placementId','offerId','expectedRevision'].includes(k)))fail('Unsupported offer link',400);
 const p=material?.placement,r=material?.resource;
 if(!p||p.id!==body.placementId||p.revision!==body.expectedRevision||!scope(p.context,a)||p.authorized!==true||p.policy?.kind!=='pay_on_demand'||!r||r.id!==p.resourceId||r.lifecycle!=='active'||r.owner.kind!=='business'||!scope(r.owner,a))fail('Choose current business-owned Pay on Demand media',409);
 const offers=(state.commerceOffers||[]).filter(o=>o.id===body.offerId&&scope(o,a));if(offers.length!==1)fail('Offer unavailable',404);
 const o=offers[0],link={placementId:p.id,offerId:o.id,offerVersion:o.version,tenantId:a.tenantId,businessId:a.businessId};
 const preview={...state,mediaCommerceLinks:[...(state.mediaCommerceLinks||[]).filter(l=>l.placementId!==p.id),link]};
 if(!mediaOffer(preview,p))fail('Choose an active offer for this exact placement',409);
 state.mediaCommerceLinks=preview.mediaCommerceLinks;
 state.activity.push({id:id(),action:'media-offer-attached',actorId:a.userId,subjectId:p.id,offerId:o.id,tenantId:a.tenantId,businessId:a.businessId,createdAt:now(),requestId:body.requestId});
 return {placementId:p.id,offerId:o.id};
}
