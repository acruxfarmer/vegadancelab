import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createMediaViewerStore} from '../src/runtime/media-viewer-store.mjs';

if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Development runtime required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
const secondBusiness=true;
const staff=DEVELOPMENT_INITIAL_OWNERS[0],member='e5946b40-9839-4a96-99d5-93262d9573f0';
const vega={kind:'business',tenantId:staff.tenantId,businessId:staff.businessId},willow={kind:'business',tenantId:'layer3-reuse-fixture',businessId:'willow-movement'};
const resource='5d23202b-538b-4ad0-9bbe-46856932166e',product='98418cad-59e3-4301-85c0-ec696907d3a2',willowProduct='d1e20fe7-83c2-4bde-a628-2b5b3a714232';
const authenticate=async userId=>{if(![member,staff.userId].includes(userId))throw Error('Unknown verification subject');return {userId};};
const c=await pool.connect();
// All test products, role assignments and placements below
// exist only inside this transaction and are rolled back, including on failure.
const nestedPool={connect:async()=>({release(){},async query(sql,args){
 if(sql==='begin')return c.query('savepoint viewer_service');
 if(sql==='commit')return c.query('release savepoint viewer_service');
 if(sql==='rollback'){await c.query('rollback to savepoint viewer_service');return c.query('release savepoint viewer_service');}
 return c.query(sql,args);
}})};
const placements=createMediaPlacementService({authenticate,repository:createMediaPlacementRepository(nestedPool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS})});
const viewer=createMediaViewerStore(nestedPool);
const config=policy=>({visible:true,policy,categoryIds:[],collectionIds:[]});
const actor=async id=>c.query("select set_config('vega.actor_id',$1,true)",[id]);
const read=async ctx=>(await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2',[ctx.tenantId,ctx.businessId])).rows[0].state;
const write=async(ctx,state)=>c.query('update vega_private.app_state set state=$3 where tenant_id=$1 and business_id=$2',[ctx.tenantId,ctx.businessId,JSON.stringify(state)]);
const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
let result;
try{
 await c.query('begin');await c.query("set local statement_timeout='15s'");await actor(staff.userId);
 const resourceBefore=(await c.query('select md5(document::text) as hash from media_private.resources where id=$1',[resource])).rows[0].hash;
 const beforeVega=await read(vega),beforeWillow=secondBusiness?await read(willow):null;
 // Second-business products/role assignment are transaction-local fixtures.
 // Existing member links are prepared separately and removed after verification.
 const willowFixture={...structuredClone(beforeWillow),entitlementProducts:[{id:willowProduct,name:'Development membership fixture',type:'membership',quantity:1,validDays:30}],staffRoleAssignments:[{tenantId:willow.tenantId,businessId:willow.businessId,userId:staff.userId,role:'owner',revision:1}]};
 if(secondBusiness)await write(willow,willowFixture);
 const a=await placements.authorize(staff.userId,resource,vega),b=secondBusiness?await placements.authorize(staff.userId,resource,willow):null;
 await placements.configure(staff.userId,a.id,1,config({kind:'public'}));
 if(b)await placements.configure(staff.userId,b.id,1,config({kind:'public'}));
 assert.ok((await viewer.play(null,a.id)).length>0);if(b)assert.ok((await viewer.play(null,b.id)).length>0);
 await placements.configure(staff.userId,a.id,2,config({kind:'memberships',productIds:[product]}));
 assert.ok((await viewer.play(member,a.id)).length>0);await assert.rejects(viewer.play(null,a.id));
 if(b){await placements.configure(staff.userId,b.id,2,config({kind:'memberships',productIds:[willowProduct]}));
 const denial=(await viewer.resolve(member,b.id)).decision;assert.equal(denial.allowed,false);assert.equal(denial.reason,'membership_required');
 await placements.configure(staff.userId,b.id,3,config({kind:'public'}));}
 await placements.withdraw(staff.userId,a.id,3);assert.equal((await viewer.resolve(member,a.id)).decision.reason,'placement_unavailable');
 const alternateBytes=await viewer.play(null,b.id);assert.ok(alternateBytes.length>0);
 await actor(staff.userId);assert.equal(hash(await read(vega)),hash(beforeVega));if(b)assert.deepEqual(await read(willow),willowFixture);
 assert.equal((await c.query('select md5(document::text) as hash from media_private.resources where id=$1',[resource])).rows[0].hash,resourceBefore);
 result={result:'L6S2_REMAINING_HOSTED_PASS',wrongBusinessReason:'membership_required',withdrawnPlacementReason:'placement_unavailable',alternatePlacementPlayback:true,alternatePolicy:'public',playbackBytes:alternateBytes.length,canonicalResourceUnchanged:true,vegaStateUnchanged:true,willowOnlyTransactionLocalFixtures:true,providerExecution:false};
}catch(e){console.error(JSON.stringify({result:'L6S2_RUNTIME_FAILED',code:e.code||null,message:e.message}));process.exitCode=1;}
finally{try{await c.query('rollback');}finally{c.release();await pool.end();}}
if(result)console.log(JSON.stringify({...result,allRuntimeFixtureChangesRolledBack:true}));
