import {createNativeMediaRepository} from './native-media-repository.mjs';
import {resolveMediaViewerAccess,rentalViewerProjection,applyRentalAvailability} from '../media-viewer-access.mjs';
import {requireReadyMediaBinding} from '../media-provider-binding.mjs';
import {ApplicationError} from '../application.mjs';
import {mediaOfferSummary} from '../media-commerce.mjs';
export function createNativeMediaDelivery(pool,{adapters={}}={}){
 const repository=createNativeMediaRepository(pool);
 return {resolve:(viewerId,placementId,play=false)=>repository.viewer(viewerId,placementId,async source=>{
  const material=source?{...source,...(source.state?{state:structuredClone(source.state)}:{})}:source;
  if(!material?.resource)return null;
  applyRentalAvailability(material.state,material.placement,material.binding);
  let ready=false;try{requireReadyMediaBinding(material.resource,material.binding);ready=true;}catch{}
  const decision=resolveMediaViewerAccess({placement:material.placement,resourceId:material.resource.id,resourceAvailable:ready,viewerId,authority:material.authority,state:material.state,at:new Date().toISOString()});
  const r=material.resource;
  const metadata={title:r.title,description:r.description||'',creator:r.creator||'',poster:'/media-poster.svg',availability:({public:'ALL',memberships:'MEMBERS',pay_on_demand:'PAY_ON_DEMAND'})[material.placement.policy?.kind]||null,readiness:ready?'ready':'processing'};
  if(!play){const rental=rentalViewerProjection({...material,viewerId,at:new Date().toISOString()});return {decision,metadata,...(rental?{rental}:{}),...(material.placement.policy?.kind==='pay_on_demand'?{offer:mediaOfferSummary(material.commerceState,material.placement)}:{})};}
  if(!decision.allowed){const e=new ApplicationError('This video is unavailable for your account.',decision.reason==='authentication_required'?401:403);e.mediaReason=decision.reason;throw e;}
  // Rental tickets must be persisted and reconciled by the rental session command.
  // The legacy stateless delivery endpoint must never bypass that boundary.
  if(decision.rental)throw new ApplicationError('Use the protected rental viewing session',409);
  const adapter=adapters[material.binding.provider];if(!adapter)throw new ApplicationError('Media delivery temporarily unavailable',503);
  return adapter.authorize(material.binding);
 })};
}
