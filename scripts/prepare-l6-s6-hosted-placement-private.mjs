// Operator-authorized Development fixture, using the existing owner/staff services
// and restricted runtime database role. No tickets or provider requests.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS as initialOwners} from '../src/staff-role-management.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createNativeMediaDelivery} from '../src/runtime/native-media-delivery.mjs';
const owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';
const resourceId='dcb5f610-23a2-43be-af39-706a17be8a92',bindingId='439dc92e-5036-41b8-b77c-d2f080594a9d';
const placementId='391db552-e6ff-4708-bb49-937bc920d626';
const staff=initialOwners[0],context={kind:'business',tenantId:staff.tenantId,businessId:staff.businessId};
const dir=new URL('../docs/layer-6/',import.meta.url),receipt=new URL('l6-s6-hosted-placement.local.json',dir);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report={status:'preflight',resourceId,bindingId,placementId,context,accessAvailability:'ALL',productionUntouched:true,providerRequests:0,cleanupPending:false};
let pool,c,acquired=false,committed=false;
const save=()=>fs.writeFile(receipt,JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
async function baseline(){
 await c.query("select set_config('vega.actor_id',$1,true)",[staff.userId]);
 const state=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',[context.tenantId,context.businessId])).rows;
 const members=(await c.query('select user_id,role,participant_ids from vega_private.app_members where tenant_id=$1 and business_id=$2 order by user_id',[context.tenantId,context.businessId])).rows;
 if(state.length!==1)throw Error();
 const database=(await c.query("select (select md5(state::text) from vega_private.app_state where tenant_id=$1 and business_id=$2) as state_digest,(select revision::text from vega_private.app_state where tenant_id=$1 and business_id=$2) as revision,(select md5(coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'role',role,'participant_ids',participant_ids) order by user_id)::text,'[]')) from vega_private.app_members where tenant_id=$1 and business_id=$2) as members_digest",[context.tenantId,context.businessId])).rows[0];
 return {state:hash(state),members:hash(members),database};
}
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error();}
 const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));input.appDatabaseUrl=null;
 c=await pool.connect();if((await c.query('select current_user as role')).rows[0].role!=='vega_app_runtime')throw Error();
 await fs.writeFile(new URL('l6-s6-hosted-placement-attempted.local.json',dir),JSON.stringify({placementId,resourceId}),{flag:'wx'});acquired=true;
 await c.query('begin');report.baseline=await baseline();
 await c.query("select set_config('vega.actor_id',$1,true)",[owner]);
 const read=async()=>{
  const r=(await c.query('select document from media_private.resources where id=$1',[resourceId])).rows[0]?.document;
  const b=(await c.query('select document from media_private.provider_bindings where id=$1',[bindingId])).rows[0]?.document;
  if(r?.owner.userId!==owner||r.lifecycle!=='active'||b?.resourceId!==resourceId||b.state!=='ready'||b.revision!==4)throw Error();
  return {resource:hash(r),binding:hash(b)};
 };
 report.original=await read();
 if((await c.query('select id from media_private.placements where resource_id=$1',[resourceId])).rows.length)throw Error();
 const scoped={connect:async()=>({release(){},query:(sql,args)=>['begin','commit','rollback'].includes(sql)?Promise.resolve({rows:[]}):c.query(sql,args)})};
 const service=createMediaPlacementService({repository:createMediaPlacementRepository(scoped,{initialOwners}),authenticate:async actor=>{if(![owner,staff.userId].includes(actor))throw Error();return {userId:actor};},id:()=>placementId});
 const p=await service.authorize(owner,resourceId,context,{kind:'public'});
 await service.configure(staff.userId,p.id,p.revision,{visible:true,policy:{kind:'public'},categoryIds:[],collectionIds:[]});
 const description=await createNativeMediaDelivery(scoped).resolve(null,placementId);
 if(description?.decision.reason!=='public_access'||description?.decision.allowed!==true)throw Error();
 report.accessDecision=description.decision;
 if(JSON.stringify(await baseline())!==JSON.stringify(report.baseline))throw Error();
 await c.query("select set_config('vega.actor_id',$1,true)",[owner]);
 if(JSON.stringify(await read())!==JSON.stringify(report.original))throw Error();
 // Persist intent before commit; an uncertain commit is never automatically repeated.
 report.status='commit-pending';report.cleanupPending=true;await save();
 await c.query('commit');committed=true;
 report.status='ready-for-hosted-browser-proof';report.watchPath='/watch.html?placement='+placementId;
 await save();
 console.log('Temporary ALL placement ready; baseline recorded. No provider request made.');
}catch{
 if(c&&!committed)await c.query('rollback').catch(()=>{});
 if(acquired){report.status='stopped-reconcile-before-retry';await save();}
 process.exitCode=1;
 console.log('Placement preparation stopped. Review safe receipt before retrying.');
}finally{c?.release();await pool?.end().catch(()=>{});}
