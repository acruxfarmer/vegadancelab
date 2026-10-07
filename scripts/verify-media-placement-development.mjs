import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {createMediaResourceFoundation} from '../src/runtime/media-resource-foundation.mjs';
import {createMediaResourceRepository} from '../src/runtime/media-resource-repository.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';

if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Established Development runtime required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
const owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a',member='e5946b40-9839-4a96-99d5-93262d9573f0',staff=DEVELOPMENT_INITIAL_OWNERS[0];
const vega={kind:'business',tenantId:staff.tenantId,businessId:staff.businessId},willow={kind:'business',tenantId:'layer3-reuse-fixture',businessId:'willow-movement'};
// Existing verified Auth subject fixtures. No new login/identity or user roles.
const authenticate=async userId=>{if(![owner,member,staff.userId].includes(userId))throw Error('Unknown fixture');return {userId};};
const repository=createMediaPlacementRepository(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS});
const service=createMediaPlacementService({authenticate,repository});
const foundation=createMediaResourceFoundation({authenticate,repository:createMediaResourceRepository(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS})});
const config=policy=>({visible:true,policy,categoryIds:[],collectionIds:[]});
const probe=async(actor,sql,values)=>{
 const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actor]);return await c.query(sql,values);}finally{await c.query('rollback');c.release();}
};
try{
 const before=await repository.transaction(staff.userId,tx=>tx.businessState(vega));
 const r=await foundation.create(owner,{owner:{kind:'user',userId:owner},title:'L6-S1B placement authority proof',creator:'Development fixture',source:{kind:'external_reference',provider:'development-reference',reference:'no-fetch-placement-proof'}});
 await assert.rejects(service.authorize(member,r.id,vega),/unavailable|owner access/);
 await assert.rejects(service.authorize(staff.userId,r.id,vega),/unavailable|owner access/);
 const concurrent=await Promise.all([1,2,3].map(()=>service.authorize(owner,r.id,vega)));
 assert.equal(new Set(concurrent.map(p=>p.id)).size,1);const p=concurrent[0],other=await service.authorize(owner,r.id,willow);
 await assert.rejects(service.configure(owner,p.id,1,config({kind:'public'})),/Context media/);
 assert.equal((await service.access(null,p.id)).allowed,false);
 await service.configure(staff.userId,p.id,1,config({kind:'public'}));assert.equal((await service.access(null,p.id)).allowed,true);
 assert.equal((await service.access(member,other.id)).allowed,false);
 const publicPlacement=await repository.transaction(owner,tx=>tx.get(p.id));
 await assert.rejects(probe(staff.userId,'update media_private.placements set document=$2 where id=$1',[p.id,JSON.stringify({...publicPlacement,authorized:false,visible:false,withdrawnAt:new Date().toISOString(),revision:3})]),e=>e.code==='42501');
 const product=before.entitlementProducts.find(p=>p.id==='98418cad-59e3-4301-85c0-ec696907d3a2'&&p.type==='membership');assert.ok(product);
 await assert.rejects(service.configure(staff.userId,p.id,2,config({kind:'memberships',productIds:['missing']})),/unavailable/);
 await service.configure(staff.userId,p.id,2,config({kind:'memberships',productIds:[product.id]}));
 assert.equal((await service.access(member,p.id)).allowed,true);assert.equal((await service.access(owner,p.id)).allowed,false);assert.equal((await service.access(null,p.id)).allowed,false);
 const expired=createMediaPlacementService({authenticate,repository,now:()=> '2026-10-21T07:00:00.000Z'});assert.equal((await expired.access(member,p.id)).allowed,false);
 await assert.rejects(repository.transaction(owner,tx=>tx.insert({...p,id:randomUUID()})),e=>e.code==='23505');
 await assert.rejects(repository.transaction(owner,tx=>tx.insert({...p,id:randomUUID(),context:{kind:'business',tenantId:'missing',businessId:'missing'}})),e=>e.code==='23503');
 await assert.rejects(repository.transaction(member,tx=>tx.insert({...p,id:randomUUID(),authorizedBy:member,context:willow})),e=>e.code==='42501');
 await assert.rejects(service.withdraw(staff.userId,p.id,3),/unavailable|owner access/);
 await service.withdraw(owner,p.id,3);assert.equal((await service.access(member,p.id)).allowed,false);
 const remaining=await repository.transaction(owner,tx=>tx.get(other.id));assert.equal(remaining.authorized,true);
 assert.deepEqual((await foundation.readOwned(owner,r.id)).owner,r.owner);
 assert.deepEqual(await repository.transaction(staff.userId,tx=>tx.businessState(vega)),before);
 console.log(JSON.stringify({result:'L6S1B_RUNTIME_PASS',resourceId:r.id,withdrawnPlacementId:p.id,remainingHiddenPlacementId:other.id,concurrentAuthorization:3,canonicalResources:1,publicAccess:true,currentMembership:true,expiryDenied:true,ownerWithoutMembershipDenied:true,targetStaffCannotWithdraw:true,foreignPlacementDenied:true,duplicateConstraint:true,contextForeignKey:true,unauthorizedInsertDenied:true,businessStateUnchanged:true,providerExecution:false,coverage:'Existing verified subject fixtures; real restricted runtime repository. Willow placement stays hidden; Willow staff/member behavior covered by local fixtures.'}));
}catch(e){console.error(JSON.stringify({result:'L6S1B_RUNTIME_FAILED',code:e.code||null,message:e.message}));process.exitCode=1;}
finally{await pool.end();}
