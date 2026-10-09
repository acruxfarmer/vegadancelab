import {effectivePlacementRights,receiverAccessOptions} from '../media-placement-rights.mjs';
import {ApplicationError} from '../application.mjs';
import {createMediaResourceFoundation} from './media-resource-foundation.mjs';
import {createMediaResourceRepository} from './media-resource-repository.mjs';
import {createMediaPlacementService} from './media-placement-service.mjs';
import {createMediaPlacementRepository} from './media-placement-repository.mjs';
import {resolveStaffAccess,hasStaffPermission} from '../staff-permissions.mjs';
const fail=(message,status=403)=>{throw new ApplicationError(message,status);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function createMediaOwnerManagement(pool,{initialOwners=[]}={}){
 return async(actor,input)=>{
  if(!uuid(actor))fail('Sign in to continue',401);
  const c=await pool.connect();
  try{
   await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actor]);
   // These rows are already actor-scoped by existing RLS. Only authorized staff
   // receive safe organization/catalog projections; never expose whole state.
   const {rows}=await c.query("select m.tenant_id,m.business_id,m.role,s.state from vega_private.app_members m join vega_private.app_state s using(tenant_id,business_id) where m.user_id=$1 and m.role='staff'",[actor]);
   const businesses=rows.filter(row=>hasStaffPermission(resolveStaffAccess(row.state,{userId:actor,role:row.role,tenantId:row.tenant_id,businessId:row.business_id},{initialOwners}),{userId:actor,role:row.role,tenantId:row.tenant_id,businessId:row.business_id},'customers.manage'));
   const manages=o=>o?.kind==='business'&&businesses.some(b=>b.tenant_id===o.tenantId&&b.business_id===o.businessId);
   const owns=r=>r?.owner.kind==='user'?r.owner.userId===actor:manages(r?.owner);
   const nested={connect:async()=>({release(){},async query(sql,args){if(sql==='begin')return c.query('savepoint owner_management');if(sql==='commit')return c.query('release savepoint owner_management');if(sql==='rollback'){await c.query('rollback to savepoint owner_management');return c.query('release savepoint owner_management');}return c.query(sql,args);}})};
   const authenticate=async()=>({userId:actor});
   const resources=createMediaResourceFoundation({authenticate,repository:createMediaResourceRepository(nested,{initialOwners})});
   const placements=createMediaPlacementService({authenticate,repository:createMediaPlacementRepository(nested,{initialOwners})});
   if(input!==undefined){
    if(!input||Object.keys(input).some(k=>!['action','id','expectedRevision','resource','policy','metadata','configuration','rights'].includes(k)))fail('Unsupported management request',400);
    if(input.action==='create'){
     if(!input.resource||input.resource.source?.kind!=='external_reference')fail('Register an external reference',400);
     const r=await resources.create(null,input.resource);
     if(r.owner.kind==='business'){
      const p=await placements.authorize(null,r.id,r.owner,input.policy);
      await placements.configure(null,p.id,p.revision,{visible:true,policy:input.policy,categoryIds:[],collectionIds:[]});
     }else if(input.policy!==undefined)fail('Personal registration creates no placement; policy is chosen on existing placements',400);
    }else{
     if(!uuid(input.id)||!Number.isInteger(input.expectedRevision))fail('Refresh the media before saving',400);
     if(input.action==='edit')await resources.edit(null,input.id,input.expectedRevision,input.metadata);
     else if(input.action==='archive')await resources.archive(null,input.id,input.expectedRevision);
     else if(input.action==='withdraw')await placements.withdraw(null,input.id,input.expectedRevision);
     else if(input.action==='rights')await placements.rights(null,input.id,input.expectedRevision,input.rights);
     else if(input.action==='policy'){
      const {rows:pr}=await c.query('select p.document,r.document as resource from media_private.placements p join media_private.resources r on r.id=p.resource_id where p.id=$1',[input.id]);
      const p=pr[0]?.document,r=pr[0]?.resource;if(!owns(r))fail('Resource owner access required');
      await placements.ownerPolicy(null,p.id,input.expectedRevision,{policy:input.policy});
     }else if(input.action==='local-policy'){
      const {rows}=await c.query('select document from media_private.placements where id=$1',[input.id]);const p=rows[0]?.document;if(!p)fail('Placement unavailable',404);
      await placements.configure(null,p.id,input.expectedRevision,{visible:p.visible,policy:input.policy,categoryIds:p.categoryIds,collectionIds:p.collectionIds});
     }else if(input.action==='organize')await placements.configure(null,input.id,input.expectedRevision,input.configuration);
     else fail('Unsupported management action',400);
    }
   }
   const {rows:rr}=await c.query('select document from media_private.resources order by document->>\'createdAt\',id');
   const items=[];
   for(const row of rr){
    const r=row.document;if(!owns(r))continue;
    const {rows:ps}=await c.query('select document from media_private.placements where resource_id=$1 order by id',[r.id]);
    const {rows:links}=await c.query('select video_id,tenant_id,business_id from media_private.legacy_media_links where resource_id=$1',[r.id]);
    const projections=[];
    for(const {document:p} of ps){
     const b=businesses.find(b=>b.tenant_id===p.context.tenantId&&b.business_id===p.context.businessId);
     let products=[];
     products=(await c.query('select media_private.owner_policy_choices($1) as products',[p.id])).rows[0].products;

     projections.push({...p,rights:effectivePlacementRights(p),canEditAccess:true,allowedAccessModes:['public','memberships','pay_on_demand'],products,canOrganize:!!b&&effectivePlacementRights(p).organize,canPresent:!!b&&effectivePlacementRights(p).present,groups:b?(b.state.mediaGroups||[]).map(g=>({id:g.id,name:g.name,kind:g.kind})):[]});
    }
    let delivery;
    if(r.source?.kind==='managed_reference'){
     const {rows:bindings}=await c.query("select document->>'state' as state from media_private.provider_bindings where resource_id=$1 and document->>'state'<>'deleted'",[r.id]);
     const state=bindings.length===1?bindings[0].state:null;
     delivery={state:state==='ready'?'ready':state==='failed'?'unavailable':'processing'};
    }
    items.push({...r,...(delivery?{delivery}:{}),placements:projections,linkedVideo:links[0]||null});
   }
   // Target staff receive their local placement only, never the external
   // owner's canonical metadata/source document or global management rights.
   const {rows:local}=await c.query('select document from media_private.placements order by id');
   for(const {document:p} of local){
    const b=businesses.find(b=>b.tenant_id===p.context.tenantId&&b.business_id===p.context.businessId);
    const existing=items.find(r=>r.id===p.resourceId);
    if(!b||existing&&!existing.localOnly)continue;
    const rights=effectivePlacementRights(p),allowedAccessModes=receiverAccessOptions(p);
    const products=(b.state.entitlementProducts||[]).filter(x=>x.type==='membership'&&(rights.access.mode!=='restrict'||p.policy.kind==='public'||p.policy.productIds?.includes(x.id))).map(x=>({id:x.id,name:x.name}));
    const localPlacement={...p,rights,products,canEditAccess:allowedAccessModes.length>0,allowedAccessModes,canOrganize:rights.organize,canPresent:rights.present,groups:(b.state.mediaGroups||[]).map(g=>({id:g.id,name:g.name,kind:g.kind}))};
    if(existing)existing.placements.push(localPlacement);
    else items.push({id:p.resourceId,title:'Externally owned media',owner:{kind:'external'},source:{provider:'Managed by owner',kind:'external'},lifecycle:'Local placement',localOnly:true,placements:[localPlacement]});
   }
   const result={userId:actor,items,businesses:businesses.map(b=>({kind:'business',tenantId:b.tenant_id,businessId:b.business_id,products:(b.state.entitlementProducts||[]).filter(p=>p.type==='membership').map(p=>({id:p.id,name:p.name}))}))};
   await c.query('commit');return result;
  }catch(error){await c.query('rollback').catch(()=>{});throw error;}finally{c.release();}
 };
}
