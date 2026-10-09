import {isDeepStrictEqual as equal} from 'node:util';
import {fulfillmentPlan} from './fulfillment.mjs';
import {normalizeRentalPolicy} from './rental-policy.mjs';
import {observeRentalAvailability} from './rental-management.mjs';
const scope=(x,c)=>x?.tenantId===c?.tenantId&&x?.businessId===c?.businessId;
export const mediaAccessTarget=p=>({kind:'media_placement',id:p.id,tenantId:p.context.tenantId,businessId:p.context.businessId});
// Commerce links live in the business aggregate, never on canonical media.
export function mediaOffer(state,placement,{activeOnly=true}={}){
 const links=(state?.mediaCommerceLinks||[]).filter(l=>l.placementId===placement?.id&&scope(l,placement.context));
 if(links.length!==1)return null;
 const offers=(state.commerceOffers||[]).filter(o=>o.id===links[0].offerId&&o.version===links[0].offerVersion&&scope(o,placement.context));
 if(offers.length!==1)return null;
 const o=offers[0],availability=(state.commerceOfferAvailability||[]).filter(x=>x.offerId===o.id&&x.offerVersion===o.version&&scope(x,o));
 if(activeOnly&&(state.mediaAvailability||[]).some(x=>x.placementId===placement.id&&scope(x,o)&&x.status!=='published'))return null;
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
 const o=mediaOffer(state,placement);return o?{id:o.id,version:o.version,title:o.productName,priceMinor:o.priceMinor,currency:o.currency,tenantId:o.tenantId,businessId:o.businessId,...(o.rentalPolicy?{rentalPolicy:structuredClone(o.rentalPolicy)}:{})}:null;
}
export function configureMediaRentalOffer(state,body,a,material,{id,now},fail){
 if(Object.keys(body).some(k=>!['requestId','placementId','expectedRevision','expectedOfferVersion','title','priceMinor','currency','rentalPolicy'].includes(k)))fail('Unsupported rental offer fields',400);
 const p=material?.placement,r=material?.resource;
 if(a.role!=='staff'||!p||p.id!==body.placementId||p.revision!==body.expectedRevision||!scope(p.context,a)||!p.authorized||p.policy?.kind!=='pay_on_demand'||!r||r.id!==p.resourceId||r.owner?.kind!=='business'||!scope(r.owner,a)||r.lifecycle!=='active')fail('Current business-owned Pay on Demand media required',409);
 let rentalPolicy;try{rentalPolicy=normalizeRentalPolicy(body.rentalPolicy);}catch(error){fail(error.message,400);}
 if(!Number.isSafeInteger(body.priceMinor)||body.priceMinor<1||body.priceMinor>100000000||!/^[A-Z]{3}$/.test(body.currency||'')||typeof body.title!=='string'||!body.title.trim()||body.title.length>200)fail('Valid title, price and currency required',400);
 const previous=mediaOffer(state,p,{activeOnly:false}),offerId=id(),productId=id();
 if(body.expectedOfferVersion!==(previous?.version??0))fail('Offer changed. Refresh before saving.',409);
 if(!previous)fail('Attach an existing commerce offer before configuring its rental terms',409);
 const product={id:productId,name:body.title.trim(),type:'digital_access',quantity:1,validDays:null,categories:[],classIds:[]};
 const offer={...structuredClone(previous),id:offerId,version:previous.version+1,productId,productName:product.name,productType:product.type,quantity:1,validDays:null,categories:[],classIds:[],currency:body.currency,priceMinor:body.priceMinor,rentalPolicy};delete offer.active;
 state.commerceProducts||=[];state.commerceProducts.push(product);state.commerceOffers||=[];state.commerceOffers.push(offer);
 state.commerceOfferAvailability||=[];if(previous){const old=state.commerceOfferAvailability.find(x=>x.offerId===previous.id&&scope(x,a));if(old)old.active=false;}
 state.commerceOfferAvailability.push({offerId,offerVersion:offer.version,tenantId:a.tenantId,businessId:a.businessId,active:true});
 state.mediaCommerceLinks=[...(state.mediaCommerceLinks||[]).filter(x=>!(x.placementId===p.id&&scope(x,a))),{placementId:p.id,offerId,offerVersion:offer.version,tenantId:a.tenantId,businessId:a.businessId}];
 observeRentalAvailability(state,p,material.binding,now());
 state.activity.push({id:id(),action:'rental-offer-version-created',subjectId:p.id,actorId:a.userId,tenantId:a.tenantId,businessId:a.businessId,offerId,previousOfferId:previous?.id??null,createdAt:now(),requestId:body.requestId});
 return {placementId:p.id,offerId,offerVersion:offer.version,rentalPolicy};
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
