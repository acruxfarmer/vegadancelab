import {ApplicationError} from './application.mjs';
import {hasEntitlementProvenance} from './fulfillment.mjs';
const same=(x,a)=>x?.tenantId===a.tenantId&&x?.businessId===a.businessId;
export function mediaAvailability(state,placementId,authority){return (state.mediaAvailability||[]).find(x=>x.placementId===placementId&&(!authority||same(x,authority)))||{placementId,status:'published',revision:0,availableAt:null};}
export function mayDiscoverRentalPlacement(state,authority,placementId){
 if(mediaAvailability(state,placementId,authority).status==='published'||authority.role==='staff')return true;
 // Holders keep their personal library/history while discovery stops for others.
 return (state.accessEntitlements||[]).some(e=>same(e,authority)&&e.principalId===authority.userId&&e.target?.kind==='media_placement'&&e.target.id===placementId&&e.state==='active'&&hasEntitlementProvenance(state,e));
}
// Capture provider readiness during an authorized owner operation, never on a viewer visit.
export function observeRentalAvailability(state,placement,binding,at,{publishedObservation=false}={}){
 const prior=mediaAvailability(state,placement.id,placement.context);
 if(binding?.state!=='ready'||['suspended','withdrawn'].includes(prior.status))return prior.availableAt;
 const ready=Date.parse(binding.readyAt),current=Date.parse(prior.availableAt),observed=Date.parse(at);
 const actual=Number.isFinite(ready)&&ready<=observed?ready:publishedObservation?observed:NaN;
 if(!Number.isFinite(actual))return prior.availableAt;
 const availableAt=new Date(Number.isFinite(current)?Math.max(current,actual):actual).toISOString();
 const next={...prior,tenantId:placement.context.tenantId,businessId:placement.context.businessId,availableAt};
 state.mediaAvailability=(state.mediaAvailability||[]).filter(x=>!(x.placementId===placement.id&&same(x,placement.context)));state.mediaAvailability.push(next);return availableAt;
}
export function changeRentalAvailability(state,body,a,material,{id,now}){
 const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
 if(a.role!=='staff')fail('Business staff required',403);
 if(Object.keys(body).some(k=>!['requestId','placementId','expectedRevision','availability','reason'].includes(k)))fail('Unsupported availability request');
 const p=material?.placement,r=material?.resource;
 if(!p||p.id!==body.placementId||!same(p.context,a)||!p.authorized||r?.id!==p.resourceId||r?.owner?.kind!=='business'||!same(r.owner,a))fail('Business-owned placement required',403);
 if(!['published','unpublished','suspended','withdrawn'].includes(body.availability)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)fail('Choose availability and enter a reason');
 const prior=mediaAvailability(state,p.id,a);
 if(prior.revision!==body.expectedRevision)fail('Availability changed. Refresh before saving.',409);
 if(prior.status==='withdrawn')fail('This placement has been permanently withdrawn',409);
 const at=now(),next={placementId:p.id,tenantId:a.tenantId,businessId:a.businessId,status:body.availability,revision:prior.revision+1,availableAt:prior.availableAt,updatedAt:at};
 state.mediaAvailability=(state.mediaAvailability||[]).filter(x=>!(x.placementId===p.id&&same(x,a)));state.mediaAvailability.push(next);
 if(body.availability==='published')next.availableAt=observeRentalAvailability(state,p,material.binding,at,{publishedObservation:true});
 (state.activity??=[]).push({id:id(),action:'rental-availability',actorId:a.userId,subjectId:p.id,tenantId:a.tenantId,businessId:a.businessId,requestId:body.requestId,reason:body.reason.trim(),before:structuredClone(prior),after:structuredClone(next),createdAt:at});
 if(['suspended','withdrawn'].includes(next.status)){
  const grants=new Set((state.accessEntitlements||[]).filter(e=>same(e,a)&&e.target?.id===p.id).map(e=>e.id));
  // Temporary suspension stops delivery without turning a paused viewing into
  // a forbidden replay. The original session deadline continues to run.
  if(next.status==='withdrawn')for(const s of state.rentalPlaybackSessions||[])if(grants.has(s.entitlementId)){s.state='revoked';s.revokedAt=at;}
  for(const t of state.rentalPlaybackTickets||[])if(grants.has(t.entitlementId)&&t.state!=='revoked')t.state='revocation_pending';
 }
 return next;
}
