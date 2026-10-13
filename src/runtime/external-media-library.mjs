import {ApplicationError} from '../application.mjs';
import {newMediaResource} from '../media-resource.mjs';
import {externalMediaId,externalPage,externalPolicy,externalPresentation} from '../external-media.mjs';
import {createMediaResourceRepository} from './media-resource-repository.mjs';
import {createMediaPlacementRepository} from './media-placement-repository.mjs';
import {createMediaPlacementService} from './media-placement-service.mjs';
import {resolveMediaViewerAccess} from '../media-viewer-access.mjs';

const fail=(message,status=403)=>{throw new ApplicationError(message,status);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const cacheLifetimeMs=29*24*60*60*1000;
// Retention continues even when discovery/viewing is disabled. This bounded
// application lifecycle task has no connection workflow or network capability.
export function startExternalMetadataExpiry(pool,{schedule=setTimeout,cancel=clearTimeout,onError=()=>console.error('External metadata expiry failed')}={}){
 let timer,stopped=false,running;
 const clean=()=>pool.query('select media_private.expire_external_metadata()');
 const arm=()=>{if(!stopped){timer=schedule(()=>{running=clean().catch(onError).finally(arm);},3600000);timer?.unref?.();}};
 const ready=(async()=>{
  const result=await pool.query("select to_regprocedure('media_private.expire_external_metadata()') is not null as available");
  if(result.rows[0]?.available){await clean();arm();}
 })();
 return {ready,async stop(){stopped=true;cancel(timer);await ready.catch(()=>{});await running;}};
}
export function cachedSource(row,now=Date.now()){
 return row?.metadata&&Date.parse(row.expires_at)>now?row.metadata:null;
}
export function externalMetadata(resource,cache){
 return {title:resource.presentationEdited?resource.title:cache?.title||resource.title,creator:resource.presentationEdited?resource.creator:cache?.creator||'',description:'Externally hosted media. Acrux access does not restrict direct access at the source.',poster:'/media-poster.svg',sourceProvider:resource.source.provider,sourceState:cache?.status||'metadata_expired'};
}
export function createExternalMediaLibrary(pool,{connections,initialOwners=[],now=Date.now}={}){
 async function transaction(actor,work){
  const c=await pool.connect();
  try{await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actor||'']);const result=await work(c);await c.query('commit');return result;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
 }
 const nested=c=>({connect:async()=>({release(){},async query(sql,args){if(['begin','commit'].includes(sql))return {rows:[]};if(sql==='rollback')return {rows:[]};return c.query(sql,args);}})});
 async function authority(c,identity){
  if(!identity||!uuid(identity.userId)||typeof identity.tenantId!=='string'||typeof identity.businessId!=='string')fail('Choose an authorized business');
  const repository=createMediaResourceRepository(nested(c),{initialOwners});
  const allowed=await repository.transaction(identity.userId,tx=>tx.canManageBusiness({kind:'business',tenantId:identity.tenantId,businessId:identity.businessId}));
  if(!allowed)fail('Business media management required');
 }
 async function binding(c,identity,provider,accountId){
  await authority(c,identity);
  const {rows}=await c.query('select document from media_private.source_connections where tenant_id=$1 and business_id=$2 and provider=$3 for share',[identity.tenantId,identity.businessId,provider]);
  const row=rows[0]?.document;
  if(!row?.sealedCredentials||!['connected','unavailable'].includes(row.status)||row.accountId!==accountId)fail('Connection changed; refresh before continuing',409);
 }
 async function registered(c,identity,provider,id){
  return (await c.query('select r.document as resource,e.* from media_private.external_media_cache e join media_private.resources r on r.id=e.resource_id where e.tenant_id=$1 and e.business_id=$2 and e.provider=$3 and e.media_id=$4 for update of e,r',[identity.tenantId,identity.businessId,provider,id])).rows[0];
 }
 const projection=row=>({resourceId:row.resource.id,revision:row.revision,source:cachedSource(row,now()),sourceState:cachedSource(row,now())?.status||'metadata_expired'});
 return {
  async discover(identity,provider,page=''){
   externalPage(provider,page);
   const result=await connections.workflow.libraryRead(identity,provider,'discover',page);
   return transaction(identity.userId,async c=>{
    await binding(c,identity,provider,result.accountId);
    const items=[];
    for(const item of result.data.items){const existing=await registered(c,identity,provider,item.id);items.push({...item,registered:!!existing,...(existing?{resourceId:existing.resource.id}:{})});}
    return {items,nextPage:result.data.nextPage};
   });
  },
  async register(identity,provider,id){
   externalMediaId(provider,id);
   const result=await connections.workflow.libraryRead(identity,provider,'media',id);
   if(!result.data.eligible)fail('This source is not eligible for supported viewing',409);
   return transaction(identity.userId,async c=>{
    await binding(c,identity,provider,result.accountId);
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['external',identity.tenantId,identity.businessId,provider,id])]);
    const old=await registered(c,identity,provider,id);
    if(old){if(old.resource.lifecycle!=='active')fail('This reference is archived',409);return {...projection(old),alreadyRegistered:true};}
    const owner={kind:'business',tenantId:identity.tenantId,businessId:identity.businessId};
    // Provider defaults stay only in the expiring cache. Owner-authored text is separate.
    const resource={...newMediaResource({owner,title:'External video',creator:'',source:{kind:'external_reference',provider,reference:id}},identity.userId),externalLibrary:true,presentationEdited:false};
    await createMediaResourceRepository(nested(c),{initialOwners}).transaction(identity.userId,async tx=>{await tx.insert(resource);await tx.audit({resourceId:resource.id,actorId:identity.userId,action:'resource_created',revision:1});});
    await c.query('insert into media_private.external_media_cache(resource_id,tenant_id,business_id,provider,media_id,account_id,metadata,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[resource.id,identity.tenantId,identity.businessId,provider,id,result.accountId,result.data,new Date(now()+cacheLifetimeMs).toISOString()]);
    const placements=createMediaPlacementService({authenticate:async()=>({userId:identity.userId}),repository:createMediaPlacementRepository(nested(c),{initialOwners})});
    const placement=await placements.authorize(null,resource.id,owner,{kind:'public'});
    return {resourceId:resource.id,placementId:placement.id,hidden:!placement.visible,revision:1,alreadyRegistered:false};
   });
  },
  async refresh(identity,resourceId,expectedRevision){
   if(!uuid(resourceId)||!Number.isSafeInteger(expectedRevision))fail('Refresh the resource before continuing',400);
   const captured=await transaction(identity.userId,async c=>{
    await authority(c,identity);
    const row=(await c.query('select * from media_private.external_media_cache where resource_id=$1 and tenant_id=$2 and business_id=$3',[resourceId,identity.tenantId,identity.businessId])).rows[0];
    if(!row)fail('Resource unavailable',404);if(row.revision!==expectedRevision)fail('Source changed; reload before refreshing',409);return row;
   });
   // Transient failures do not alter the saved metadata or any placement.
   const result=await connections.workflow.libraryRead(identity,captured.provider,'media',captured.media_id);
   return transaction(identity.userId,async c=>{
    await binding(c,identity,captured.provider,captured.account_id);
    if(result.accountId!==captured.account_id)fail('Connected account no longer matches this reference',409);
    const old=await registered(c,identity,captured.provider,captured.media_id);
    if(!old||old.revision!==expectedRevision||old.resource.lifecycle!=='active')fail('Resource changed; reload before refreshing',409);
    await c.query('update media_private.external_media_cache set metadata=$2,expires_at=$3,revision=revision+1 where resource_id=$1',[resourceId,result.data,new Date(now()+cacheLifetimeMs).toISOString()]);
    await c.query("insert into media_private.external_media_audit(resource_id,actor_id,action,revision) values($1,$2,'metadata_refreshed',$3)",[resourceId,identity.userId,expectedRevision+1]);
    return {resourceId,revision:expectedRevision+1,source:result.data};
   });
  },
  async preview(identity,resourceId){
   if(!uuid(resourceId))fail('Resource unavailable',404);
   return transaction(identity.userId,async c=>{
    await authority(c,identity);
    const row=(await c.query('select r.document as resource,e.* from media_private.external_media_cache e join media_private.resources r on r.id=e.resource_id where e.resource_id=$1 and e.tenant_id=$2 and e.business_id=$3',[resourceId,identity.tenantId,identity.businessId])).rows[0];
    if(!row||row.resource.lifecycle!=='active')fail('Resource unavailable',404);
    const cache=cachedSource(row,now());if(!cache?.eligible)fail('Source unavailable or metadata expired; manually refresh',409);
    return externalPresentation(row.provider,row.media_id);
   });
  },
  async resolve(viewerId,placementId,play=false,client=null){
   const work=async c=>{
    const material=(await c.query('select media_private.external_viewer_material($1) as material',[placementId])).rows[0]?.material;
    if(!material)return null;
    const {resource,placement,cache}=material;let authority,state;
    if(viewerId){const member=(await c.query('select role,participant_ids from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[viewerId,placement.context.tenantId,placement.context.businessId])).rows[0];if(member){authority={userId:viewerId,...placement.context,role:member.role,participantIds:member.participant_ids};state=(await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2',[placement.context.tenantId,placement.context.businessId])).rows[0]?.state;}}
    const source=cachedSource(cache,now());let supported=true;try{externalPolicy(placement.policy);}catch{supported=false;}
    const access=resolveMediaViewerAccess({placement,resourceAvailable:resource.lifecycle==='active'&&supported,resourceId:resource.id,viewerId,authority,state,at:new Date(now()).toISOString()});
    const decision=access.allowed&&source?.eligible!==true?{allowed:false,reason:'resource_unavailable'}:access;
    if(play){if(!decision.allowed)fail('Media unavailable for this viewer',decision.reason==='authentication_required'?401:403);return externalPresentation(resource.source.provider,resource.source.reference);}
    return {decision,...(access.allowed?{metadata:externalMetadata(resource,source),external:true}:{})};
   };return client?work(client):transaction(viewerId,work);
  },
  async list(c,identity){
   const rows=(await c.query('select id from media_private.external_library_placements($1,$2)',[identity.tenantId,identity.businessId])).rows;
   const items=[];
   for(const {id} of rows){const result=await this.resolve(identity.userId,id,false,c);if(!result?.metadata)continue;const p=(await c.query('select document from media_private.placements where id=$1',[id])).rows[0]?.document;if(p)items.push({id,placementId:id,...result.metadata,external:true,publishState:'published',assetAvailable:result.decision.allowed,revision:p.revision,categoryIds:p.categoryIds,collectionIds:p.collectionIds,accessDecision:result.decision});}
   return items;
  },
  expire:()=>pool.query('select media_private.expire_external_metadata()')
 };
}
