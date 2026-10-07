import {ApplicationError} from '../application.mjs';
import {newMediaResource,archiveMediaResource,resourceOwner} from '../media-resource.mjs';

const fail=(message,status=403)=>{throw new ApplicationError(message,status);};
// Server-only service. authenticate must verify the existing provider session;
// repository.transaction must atomically persist resources, links and audit.
// Neither interface is installed as a browser route in L6-S1A.
export function createMediaResourceFoundation({authenticate,repository}){
 const run=async(request,fn)=>{
  const principal=await authenticate(request);
  if(!principal?.userId||principal.anonymous===true)fail('Authenticated principal required',401);
  return repository.transaction(principal.userId,async tx=>fn(tx,principal.userId));
 };
 async function authorize(tx,actor,owner){
  owner=resourceOwner(owner);
  if(owner.kind==='user'){if(owner.userId!==actor)fail('Resource owner access required');}
  else if(!await tx.canManageBusiness(owner))fail('Business media management required');
 }
 const audit=(tx,actor,resource,action)=>tx.audit({actorId:actor,resourceId:resource.id,action,revision:resource.revision});
 return {
  create:(request,input)=>run(request,async(tx,actor)=>{
   await authorize(tx,actor,input.owner);
   if(input.source?.kind==='legacy_video')fail('Use verified legacy adoption for business video references',400);
   const resource=newMediaResource(input,actor);
   await tx.insert(resource);await audit(tx,actor,resource,'resource_created');return resource;
  }),
  readOwned:(request,id)=>run(request,async(tx,actor)=>{
   const resource=await tx.get(id);if(!resource)fail('Resource unavailable',404);
   await authorize(tx,actor,resource.owner);return resource;
  }),
  archive:(request,id,expectedRevision)=>run(request,async(tx,actor)=>{
   const resource=await tx.get(id);if(!resource)fail('Resource unavailable',404);
   await authorize(tx,actor,resource.owner);
   // Do not silently diverge from active Layer 5 copies. Coordinated withdrawal
   // belongs to the later lifecycle bridge; standalone resources can archive now.
   if(await tx.hasLegacyLinks(id))fail('Linked business media requires coordinated withdrawal; not available in this foundation.',409);
   const next=archiveMediaResource(resource,expectedRevision);
   if(next.revision!==resource.revision){await tx.update(next);await audit(tx,actor,next,'resource_archived');}return next;
  }),
  adoptLegacy:(request,scope)=>run(request,async(tx,actor)=>{
   const owner=resourceOwner({kind:'business',tenantId:scope.tenantId,businessId:scope.businessId});
   await authorize(tx,actor,owner);
   const video=await tx.legacyVideo(scope);if(!video)fail('Existing business video unavailable',404);
   const prior=await tx.legacyResource(scope);if(prior)return prior;
   // Existing business control is recorded as platform resource ownership, not
   // a claim about copyright. Original uploader is unknown unless recorded.
   const resource=newMediaResource({owner,title:video.title,creator:video.creator||'',source:{kind:'legacy_video',provider:'business-media',reference:video.id}},actor);
   resource.provenance={kind:'legacy_adoption',originalSubmitter:video.submittedBy||null};
   await tx.insert(resource);await tx.linkLegacy(scope,resource.id);await audit(tx,actor,resource,'legacy_adopted');return resource;
  })
 };
}

// Separate, reusable existing-session verification. No role or ownership is read
// from user-editable metadata or client-supplied business headers.
export function createMediaPrincipalVerifier({authOrigin,publishableKey,fetcher=fetch}){
 const origin=new URL(authOrigin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!publishableKey)throw Error('Trusted authentication origin required');
 return async request=>{
  const token=request.headers?.authorization;
  if(typeof token!=='string'||!/^Bearer [A-Za-z0-9._-]+$/.test(token)||token.length>8192)fail('Sign in to continue',401);
  const response=await fetcher(`${origin.origin}/auth/v1/user`,{headers:{apikey:publishableKey,Authorization:token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail('Session unavailable',response.status>=500?503:401);
  const user=await response.json();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id||'')||user.is_anonymous===true)fail('Authenticated principal required',401);
  return {userId:user.id};
 };
}
