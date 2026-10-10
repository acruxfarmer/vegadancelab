// Existing private operator stdin contract. Real runtime role; all writes rolled back.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions,createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {grantComplimentaryRental} from '../src/rental-entitlement.mjs';
import {createRentalPlaybackStore} from '../src/runtime/rental-playback-store.mjs';
import {buildRecoveryReceipt} from '../src/recovery-receipt.mjs';
import {digest} from '../src/payments.mjs';
const report={status:'preflight',stage:'private-input',checks:[],productionUntouched:true,providerCalls:0,committedBusinessWrites:0,baselineRestored:false};
const a={...DEVELOPMENT_INITIAL_OWNERS[0],role:'staff',participantIds:[]},scope=[a.tenantId,a.businessId];
const publicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
let pool,c,baseline;
const fail=(message,status)=>{const e=Error(message);e.status=status;throw e;};
const actor=()=>c.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[a.userId]);
const read=async()=>{await actor();return (await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',scope)).rows[0];};
async function persist(next){
 await actor();const before=await read(),requestId=randomUUID(),command={action:'rental-development-rollback-fixture',body:{requestId}};
 const r=buildRecoveryReceipt({before:before.state,after:next,revision:before.revision,authority:a,command,result:{fixture:true},occurredAt:new Date().toISOString(),publicKey});
 await c.query('set constraints all deferred');
 await c.query('update vega_private.app_state set state=$1,revision=revision+1 where tenant_id=$2 and business_id=$3',[JSON.stringify(next),...scope]);
 await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[...scope,a.userId,requestId,digest(command),'{}']);
 await c.query('insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[r.eventId,...scope,a.userId,requestId,r.previousRevision,r.revision,r.payload,r.payloadDigest]);
 await c.query('set constraints all immediate');
}
try{
 let raw='';for await(const x of process.stdin){raw+=x;if(raw.length>16384)throw Error();}
 const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';pool=new pg.Pool({...applicationDatabaseOptions(input.appDatabaseUrl),max:2});input.appDatabaseUrl=null;
 c=await pool.connect();assert.equal((await c.query('select current_user as role')).rows[0].role,'vega_app_runtime');report.checks.push('restricted_runtime_role');
 await c.query('begin');await c.query("set local lock_timeout='3s'; set local idle_in_transaction_session_timeout='30s'");await actor();baseline=await read();assert.ok(baseline);
 await c.query('select revision from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',scope);
 const other=await pool.connect();try{await other.query('begin');await other.query("select set_config('vega.actor_id',$1,true)",[a.userId]);await other.query("set local lock_timeout='150ms'");await assert.rejects(other.query('select revision from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',scope),e=>e.code==='55P03');report.checks.push('independent_connection_contends_on_same_business_lock');}finally{await other.query('rollback');other.release();}
 report.stage='fixture';const rid=randomUUID(),pid=randomUUID(),bid=randomUUID(),at=new Date().toISOString(),context={kind:'business',tenantId:a.tenantId,businessId:a.businessId};
 const resource={id:rid,submittedBy:a.userId,owner:context,mediaType:'video',lifecycle:'active',revision:1,title:'VOD rental rollback verification',creator:'Development',source:{kind:'managed_reference',provider:'acrux-managed',reference:randomUUID()},createdAt:at};
 await c.query('insert into media_private.resources(id,owner_tenant_id,owner_business_id,submitted_by,document) values($1,$2,$3,$4,$5)',[rid,...scope,a.userId,resource]);
 const placement={id:pid,resourceId:rid,context,authorized:true,authorizedBy:a.userId,authorizedAt:at,withdrawnAt:null,visible:false,policy:{kind:'pay_on_demand'},categoryIds:[],collectionIds:[],revision:1};
 await c.query('insert into media_private.placements values($1,$2,$3,$4,$5,$6)',[pid,rid,...scope,a.userId,placement]);
 await c.query('update media_private.placements set document=document||$1::jsonb where id=$2',[JSON.stringify({visible:true,revision:2}),pid]);
 const binding={id:bid,resourceId:rid,provider:'test-adapter',integrationRef:'development',assetRef:null,playbackRef:null,state:'pending',revision:1};
 await c.query('insert into media_private.provider_bindings values($1,$2,$3,$4,$5,$6)',[bid,rid,a.userId,randomUUID(),'rollback-fixture',binding]);
 for(const next of [{state:'uploading',revision:2},{state:'processing',revision:3,assetRef:'synthetic.mp4'},{state:'ready',revision:4,playbackRef:'synthetic-private',durationSeconds:120,durationAssetRef:'synthetic.mp4',readyAt:at}])await c.query('update media_private.provider_bindings set document=document||$1::jsonb where id=$2',[JSON.stringify(next),bid]);
 let state=structuredClone(baseline.state);state.staffRoleAssignments=(state.staffRoleAssignments||[]).filter(x=>!(x.userId===a.userId&&x.tenantId===a.tenantId&&x.businessId===a.businessId));
 const grant=grantComplimentaryRental(state,{principalId:a.userId,target:{kind:'media_placement',id:pid,tenantId:a.tenantId,businessId:a.businessId},rentalPolicy:{},availableAt:at,reason:'Rollback-only Development verification',requestId:randomUUID()},a,{id:randomUUID,now:()=>at},fail);await persist(state);
 // Each real store transaction gets a SQL savepoint. Outer transaction is never committed.
 const scoped={connect:async()=>({release(){},async query(sql,args){if(sql.startsWith('begin')){await c.query('savepoint rental_unit');await c.query('set constraints all deferred');await c.query("select set_config('vega.receipt_discovery','',true)");return {rows:[]};}if(sql==='commit'){await c.query('set constraints all immediate');return c.query('release savepoint rental_unit');}if(sql==='rollback'){await c.query('rollback to savepoint rental_unit');return c.query('release savepoint rental_unit');}return c.query(sql,args);}})};
 const store=createApplicationStore(scoped,{receiptPublicKey:publicKey,initialOwners:DEVELOPMENT_INITIAL_OWNERS,nativeAdapters:{}});
 const identity={userId:a.userId,tenantId:a.tenantId,businessId:a.businessId};
 const command=(action,extra={})=>({action:'rental-correct',body:{requestId:randomUUID(),placementId:pid,entitlementId:grant.id,expectedRevision:1,action,reason:'Rollback-only verification',...extra}});
 report.stage='owner-command';const extend=command('extend',{hours:1});let result=await store.command(identity,extend);assert.equal(result.revision,2);let row=await read();const once=digest(row.state);await store.command(identity,extend);assert.equal(digest((await read()).state),once);report.checks.push('owner_extension_atomic_journal_receipt_and_idempotent_replay');
 await assert.rejects(store.command(identity,command('reset')),e=>e.status===409);report.checks.push('stale_entitlement_revision_rejected');
 async function role(value,permissions=[]){let s=(await read()).state;s.staffRoleAssignments=(s.staffRoleAssignments||[]).filter(x=>!(x.userId===a.userId&&x.tenantId===a.tenantId&&x.businessId===a.businessId));s.staffRoleAssignments.push({userId:a.userId,tenantId:a.tenantId,businessId:a.businessId,role:value,classIds:[],rentalPermissions:permissions,revision:1});await persist(s);}
 report.stage='permissions';await role('manager');await assert.rejects(store.command(identity,command('reset',{expectedRevision:2})),e=>e.status===403);result=await store.command(identity,command('extend',{expectedRevision:2,hours:1}));assert.equal(result.revision,3);
 await role('front_desk');await assert.rejects(store.command(identity,command('revoke',{expectedRevision:3})),e=>e.status===403);
 await role('instructor');await assert.rejects(store.command(identity,command('reset',{expectedRevision:3})),e=>e.status===403);
 await role('instructor',['rentals.correct']);result=await store.command(identity,command('reset',{expectedRevision:3}));assert.equal(result.revision,4);report.checks.push('manager_extension_only_front_desk_instructor_default_denial_explicit_delegation');
 await assert.rejects(store.command({...identity,businessId:'not-an-authorized-business'},command('revoke',{expectedRevision:4})),e=>e.status===403);report.checks.push('cross_business_denial');
 report.stage='playback-persistence';const playback=createRentalPlaybackStore(scoped,{receiptPublicKey:publicKey});
 await playback.mutate(a.userId,pid,'verification',{},({entitlement})=>{entitlement.rental.recoveryUsedMs=1000;return {verified:true};});assert.equal((await read()).state.accessEntitlements.find(e=>e.id===grant.id).revision,5);report.checks.push('playback_mutation_receipt_and_entitlement_revision');
 const before=digest((await read()).state),noReceipt=createRentalPlaybackStore(scoped,{receiptPublicKey:null});await assert.rejects(noReceipt.mutate(a.userId,pid,'verification',{},({entitlement})=>{entitlement.rental.recoveryUsedMs=2000;}),e=>e.status===503);assert.equal(digest((await read()).state),before);report.checks.push('missing_receipt_rolls_back');
 report.stage='rls';await c.query("select set_config('vega.actor_id',$1,true)",[randomUUID()]);assert.equal((await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2',scope)).rows.length,0);assert.equal((await c.query('select id from media_private.provider_bindings where id=$1',[bid])).rows.length,0);report.checks.push('unassigned_actor_cannot_read_business_or_binding');
 await c.query('rollback');await c.query('begin read only');const restored=await read();assert.equal(restored.revision,baseline.revision);assert.equal(digest(restored.state),digest(baseline.state));await c.query('rollback');report.baselineRestored=true;
 report.stage='binding-guard-fixture';await c.query(await fs.readFile(new URL('verify-vod-rental-binding.sql',import.meta.url),'utf8'));report.checks.push('restricted_role_binding_duration_readiness_and_foreign_actor_guards');report.status='passed';report.stage='complete';
}catch(e){report.status='stopped';report.errorCategory=e.code==='ERR_ASSERTION'?'verification-mismatch':/^[0-9A-Z]{5}$/.test(e.code||'')?'database-rejection':'verification-unavailable';if(/^[0-9A-Z]{5}$/.test(e.code||''))report.sqlState=e.code;process.exitCode=1;
 if(c)try{await c.query('rollback');if(baseline){await c.query('begin read only');const restored=await read();report.baselineRestored=restored.revision===baseline.revision&&digest(restored.state)===digest(baseline.state);await c.query('rollback');}}catch{report.baselineRestored=false;}
}finally{c?.release();await pool?.end();await fs.writeFile(new URL('../docs/layer-6/vod-rental-postgres.local.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log('VOD rental database verification '+report.status+'. Safe report saved; no secret details printed.');}
