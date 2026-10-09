// Same restricted private stdin, atomic receipt and audited fixture pattern as S8B.
// A new complimentary fixture; no historical resource, purchase or provider mutation.
import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {rentalVerification as p} from '../src/runtime/rental-verification-control.mjs';
import {newMediaResource} from '../src/media-resource.mjs';
import {scaleEngineAssetScope} from '../src/runtime/providers/scaleengine-asset-scope.mjs';
import {developmentOffer} from '../src/commerce.mjs';
import {attachMediaOffer,configureMediaRentalOffer,mediaAccessTarget} from '../src/media-commerce.mjs';
import {grantComplimentaryRental} from '../src/rental-entitlement.mjs';
import {buildRecoveryReceipt,canonical,digest} from '../src/recovery-receipt.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {resolveStaffAccess,hasStaffPermission} from '../src/staff-permissions.mjs';
const dir=new URL('../docs/layer-6/',import.meta.url),a={userId:p.actorId,tenantId:p.tenantId,businessId:p.businessId,role:'staff',participantIds:[]};
const requestId=p.reference,sourceId='dcb5f610-23a2-43be-af39-706a17be8a92',sourceOwner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';
const report={status:'preflight',stage:'input',fixture:p,providerRequests:0,payments:0,historicalWrites:0,productionUntouched:true,secretsPersisted:false};
let pool,c,committed=false;
const save=()=>fs.writeFile(new URL('vod-rental-fixture.local.json',dir),JSON.stringify(report,null,2)+'\n');
const fail=()=>{throw Error('Fixture validation failed');};
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 assert.ok(Date.now()<Date.parse(p.expiresAt));
 const response=await fetch('https://vega-development-web.onrender.com/api/config',{redirect:'error'}),config=await response.json();
 assert.ok(response.ok&&config.environment==='development'&&config.squareEnabled===false&&config.paymentMode==='disabled'&&config.externalEffects==='disabled');
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));input.appDatabaseUrl=null;c=await pool.connect();
 assert.equal((await c.query('select current_user as role')).rows[0].role,'vega_app_runtime');
 await c.query('begin');await c.query("set local lock_timeout='3s'");
 report.stage='existing verified source read';
 await c.query("select set_config('vega.actor_id',$1,true)",[sourceOwner]);
 const sources=(await c.query("select r.document as resource,b.document as binding from media_private.resources r join media_private.provider_bindings b on b.resource_id=r.id where r.id=$1 and b.document->>'state'='ready' for share of r,b",[sourceId])).rows;
 assert.equal(sources.length,1);const source=sources[0];assert.equal(source.resource.owner.userId,sourceOwner);assert.equal(source.resource.lifecycle,'active');scaleEngineAssetScope(source.binding);
 report.sourceResourceId=sourceId;report.sourceBindingDigest=digest(canonical(source.binding));
 await c.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[a.userId]);
 const members=(await c.query('select role from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[a.userId,a.tenantId,a.businessId])).rows;assert.equal(members.length,1);assert.equal(members[0].role,'staff');
 const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',[a.tenantId,a.businessId])).rows[0];assert.ok(row);
 assert.ok(hasStaffPermission(resolveStaffAccess(row.state,a,{initialOwners:DEVELOPMENT_INITIAL_OWNERS}),a,'customers.manage'));
 assert.ok(!row.state.accessEntitlements?.some(e=>e.id===p.entitlementId));
 await fs.writeFile(new URL('vod-rental-fixture-attempted.local.json',dir),JSON.stringify({requestId,fixture:p}),{flag:'wx'});
 const at=new Date().toISOString(),context={kind:'business',tenantId:p.tenantId,businessId:p.businessId},clock={id:randomUUID,now:()=>at};
 const resource=newMediaResource({owner:context,title:'Development — isolated VOD rental verification',creator:'Acrux Development',source:{kind:'managed_reference',provider:'acrux-managed',reference:p.resourceId}},a.userId,{...clock,id:()=>p.resourceId});
 const placement={id:p.placementId,resourceId:p.resourceId,context,authorized:true,authorizedBy:a.userId,authorizedAt:at,withdrawnAt:null,visible:false,policy:{kind:'pay_on_demand'},categoryIds:[],collectionIds:[],revision:1};
 report.stage='isolated resource and placement';
 await c.query('insert into media_private.resources(id,owner_tenant_id,owner_business_id,submitted_by,document) values($1,$2,$3,$4,$5)',[resource.id,a.tenantId,a.businessId,a.userId,resource]);
 await c.query("insert into media_private.resource_audit(resource_id,actor_id,action,revision) values($1,$2,'resource_created',1)",[resource.id,a.userId]);
 await c.query('insert into media_private.placements(id,resource_id,tenant_id,business_id,authorized_by,document) values($1,$2,$3,$4,$5,$6)',[placement.id,resource.id,a.tenantId,a.businessId,a.userId,placement]);
 await c.query("insert into media_private.placement_audit(placement_id,actor_id,action,revision,created_at,details) values($1,$2,'authorized',1,$3,$4)",[placement.id,a.userId,at,{verificationReference:requestId}]);
 placement.visible=true;placement.revision=2;await c.query('update media_private.placements set document=$2 where id=$1',[placement.id,placement]);
 await c.query("insert into media_private.placement_audit(placement_id,actor_id,action,revision,created_at,details) values($1,$2,'configured',2,$3,$4)",[placement.id,a.userId,at,{verificationReference:requestId}]);
 // Reuse the already verified Development test file. New binding only; retain
 // the source binding's evidence and the original resource without changes.
 let binding={id:p.bindingId,resourceId:p.resourceId,provider:'scaleengine',integrationRef:'development-media',assetRef:null,playbackRef:null,state:'pending',revision:1};
 await c.query('insert into media_private.provider_bindings(id,resource_id,actor_id,request_id,fingerprint,document) values($1,$2,$3,$4,$5,$6)',[binding.id,resource.id,a.userId,requestId,digest(canonical({sourceId,binding:source.binding})),binding]);
 for(const patch of [{state:'uploading',revision:2},{state:'processing',revision:3,assetRef:source.binding.assetRef},{state:'ready',revision:4,playbackRef:source.binding.playbackRef,readyAt:at,...(source.binding.durationSeconds?{durationSeconds:source.binding.durationSeconds,durationAssetRef:source.binding.assetRef}:{})}]){binding={...binding,...patch};await c.query('update media_private.provider_bindings set document=$2 where id=$1',[binding.id,binding]);}
 report.stage='versioned offer and complimentary entitlement';
 const state=structuredClone(row.state),offer={...developmentOffer(),id:requestId+'-offer-v1',productId:requestId+'-product-v1',productName:resource.title,productType:'digital_access',quantity:1,validDays:null,categories:[],classIds:[],priceMinor:100,fulfillmentPlan:{version:1,actions:[{id:'placement-access',type:'DURABLE_ACCESS',target:mediaAccessTarget(placement)}]}};
 (state.commerceProducts??=[]).push({id:offer.productId,name:offer.productName,type:offer.productType,quantity:1,validDays:null,categories:[],classIds:[]});(state.commerceOffers??=[]).push(offer);(state.commerceOfferAvailability??=[]).push({offerId:offer.id,offerVersion:1,tenantId:a.tenantId,businessId:a.businessId,active:true});
 attachMediaOffer(state,{requestId,placementId:placement.id,offerId:offer.id,expectedRevision:2},a,{placement,resource},clock,fail);
 const rental=configureMediaRentalOffer(state,{requestId,placementId:placement.id,expectedRevision:2,expectedOfferVersion:1,title:resource.title,priceMinor:100,currency:'USD',rentalPolicy:{activationDays:1,viewingHours:1,replayAllowed:false}},a,{placement,resource,binding},clock,fail);
 let ids=0;const entitlement=grantComplimentaryRental(state,{requestId,principalId:a.userId,target:mediaAccessTarget(placement),rentalPolicy:rental.rentalPolicy,availableAt:at,reason:'Joe and Chett approved isolated Development VOD verification; complimentary access, no payment'},a,{now:()=>at,id:()=>ids++===0?p.entitlementId:randomUUID()},fail);
 const command={action:'development-rental-verification-fixture',body:{requestId,placementId:placement.id,sourceResourceId:sourceId}},result={placementId:placement.id,entitlementId:entitlement.id,verificationReference:requestId};
 const receipt=buildRecoveryReceipt({before:row.state,after:state,revision:row.revision,authority:a,command,result,occurredAt:at,publicKey:input.receiptPublicKey});
 await c.query('update vega_private.app_state set state=$1,revision=revision+1,updated_at=now() where tenant_id=$2 and business_id=$3',[state,a.tenantId,a.businessId]);
 await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[a.tenantId,a.businessId,a.userId,requestId,digest(canonical(command)),result]);
 await c.query('insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[receipt.eventId,a.tenantId,a.businessId,a.userId,requestId,receipt.previousRevision,receipt.revision,receipt.payload,receipt.payloadDigest]);
 await c.query('set constraints all immediate');await c.query('commit');committed=true;report.status='fixture-ready';report.stage='complete';report.recoveryEventId=receipt.eventId;report.revision=receipt.revision;
}catch(error){await c?.query('rollback').catch(()=>{});report.status=committed?'committed-evidence-write-incomplete':'stopped';report.sqlState=/^[0-9A-Z]{5}$/.test(error.code||'')?error.code:null;report.rolledBack=!committed;process.exitCode=1;}
finally{c?.release();await pool?.end();await save();console.log(JSON.stringify({status:report.status,stage:report.stage,instruction:'Tell Astra done; do not rerun.'}));}
