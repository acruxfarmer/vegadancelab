import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';
import {createPlaybackPolicyDelivery} from '../src/runtime/media-playback-policy.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
const actor='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',resourceId='5d23202b-538b-4ad0-9bbe-46856932166e';
const context={kind:'business',tenantId:'vega-development',businessId:'vega-dance-lab'};
const output=new URL('../docs/layer-6/l6-s9-fixture.local.json',import.meta.url),marker=new URL('../docs/layer-6/l6-s9-fixture-attempted.local.json',import.meta.url);
let pool,c,stage='private session';const report={status:'preflight',providerRequests:0,uploads:0,productionUntouched:true};
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 await fs.writeFile(marker,'{"attempted":true}',{flag:'wx'});
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));c=await pool.connect();
 await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actor]);
 stage='baseline';
 report.baseline=(await c.query("select revision,md5(state::text) as digest from vega_private.app_state where tenant_id='vega-development' and business_id='vega-dance-lab'")).rows[0];
 assert.equal((await c.query('select count(*)::int as n from media_private.placements where resource_id=$1',[resourceId])).rows[0].n,0);
 const nested={connect:async()=>({release(){},query:(sql,args)=>sql==='begin'?c.query('savepoint s9_work'):sql==='commit'?c.query('release savepoint s9_work'):sql==='rollback'?c.query('rollback to savepoint s9_work'):c.query(sql,args)})};
 const placements=createMediaPlacementService({authenticate:async()=>({userId:actor}),repository:createMediaPlacementRepository(nested,{initialOwners:DEVELOPMENT_INITIAL_OWNERS})});
 stage='temporary existing-media placement';
 let p=await placements.authorize(null,resourceId,context,{kind:'public'});report.placementId=p.id;report.resourceId=resourceId;
 p=await placements.configure(null,p.id,p.revision,{visible:true,policy:{kind:'public'},categoryIds:[],collectionIds:[]});
 const ref={kind:'media_resource',resourceId};
 stage='restricted runtime ownership and sequencing verification';
 await assert.rejects(placements.playbackPolicy(null,p.id,0,{preRoll:{kind:'media_resource',resourceId:'dcb5f610-23a2-43be-af39-706a17be8a92'}}));
 const delivery=createPlaybackPolicyDelivery(nested);
 assert.deepEqual((await delivery(null,p.id)).stages,['PRIMARY']);
 const s=await placements.playbackPolicy(null,p.id,0,{preRoll:ref,postRoll:ref});
 assert.deepEqual((await delivery(null,p.id)).stages,['PRE_ROLL','PRIMARY','POST_ROLL']);
 for(const position of ['PRE_ROLL','PRIMARY','POST_ROLL']){const bytes=await delivery(null,p.id,position,s.revision);assert.equal(Buffer.isBuffer(bytes),true);assert.equal(bytes.toString('ascii',4,8),'ftyp');}
 await placements.playbackPolicy(null,p.id,1,{});assert.deepEqual((await delivery(null,p.id)).stages,['PRIMARY']);
 await assert.rejects(delivery(null,p.id,'PRE_ROLL',1));
 await placements.playbackPolicy(null,p.id,2,{preRoll:ref,postRoll:ref});
 p=await placements.ownerPolicy(null,p.id,p.revision,{policy:{kind:'pay_on_demand'}});
 await assert.rejects(delivery(null,p.id));await assert.rejects(delivery(null,p.id,'PRE_ROLL',3));
 p=await placements.ownerPolicy(null,p.id,p.revision,{policy:{kind:'public'}});
 report.policyRevision=3;report.restrictedRuntimeVerified=true;report.deniedAccessVerified=true;report.removalVerified=true;report.personalOwnerRejected=true;report.source='existing published business-owned legacy media; same resource reused for all three semantic stages';
 const after=(await c.query("select revision,md5(state::text) as digest from vega_private.app_state where tenant_id='vega-development' and business_id='vega-dance-lab'")).rows[0];assert.deepEqual(after,report.baseline);
 stage='commit temporary fixture';await c.query('commit');report.status='ready-for-hosted-proof';
}catch{await c?.query('rollback').catch(()=>{});report.status='stopped';report.stoppedAt=stage;process.exitCode=1;}
finally{c?.release();await pool?.end().catch(()=>{});await fs.writeFile(output,JSON.stringify(report,null,2));console.log('S9 private fixture result saved; no secret details printed.');}
