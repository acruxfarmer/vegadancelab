import assert from 'node:assert/strict';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {createMediaResourceRepository} from '../src/runtime/media-resource-repository.mjs';
import {createMediaResourceFoundation} from '../src/runtime/media-resource-foundation.mjs';

if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Established Development runtime required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
const owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a',other='e5946b40-9839-4a96-99d5-93262d9573f0';
const staff=DEVELOPMENT_INITIAL_OWNERS[0];
// Explicit trusted verification fixtures, NOT a replacement authentication route.
// These existing Auth subjects were checked through Development database evidence.
const service=createMediaResourceFoundation({authenticate:async identity=>{
 if(![owner,other,staff.userId].includes(identity))throw Error('Unknown verification identity');return {userId:identity};
},repository:createMediaResourceRepository(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS})});
const resource='1ab5124f-2033-45c2-9902-4b63685d29f5';
try{
 const before=await service.readOwned(owner,resource);
 assert.equal(before.owner.kind,'user');assert.equal(before.owner.userId,owner);
 await assert.rejects(service.readOwned(other,resource),/unavailable|owner access/);
 await assert.rejects(service.readOwned(staff.userId,resource),/unavailable|owner access/);
 const scope={tenantId:staff.tenantId,businessId:staff.businessId,videoId:'b584d560-1f3d-4b4d-bd2f-9d4a8026122f'};
 await assert.rejects(service.adoptLegacy(owner,scope),/Business media management/);
 const results=await Promise.all([1,2,3].map(()=>service.adoptLegacy(staff.userId,scope)));
 assert.equal(new Set(results.map(r=>r.id)).size,1);
 assert.equal(results[0].id,'5d23202b-538b-4ad0-9bbe-46856932166e');
 await assert.rejects(service.archive(staff.userId,results[0].id,results[0].revision),/coordinated withdrawal/);
 const archived=await service.archive(owner,resource,before.revision);
 assert.equal(archived.lifecycle,'archived');assert.equal(archived.id,before.id);
 assert.deepEqual(archived.owner,before.owner);assert.deepEqual(archived.source,before.source);
 assert.deepEqual(await service.readOwned(owner,resource),archived);
 console.log(JSON.stringify({result:'L6S1A_REPOSITORY_PASS',userOwnership:true,unrelatedUserDenied:true,staffDoesNotOwnUserResource:true,userNotBusinessAdmin:true,concurrentRepositoryAdoption:3,canonicalIdentityCount:1,linkedArchiveDenied:true,standaloneArchiveReread:true,authenticationCoverage:'existing verified subject fixtures; provider verification covered separately'}));
}catch(e){console.error(JSON.stringify({result:'L6S1A_REPOSITORY_FAILED',code:e.code||null,message:e.message}));process.exitCode=1;}
finally{await pool.end();}
