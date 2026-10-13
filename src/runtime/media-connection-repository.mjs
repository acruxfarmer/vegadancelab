import {ApplicationError} from '../application.mjs';
import {requireMediaConnectionAuthority} from '../media-connections.mjs';

export function createMediaConnectionRepository(pool,{initialOwners=[]}={}){
 return {async transaction(identity,provider,operation){
  if(!identity||['userId','tenantId','businessId'].some(k=>typeof identity[k]!=='string'||!identity[k].length)||!['vimeo','youtube'].includes(provider))throw new ApplicationError('Choose an authorized business',403);
  const client=await pool.connect();
  try{
   await client.query('begin');
   await client.query("select set_config('vega.actor_id',$1,true)",[identity.userId]);
   const {rows}=await client.query('select m.role,s.state from vega_private.app_members m join vega_private.app_state s using(tenant_id,business_id) where m.user_id=$1 and m.tenant_id=$2 and m.business_id=$3 for update of s',[identity.userId,identity.tenantId,identity.businessId]);
   if(rows.length!==1)throw new ApplicationError('Business access unavailable',403);
   const authority={...identity,role:rows[0].role};requireMediaConnectionAuthority(rows[0].state,authority,initialOwners);
   const saved=await client.query('select document from media_private.source_connections where tenant_id=$1 and business_id=$2 and provider=$3 for update',[identity.tenantId,identity.businessId,provider]);
   const row=saved.rows[0]?.document??{tenantId:identity.tenantId,businessId:identity.businessId,provider,revision:1,status:'disconnected'};
   const result=await operation(row,authority);
   if(result.next){
    const next=result.next;
    if(next.tenantId!==row.tenantId||next.businessId!==row.businessId||next.provider!==provider||next.revision!==row.revision+1)throw new ApplicationError('Invalid connection transition',409);
    await client.query('insert into media_private.source_connections(tenant_id,business_id,provider,document) values($1,$2,$3,$4) on conflict(tenant_id,business_id,provider) do update set document=excluded.document',[identity.tenantId,identity.businessId,provider,next]);
    await client.query('insert into media_private.source_connection_audit(tenant_id,business_id,provider,actor_id,action,revision) values($1,$2,$3,$4,$5,$6)',[identity.tenantId,identity.businessId,provider,identity.userId,result.action,next.revision]);
   }
   await client.query('commit');return result.value;
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
 }};
}
