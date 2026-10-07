import {ApplicationError} from '../application.mjs';
import {createMediaResourceFoundation} from './media-resource-foundation.mjs';
import {createMediaResourceRepository} from './media-resource-repository.mjs';
import {createMediaPlacementService} from './media-placement-service.mjs';
import {createMediaPlacementRepository} from './media-placement-repository.mjs';

export async function manageMediaAccess(c,a,state,videoId,input,{initialOwners=[]}={}){
 const v=(state.videos||[]).find(v=>v.id===videoId&&v.tenantId===a.tenantId&&v.businessId===a.businessId);
 if(!v)throw new ApplicationError('Media unavailable',404);
 const context={kind:'business',tenantId:a.tenantId,businessId:a.businessId};
 const {rows}=await c.query('select r.document as resource,p.document as placement from media_private.legacy_media_links l join media_private.resources r on r.id=l.resource_id left join media_private.placements p on p.resource_id=r.id and p.tenant_id=l.tenant_id and p.business_id=l.business_id where l.tenant_id=$1 and l.business_id=$2 and l.video_id=$3',[a.tenantId,a.businessId,videoId]);
 const existing=rows[0],o=existing?.resource?.owner;
 const editable=!o||o.kind==='business'&&o.tenantId===a.tenantId&&o.businessId===a.businessId;
 if(input===undefined)return {editable,placementId:existing?.placement?.id||null,revision:existing?.placement?.revision||null,policy:existing?.placement?.policy||null,products:(state.entitlementProducts||[]).filter(p=>p.type==='membership').map(p=>({id:p.id,name:p.name}))};
 if(!editable)throw new ApplicationError('Access Availability is controlled by the resource owner',403);
 if(Object.keys(input).some(k=>!['policy','expectedRevision'].includes(k)))throw new ApplicationError('Unsupported access configuration',400);
 if((existing?.placement?.revision||null)!==(input.expectedRevision??null))throw new ApplicationError('Access changed. Refresh before saving.',409);
 // Compose the existing services in the caller's atomic transaction.
 const pool={connect:async()=>({release(){},async query(sql,args){
  if(sql==='begin')return c.query('savepoint media_access');
  if(sql==='commit')return c.query('release savepoint media_access');
  if(sql==='rollback'){await c.query('rollback to savepoint media_access');return c.query('release savepoint media_access');}
  return c.query(sql,args);
 }})};
 const authenticate=async()=>({userId:a.userId});
 const resources=createMediaResourceFoundation({authenticate,repository:createMediaResourceRepository(pool,{initialOwners})});
 const placements=createMediaPlacementService({authenticate,repository:createMediaPlacementRepository(pool,{initialOwners})});
 const r=existing?.resource||await resources.adoptLegacy(null,{...context,videoId});
 const p=existing?.placement||await placements.authorize(null,r.id,context,input.policy);
 const next=await placements.configure(null,p.id,p.revision,{visible:true,policy:input.policy,categoryIds:p.categoryIds,collectionIds:p.collectionIds});
 return {placementId:next.id,revision:next.revision};
}
