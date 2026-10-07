import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions,createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createMediaViewerStore} from '../src/runtime/media-viewer-store.mjs';
import {bookingAccounting} from '../src/cancellation.mjs';
import {entitlementActive} from '../src/entitlements.mjs';

if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Development runtime required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
const secondBusiness=process.argv.includes('--with-second-business-fixture');
const staff=DEVELOPMENT_INITIAL_OWNERS[0],member='e5946b40-9839-4a96-99d5-93262d9573f0';
const vega={kind:'business',tenantId:staff.tenantId,businessId:staff.businessId},willow={kind:'business',tenantId:'layer3-reuse-fixture',businessId:'willow-movement'};
const resource='5d23202b-538b-4ad0-9bbe-46856932166e',product='98418cad-59e3-4301-85c0-ec696907d3a2',willowProduct='d1e20fe7-83c2-4bde-a628-2b5b3a714232';
const authenticate=async userId=>{if(![member,staff.userId].includes(userId))throw Error('Unknown verification subject');return {userId};};
const c=await pool.connect();
// All test bookings, credit debits, placements and source-state changes below
// exist only inside this transaction and are rolled back, including on failure.
const nestedPool={connect:async()=>({release(){},async query(sql,args){
 if(sql==='begin')return c.query('savepoint viewer_service');
 if(sql==='commit')return c.query('release savepoint viewer_service');
 if(sql==='rollback'){await c.query('rollback to savepoint viewer_service');return c.query('release savepoint viewer_service');}
 return c.query(sql,args);
}})};
const placements=createMediaPlacementService({authenticate,repository:createMediaPlacementRepository(nestedPool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS})});
const viewer=createMediaViewerStore(nestedPool),application=createApplicationStore(nestedPool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS});
const config=policy=>({visible:true,policy,categoryIds:[],collectionIds:[]});
const actor=async id=>c.query("select set_config('vega.actor_id',$1,true)",[id]);
const read=async ctx=>(await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2',[ctx.tenantId,ctx.businessId])).rows[0].state;
const write=async(ctx,state)=>c.query('update vega_private.app_state set state=$3 where tenant_id=$1 and business_id=$2',[ctx.tenantId,ctx.businessId,JSON.stringify(state)]);
const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
try{
 await c.query('begin');await actor(staff.userId);
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
 assert.equal((await viewer.resolve(member,b.id)).decision.allowed,false);
 await placements.configure(staff.userId,b.id,3,config({kind:'public'}));}
 const expiry=createMediaViewerStore(nestedPool,{now:()=> '2026-10-21T07:00:00.000Z'});assert.equal((await expiry.resolve(member,a.id)).decision.reason,'membership_not_current');
 await c.query('savepoint zero_credit_fixture');await actor(staff.userId);
 const zero=structuredClone(beforeVega),at=new Date().toISOString(),participantId='vega-member-test-joe';
 const accounting=bookingAccounting(zero,{...vega,userId:member,role:'member'},{id:randomUUID,now:()=>at},m=>{throw Error(m)});
 const units=zero.creditUnits.filter(u=>u.participantId===participantId&&u.status==='available'&&u.entitlement?.productId===product&&entitlementActive(u,at));assert.ok(units.length>0);
 for(const u of units){
  const occurrence={id:u.entitlement.classIds?.[0]||randomUUID(),category:u.entitlement.categories?.[0]||'Development fixture',startsAt:at,creditRequired:true};
  const reservation={id:randomUUID(),participantId,passId:u.passId,classId:occurrence.id,status:'reserved'};
  accounting.consume(reservation,occurrence);zero.reservations.push(reservation);
 }
 assert.equal(zero.creditUnits.filter(u=>u.participantId===participantId&&u.status==='available'&&u.entitlement?.productId===product&&entitlementActive(u,at)).length,0);
 await write(vega,zero);await actor(member);const zeroBefore=hash(await read(vega));
 assert.ok((await viewer.play(member,a.id)).length>0);assert.equal(hash(await read(vega)),zeroBefore);
 await c.query('rollback to savepoint zero_credit_fixture');await c.query('release savepoint zero_credit_fixture');
 await c.query('savepoint unpublished_fixture');await actor(staff.userId);
 const unpublished=structuredClone(beforeVega);unpublished.videos.find(v=>v.id==='b584d560-1f3d-4b4d-bd2f-9d4a8026122f').publishState='draft';await write(vega,unpublished);
 assert.equal((await viewer.resolve(member,a.id)).decision.reason,'resource_unavailable');
 await c.query('rollback to savepoint unpublished_fixture');await c.query('release savepoint unpublished_fixture');
 await placements.withdraw(staff.userId,a.id,3);assert.equal((await viewer.resolve(member,a.id)).decision.allowed,false);
 await assert.rejects(application.mediaPlayback({userId:member,...vega},'b584d560-1f3d-4b4d-bd2f-9d4a8026122f',8));
 if(b)assert.ok((await viewer.play(null,b.id)).length>0);
 await actor(staff.userId);assert.equal(hash(await read(vega)),hash(beforeVega));if(b)assert.equal(hash(await read(willow)),hash(willowFixture));
 console.log(JSON.stringify({result:secondBusiness?'L6S2_RUNTIME_PASS':'L6S2_VEGA_RUNTIME_PASS',publicPlayback:true,currentMembershipPlayback:true,zeroCurrentCreditsPlayback:true,expiryDenied:true,wrongBusinessMembershipDenied:secondBusiness?true:'NOT_RUN',withdrawalDenied:true,otherPlacementPlays:secondBusiness?true:'NOT_RUN',legacyUrlBypassDenied:true,unpublishedDenied:true,viewingNonConsumptive:true,allRuntimeFixtureChangesRolledBack:true,providerExecution:false}));
}catch(e){console.error(JSON.stringify({result:'L6S2_RUNTIME_FAILED',code:e.code||null,message:e.message}));process.exitCode=1;}
finally{await c.query('rollback');c.release();await pool.end();}
