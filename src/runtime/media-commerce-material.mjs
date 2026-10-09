import {OFFER_ID} from '../commerce.mjs';
import {ApplicationError} from '../application.mjs';
import {mediaOffer} from '../media-commerce.mjs';
export async function publishedMediaOffers(c,state){
 const offers=[];
 for(const link of state.mediaCommerceLinks||[]){
  const material=(await c.query('select media_private.commerce_material($1) as material',[link.placementId])).rows[0]?.material;
  if(!material)continue;
  const offer=mediaOffer(state,material.placement);if(offer){const {active,...terms}=offer;offers.push(terms);}
 }
 return offers;
}
export async function mediaCommerceMaterial(c,state,command){
 if(command.action==='media-offer-attach'){
  const {rows}=await c.query('select p.document as placement,r.document as resource from media_private.placements p join media_private.resources r on r.id=p.resource_id where p.id=$1 for share of p,r',[command.body.placementId]);return rows[0];
 }
 if(command.action!=='purchase-draft'||command.body.offerId===OFFER_ID)return undefined;
 const links=(state.mediaCommerceLinks||[]).filter(l=>l.offerId===command.body.offerId);
 if(links.length!==1)throw new ApplicationError('Media offer unavailable',404);
 return (await c.query('select media_private.commerce_material($1) as material',[links[0].placementId])).rows[0]?.material;
}
