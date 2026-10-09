import {OFFER_ID} from '../commerce.mjs';
import {ApplicationError} from '../application.mjs';
import {mediaOffer} from '../media-commerce.mjs';
export async function publishedMediaOffers(c,state){
 const offers=[];
 for(const link of state.mediaCommerceLinks||[]){
  if((state.mediaAvailability||[]).some(x=>x.placementId===link.placementId&&x.status!=='published'))continue;
  const material=(await c.query('select media_private.commerce_material($1) as material',[link.placementId])).rows[0]?.material;
  if(!material)continue;
  const offer=mediaOffer(state,material.placement);if(offer){const {active,...terms}=offer;offers.push(terms);}
 }
 return offers;
}
export async function mediaCommerceMaterial(c,state,command){
 if(['media-offer-attach','rental-offer-configure','rental-correct','rental-availability'].includes(command.action)){
  const {rows}=await c.query('select p.document as placement,r.document as resource from media_private.placements p join media_private.resources r on r.id=p.resource_id where p.id=$1 for share of p,r',[command.body.placementId]);const material=rows[0];
  if(material&&command.action.startsWith('rental-')){const bindings=await c.query("select document from media_private.provider_bindings where resource_id=$1 and document->>'state'<>'deleted' for share",[material.resource.id]);if(bindings.rows.length===1)material.binding=bindings.rows[0].document;}
  if(material&&command.body.principalId){const people=await c.query('select user_id from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[command.body.principalId,material.placement.context.tenantId,material.placement.context.businessId]);material.recipientVerified=people.rows.length===1;}
  return material;
 }
 if(command.action!=='purchase-draft'||command.body.offerId===OFFER_ID)return undefined;
 const links=(state.mediaCommerceLinks||[]).filter(l=>l.offerId===command.body.offerId);
 if(links.length!==1)throw new ApplicationError('Media offer unavailable',404);
 return (await c.query('select media_private.commerce_material($1) as material',[links[0].placementId])).rows[0]?.material;
}
