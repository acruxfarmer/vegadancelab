import {resolveStaffAccess,hasStaffPermission} from '../staff-permissions.mjs';
import {legacyMediaKey} from '../media-resource.mjs';

// Uses the established restricted server connection, never a browser client.
// New schema installation/activation is intentionally pending review.
export function createMediaResourceRepository(pool,{initialOwners=[]}={}){
 return {async transaction(actorId,work){
  const c=await pool.connect();
  try{
   await c.query('begin');
   await c.query("select set_config('vega.actor_id',$1,true)",[actorId]);
   const tx={
    async canManageBusiness(owner){
     const {rows}=await c.query('select m.role,s.state from vega_private.app_members m join vega_private.app_state s using(tenant_id,business_id) where m.user_id=$1 and m.tenant_id=$2 and m.business_id=$3',[actorId,owner.tenantId,owner.businessId]);
     if(rows.length!==1)return false;
     const a={userId:actorId,role:rows[0].role,tenantId:owner.tenantId,businessId:owner.businessId};
     return hasStaffPermission(resolveStaffAccess(rows[0].state,a,{initialOwners}),a,'customers.manage');
    },
    async get(id){const {rows}=await c.query('select document from media_private.resources where id=$1 for update',[id]);return rows[0]?.document;},
    async insert(r){await c.query('insert into media_private.resources(id,owner_user_id,owner_tenant_id,owner_business_id,submitted_by,document) values($1,$2,$3,$4,$5,$6)',[r.id,r.owner.userId||null,r.owner.tenantId||null,r.owner.businessId||null,r.submittedBy,JSON.stringify(r)]);},
    async update(r){await c.query('update media_private.resources set document=$2 where id=$1',[r.id,JSON.stringify(r)]);},
    async audit(e){await c.query('insert into media_private.resource_audit(resource_id,actor_id,action,revision) values($1,$2,$3,$4)',[e.resourceId,e.actorId,e.action,e.revision]);},
    async hasLegacyLinks(id){const {rows}=await c.query('select 1 from media_private.legacy_media_links where resource_id=$1 limit 1',[id]);return rows.length>0;},
    async legacyVideo(s){
     // Serializes adoption of the same old video without mutating business state.
     await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[legacyMediaKey(s)]);
     const {rows}=await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2 for share',[s.tenantId,s.businessId]);
     return rows[0]?.state.videos?.find(v=>v.id===s.videoId&&v.tenantId===s.tenantId&&v.businessId===s.businessId);
    },
    async legacyResource(s){const {rows}=await c.query('select r.document from media_private.resources r join media_private.legacy_media_links l on l.resource_id=r.id where l.tenant_id=$1 and l.business_id=$2 and l.video_id=$3',[s.tenantId,s.businessId,s.videoId]);return rows[0]?.document;},
    async linkLegacy(s,id){await c.query('insert into media_private.legacy_media_links(tenant_id,business_id,video_id,resource_id) values($1,$2,$3,$4)',[s.tenantId,s.businessId,s.videoId,id]);}
   };
   const result=await work(tx);await c.query('commit');return result;
  }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
 }};
}
