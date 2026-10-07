import {resolveStaffAccess,hasStaffPermission} from '../staff-permissions.mjs';

export function createMediaPlacementRepository(pool,{initialOwners=[]}={}){
 return {async transaction(actorId,work){
  const c=await pool.connect();
  try{
   await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actorId]);
   const member=async context=>{
    const {rows}=await c.query('select role,participant_ids from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[actorId,context.tenantId,context.businessId]);
    return rows.length===1?{userId:actorId,role:rows[0].role,participantIds:rows[0].participant_ids,tenantId:context.tenantId,businessId:context.businessId}:null;
   };
   const businessState=async context=>{
    const {rows}=await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2',[context.tenantId,context.businessId]);
    if(rows.length!==1)throw Error('Business context unavailable');return rows[0].state;
   };
   const tx={member,businessState,
    async canManageBusiness(context){const a=await member(context);return !!a&&hasStaffPermission(resolveStaffAccess(await businessState(context),a,{initialOwners}),a,'customers.manage');},
    async resource(id){const {rows}=await c.query('select document from media_private.resources where id=$1 for share',[id]);return rows[0]?.document;},
    async resourceActive(id){const {rows}=await c.query('select media_private.placement_resource_active($1) as active',[id]);return rows[0]?.active===true;},
    async lock(resourceId,context){await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([resourceId,context.tenantId,context.businessId])]);},
    async find(resourceId,context){const {rows}=await c.query('select document from media_private.placements where resource_id=$1 and tenant_id=$2 and business_id=$3 for update',[resourceId,context.tenantId,context.businessId]);return rows[0]?.document;},
    async get(id,lock=true){const {rows}=await c.query(`select document from media_private.placements where id=$1${lock?' for update':''}`,[id]);return rows[0]?.document;},
    async insert(p){await c.query('insert into media_private.placements(id,resource_id,tenant_id,business_id,authorized_by,document) values($1,$2,$3,$4,$5,$6)',[p.id,p.resourceId,p.context.tenantId,p.context.businessId,p.authorizedBy,JSON.stringify(p)]);},
    async update(p){const result=await c.query('update media_private.placements set document=$2 where id=$1',[p.id,JSON.stringify(p)]);if(result.rowCount!==1)throw Error('Placement update denied');},
    async audit(e){await c.query('insert into media_private.placement_audit(placement_id,actor_id,action,revision,created_at) values($1,$2,$3,$4,$5)',[e.placementId,e.actorId,e.action,e.revision,e.createdAt]);}
   };
   const result=await work(tx);await c.query('commit');return result;
  }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
 }};
}
