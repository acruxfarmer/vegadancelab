import {createMediaResourceRepository} from './media-resource-repository.mjs';

export function createNativeMediaRepository(pool,{initialOwners=[]}={}){
 async function transaction(actorId,work){
  const c=await pool.connect();
  try{await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actorId||'']);const result=await work(c);await c.query('commit');return result;}
  catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
 }
 function tx(c,actorId){
  const nested={connect:async()=>({release(){},query:async(sql,args)=>['begin','commit'].includes(sql)?{rows:[]}:sql==='rollback'?{rows:[]}:c.query(sql,args)})};
  const resources=createMediaResourceRepository(nested,{initialOwners});
  return {
   canManageBusiness:owner=>resources.transaction(actorId,r=>r.canManageBusiness(owner)),
   async save(item){
    // Serialize each transition separately: the database guard does not allow
    // skipping uploading -> processing during recovery from uncertain upload.
    const {rows}=await c.query('select document from media_private.provider_bindings where id=$1 for update',[item.binding.id]);
    const old=rows[0]?.document;
    if(JSON.stringify(old)===JSON.stringify(item.binding))return;
    if(old?.state==='uploading'&&item.binding.state==='ready'){
     const processing={...old,state:'processing',assetRef:item.binding.assetRef,revision:old.revision+1};
     await c.query('update media_private.provider_bindings set document=$2 where id=$1',[old.id,JSON.stringify(processing)]);
    }
    await c.query('update media_private.provider_bindings set document=$2 where id=$1',[item.binding.id,JSON.stringify(item.binding)]);
   },
   async insert(item,requestId){
    await resources.transaction(actorId,async r=>{await r.insert(item.resource);await r.audit({actorId,resourceId:item.resource.id,action:'resource_created',revision:1});});
    await c.query('insert into media_private.provider_bindings(id,resource_id,actor_id,request_id,fingerprint,document) values($1,$2,$3,$4,$5,$6)',[item.binding.id,item.resource.id,actorId,requestId,item.fingerprint,JSON.stringify(item.binding)]);
   }
  };
 }
 const item=row=>row?{resource:row.resource,binding:row.binding,fingerprint:row.fingerprint}:null;
 return {
  reserve:(actor,requestId,work)=>transaction(actor,async c=>{
   await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`native:${actor}:${requestId}`]);
   const scope=tx(c,actor);
   return work({...scope,insert:value=>scope.insert(value,requestId),async existing(){const {rows}=await c.query('select r.document as resource,b.document as binding,b.fingerprint from media_private.provider_bindings b join media_private.resources r on r.id=b.resource_id where b.actor_id=$1 and b.request_id=$2 for update of b,r',[actor,requestId]);return item(rows[0]);}});
  }),
  mutate:(actor,resourceId,work)=>transaction(actor,async c=>{
   const {rows}=await c.query("select r.document as resource,b.document as binding,b.fingerprint from media_private.provider_bindings b join media_private.resources r on r.id=b.resource_id where r.id=$1 order by (b.document->>'state'='deleted'),b.id limit 1 for update of b,r",[resourceId]);
   return work(tx(c,actor),item(rows[0]));
  }),
  viewer:(actor,placementId,work)=>transaction(actor,async c=>{
   const {rows}=await c.query('select media_private.native_viewer_material($1) as material',[placementId]);
   const material=rows[0]?.material;
   if(material?.placement.policy.kind==='memberships'&&actor){
    const p=material.placement,{rows:members}=await c.query('select role,participant_ids from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[actor,p.context.tenantId,p.context.businessId]);
    if(members.length===1){material.authority={userId:actor,role:members[0].role,participantIds:members[0].participant_ids,...p.context};material.state=(await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2 for share',[p.context.tenantId,p.context.businessId])).rows[0]?.state;}
   }
   return work(material);
  })
 };
}
