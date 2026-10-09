import {placementRights,effectivePlacementRights,delegatedAccessAllowed,sameAccess} from '../media-placement-rights.mjs';
import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../application.mjs';
import {placementContext,placementPolicy} from '../media-placement.mjs';
import {resolveMediaViewerAccess} from '../media-viewer-access.mjs';

const fail=(m,status=403)=>{throw new ApplicationError(m,status);};
// Server-only configuration/service surface, using the same verified principal
// contract as the resource foundation. No caller-supplied roles or participants.
export function createMediaPlacementService({authenticate,repository,now=()=>new Date().toISOString(),id=randomUUID}){
 const run=async(request,fn,publicRead=false)=>{
  const principal=publicRead&&request==null?null:await authenticate(request);
  if((!publicRead||request!=null)&&(!principal?.userId||principal.anonymous))fail('Sign in to continue',401);
  return repository.transaction(principal?.userId||'',tx=>fn(tx,principal?.userId));
 };
 const owner=async(tx,actor,r)=>{
  if(!r)fail('Resource unavailable',404);
  if(r.owner.kind==='user'?r.owner.userId!==actor:!await tx.canManageBusiness(r.owner))fail('Resource owner access required');
 };
 const audit=(tx,p,actor,action)=>tx.audit({placementId:p.id,actorId:actor,action,revision:p.revision,createdAt:now(),details:{policy:p.policy,rights:p.rights||null}});
 return {
  ownerPolicy:(request,placementId,expectedRevision,input)=>run(request,async(tx,actor)=>{
   const p=await tx.get(placementId);if(!p)fail('Placement unavailable',404);
   const r=await tx.resource(p.resourceId);
   await owner(tx,actor,r);
   if(!p.authorized||r.lifecycle!=='active')fail('Placement is inactive',409);
   if(p.revision!==expectedRevision)fail('Placement changed; refresh before saving',409);
   if(!input||Object.keys(input).some(k=>k!=='policy'))fail('Only Access Availability may be changed',400);
   // This narrow validator never returns business state or member records.
   const policy=await tx.validateOwnerPolicy(p.id,input.policy);
   const next={...p,policy,...(p.rights?{rights:{...p.rights,access:{...p.rights.access,ceiling:policy}}}:{}),revision:p.revision+1};
   await tx.update(next);await audit(tx,next,actor,'configured');return next;
  }),
  rights:(request,placementId,expectedRevision,input)=>run(request,async(tx,actor)=>{
   const p=await tx.get(placementId);if(!p)fail('Placement unavailable',404);
   const r=await tx.resource(p.resourceId);await owner(tx,actor,r);
   if(!p.authorized||r.lifecycle!=='active')fail('Placement is inactive',409);
   if(p.revision!==expectedRevision)fail('Placement changed; refresh before saving',409);
   const rights=placementRights(input,p.policy);
   const next={...p,rights,visible:rights.present?p.visible:false,revision:p.revision+1};
   await tx.update(next);await audit(tx,next,actor,!p.rights?'rights_granted':rights.access.mode==='none'&&p.rights.access.mode!=='none'?'rights_revoked':'rights_changed');return next;
  }),
  authorize:(request,resourceId,context,initialPolicy)=>run(request,async(tx,actor)=>{
   context=placementContext(context);const r=await tx.resource(resourceId);await owner(tx,actor,r);
   if(r.lifecycle!=='active')fail('Resource is inactive',409);
   await tx.lock(resourceId,context);
   const existing=await tx.find(resourceId,context);
   if(existing){if(!existing.authorized)fail('Placement was withdrawn; explicit reauthorization is not supported in this slice',409);return existing;}
   const policy=placementPolicy(initialPolicy,initialPolicy?.kind==='memberships'?await tx.businessState(context):{});
   const p={id:id(),resourceId,context,authorized:true,authorizedBy:actor,authorizedAt:now(),withdrawnAt:null,visible:false,policy,categoryIds:[],collectionIds:[],revision:1};
   await tx.insert(p);await audit(tx,p,actor,'authorized');return p;
  }),
  configure:(request,placementId,expectedRevision,input)=>run(request,async(tx,actor)=>{
   const p=await tx.get(placementId);if(!p)fail('Placement unavailable',404);
   if(!await tx.canManageBusiness(p.context))fail('Context media management required');
   if(!p.authorized||!await tx.resourceActive(p.id))fail('Placement is inactive',409);
   if(p.revision!==expectedRevision)fail('Placement changed; refresh before saving',409);
   if(!input||Object.keys(input).some(k=>!['visible','policy','categoryIds','collectionIds'].includes(k))||typeof input.visible!=='boolean')fail('Unsupported placement configuration',400);
   const state=await tx.businessState(p.context),policy=placementPolicy(input.policy,state);
   const r=await tx.resource(p.resourceId),o=r?.owner;
   const sameBusiness=o?.kind==='business'&&o.tenantId===p.context.tenantId&&o.businessId===p.context.businessId;
   const samePolicy=sameAccess(policy,p.policy),rights=effectivePlacementRights(p);
   if(input.visible&&!rights.present)fail('Presentation is not granted by the resource owner');
   if(!sameBusiness&&!samePolicy&&!delegatedAccessAllowed(p,policy))fail('Access Availability exceeds resource owner delegation');
   const groups={};
   for(const [key,kind] of [['categoryIds','category'],['collectionIds','collection']]){
    const values=input[key]??[];
    if(!Array.isArray(values)||values.length>20||new Set(values).size!==values.length||values.some(id=>!(state.mediaGroups||[]).some(g=>g.id===id&&g.kind===kind&&g.tenantId===p.context.tenantId&&g.businessId===p.context.businessId)))fail('Choose organization from this context',400);
    groups[key]=[...values];
   }
   if(!rights.organize&&['categoryIds','collectionIds'].some(k=>JSON.stringify([...groups[k]].sort())!==JSON.stringify([...p[k]].sort())))fail('Local organization is not granted by the resource owner');
   const next={...p,...groups,policy,visible:input.visible,revision:p.revision+1};
   await tx.update(next);await audit(tx,next,actor,!sameBusiness&&!samePolicy?'delegated_access_changed':'configured');return next;
  }),
  withdraw:(request,placementId,expectedRevision)=>run(request,async(tx,actor)=>{
   const p=await tx.get(placementId);if(!p)fail('Placement unavailable',404);
   await owner(tx,actor,await tx.resource(p.resourceId));
   if(p.revision!==expectedRevision)fail('Placement changed; refresh before withdrawing',409);
   if(!p.authorized)return p;
   const next={...p,authorized:false,visible:false,withdrawnAt:now(),revision:p.revision+1};
   await tx.update(next);await audit(tx,next,actor,'withdrawn');return next;
  }),
  access:(request,placementId)=>run(request,async(tx,viewerId)=>{
   const p=await tx.get(placementId,false);
   if(!p||!p.authorized||!p.visible||!await tx.resourceActive(p.id))return {allowed:false};
   const a=p.policy.kind==='public'?null:await tx.member(p.context);
   const state=a?await tx.businessState(p.context):undefined;
   // Compatibility preflight delegates policy meaning to the canonical engine.
   // This remains a non-transferable decision, not a playback authorization token.
   const result=resolveMediaViewerAccess({placement:p,resourceAvailable:true,viewerId,authority:a,state,at:now()});
   return result.allowed?{allowed:true,placementId:p.id,resourceId:p.resourceId}:{allowed:false};
  },true)
 };
}
