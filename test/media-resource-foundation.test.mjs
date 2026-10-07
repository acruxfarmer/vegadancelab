import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaResourceFoundation,createMediaPrincipalVerifier} from '../src/runtime/media-resource-foundation.mjs';
import {createMediaResourceRepository} from '../src/runtime/media-resource-repository.mjs';
import {legacyMediaKey} from '../src/media-resource.mjs';
import {mediaPlayback,mediaView} from '../src/media.mjs';
import {createHash} from 'node:crypto';

const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
const owner={kind:'business',tenantId:'tenant-a',businessId:'studio-a'};
const scope={tenantId:owner.tenantId,businessId:owner.businessId,videoId:'existing-video'};
const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(16)]);
const video={id:scope.videoId,...owner,title:'Existing practice',creator:'Original creator',publishState:'published',revision:2,asset:{kind:'private-inline-mp4-v1',data:bytes.toString('base64'),digest:createHash('sha256').update(bytes).digest('hex')}};
function fixture(){
 let state={resources:[],links:[],audit:[]};const business={videos:[video],participants:[{id:'p',name:'Member'}],entitlements:[{id:'unchanged'}],bookings:[],mediaGroups:[]};
 const original=structuredClone(business);
 const repository={async transaction(actor,fn){const next=structuredClone(state);const tx={
  canManageBusiness:async o=>actor===bob&&o.tenantId===owner.tenantId&&o.businessId===owner.businessId,
  insert:async r=>next.resources.push(r),get:async id=>next.resources.find(r=>r.id===id),
  update:async r=>{next.resources[next.resources.findIndex(x=>x.id===r.id)]=r;},
  audit:async e=>next.audit.push(e),hasLegacyLinks:async id=>next.links.some(l=>l.resourceId===id),
  legacyVideo:async s=>legacyMediaKey(s)===legacyMediaKey(scope)?structuredClone(video):null,
  legacyResource:async s=>next.resources.find(r=>r.id===next.links.find(l=>l.key===legacyMediaKey(s))?.resourceId),
  linkLegacy:async(s,id)=>next.links.push({key:legacyMediaKey(s),resourceId:id})
 };const result=await fn(tx);state=next;return structuredClone(result);}};
 const service=createMediaResourceFoundation({authenticate:async req=>{if(![alice,bob].includes(req))throw Error('invalid session');return {userId:req};},repository});
 return {service,business,original,state:()=>state};
}
const input=(owned={kind:'user',userId:alice})=>({owner:owned,title:'Independent video',creator:'A different creator',source:{kind:'external_reference',provider:'example-host',reference:'opaque-asset-123'}});
test('owner metadata editing preserves identity, source and audit; denies stale and foreign edits',async()=>{
 const f=fixture(),r=await f.service.create(alice,input());
 await assert.rejects(f.service.edit(bob,r.id,1,{title:'Wrong',creator:''}),/owner access/);
 await assert.rejects(f.service.edit(alice,r.id,1,{title:'Wrong',creator:'',owner:{kind:'user',userId:bob}}),/Unsupported/);
 const next=await f.service.edit(alice,r.id,1,{title:'Practice reference',creator:'Teacher'});
 assert.equal(next.id,r.id);assert.deepEqual(next.owner,r.owner);assert.deepEqual(next.source,r.source);assert.equal(next.revision,2);
 await assert.rejects(f.service.edit(alice,r.id,1,{title:'Stale',creator:''}),/changed/);
 await f.service.archive(alice,r.id,2);
 await assert.rejects(f.service.edit(alice,r.id,3,{title:'Archived',creator:''}),/Archived/);
 assert.deepEqual(f.state().audit.map(e=>e.action),['resource_created','metadata_edited','resource_archived']);assert.deepEqual(f.business,f.original);
});

test('ordinary authenticated user owns an independent resource without a business or entitlement',async()=>{const f=fixture(),r=await f.service.create(alice,input());assert.deepEqual(r.owner,{kind:'user',userId:alice});assert.equal(r.tenantId,undefined);assert.equal(r.businessId,undefined);assert.equal(r.submittedBy,alice);assert.equal(r.creator,'A different creator');assert.equal(r.source.provider,'example-host');assert.equal(f.state().links.length,0);assert.deepEqual(f.business,f.original);});
test('unrelated users cannot read, archive, or create on behalf of another owner',async()=>{const f=fixture(),r=await f.service.create(alice,input());await assert.rejects(f.service.readOwned(bob,r.id),/owner access/);await assert.rejects(f.service.archive(bob,r.id,1),/owner access/);await assert.rejects(f.service.create(bob,input()),/owner access/);assert.equal(f.state().resources.length,1);});
test('business ownership reuses business authorization and does not equate submitter with owner',async()=>{const f=fixture(),r=await f.service.create(bob,input(owner));assert.deepEqual(r.owner,owner);assert.equal(r.submittedBy,bob);await assert.rejects(f.service.create(alice,input(owner)),/Business media/);await assert.rejects(f.service.create(bob,input({...owner,businessId:'other'})),/Business media/);});
test('owning a user resource never confers business administration',async()=>{const f=fixture();await f.service.create(alice,input());await assert.rejects(f.service.adoptLegacy(alice,scope),/Business media/);assert.deepEqual(f.business,f.original);});
test('legacy adoption is repeatable, preserves IDs and does not copy asset bytes',async()=>{const f=fixture();const a=await f.service.adoptLegacy(bob,scope),b=await f.service.adoptLegacy(bob,scope);assert.equal(a.id,b.id);assert.equal(f.state().resources.length,1);assert.equal(f.state().links.length,1);assert.equal(f.state().audit.length,1);assert.equal(a.source.reference,video.id);assert.equal(a.asset,undefined);assert.equal(a.provenance.originalSubmitter,null);assert.deepEqual(f.business,f.original);});
test('missing and foreign legacy records cannot be adopted',async()=>{const f=fixture();await assert.rejects(f.service.adoptLegacy(bob,{...scope,videoId:'missing'}),/unavailable/);await assert.rejects(f.service.adoptLegacy(bob,{...scope,businessId:'other'}),/Business media/);assert.equal(f.state().resources.length,0);});
test('standalone archive retains identity ownership and provenance with optimistic revision',async()=>{const f=fixture(),r=await f.service.create(alice,input());await assert.rejects(f.service.archive(alice,r.id,0),/changed/);const a=await f.service.archive(alice,r.id,1);assert.equal(a.id,r.id);assert.deepEqual(a.owner,r.owner);assert.deepEqual(a.source,r.source);assert.equal(a.lifecycle,'archived');assert.equal(a.revision,2);await f.service.archive(alice,r.id,2);assert.equal(f.state().audit.length,2);});
test('linked archive fails closed until coordinated Layer 5 lifecycle exists',async()=>{const f=fixture(),r=await f.service.adoptLegacy(bob,scope);await assert.rejects(f.service.archive(bob,r.id,1),/coordinated withdrawal/);assert.equal(f.state().resources[0].lifecycle,'active');assert.deepEqual(f.business,f.original);});
test('legacy projection and private playback remain unchanged after adoption',async()=>{const f=fixture(),a={role:'member',userId:alice,...scope,participantIds:['p']};const before=mediaView(f.business,a);await f.service.adoptLegacy(bob,scope);assert.deepEqual(mediaView(f.business,a),before);assert.deepEqual(mediaPlayback(f.business,a,video.id,2),bytes);assert.deepEqual(f.business,f.original);});
test('commerce fields and malformed sources are rejected',async()=>{const f=fixture();await assert.rejects(f.service.create(alice,{...input(),price:10}),/Unsupported/);await assert.rejects(f.service.create(alice,{...input(),source:{kind:'external_reference',provider:'host',reference:''}}),/source/);assert.equal(f.state().resources.length,0);});
test('existing provider subject is reused without business headers or editable role claims',async()=>{let calls=0;const verify=createMediaPrincipalVerifier({authOrigin:'https://auth.example',publishableKey:'public-key',fetcher:async(url,options)=>{calls++;assert.equal(url,'https://auth.example/auth/v1/user');assert.equal(options.headers.Authorization,'Bearer test-token');return {ok:true,json:async()=>({id:alice,user_metadata:{role:'owner',userId:bob}})};}});assert.deepEqual(await verify({headers:{authorization:'Bearer test-token','x-vega-business':'forged'}}),{userId:alice});await assert.rejects(verify({headers:{}}),/Sign in/);assert.equal(calls,1);});
test('invalid and anonymous provider subjects are rejected',async()=>{for(const user of [{id:'bad'},{id:alice,is_anonymous:true}]){const verify=createMediaPrincipalVerifier({authOrigin:'https://auth.example',publishableKey:'key',fetcher:async()=>({ok:true,json:async()=>user})});await assert.rejects(verify({headers:{authorization:'Bearer token'}}),/principal/);}});
test('repository rolls back failed work and releases the connection',async()=>{const queries=[];let released=false;const repo=createMediaResourceRepository({connect:async()=>({query:async(sql,args)=>{queries.push([sql,args]);return {rows:[]};},release:()=>{released=true;}})});await assert.rejects(repo.transaction(alice,async()=>{throw Error('failure');}),/failure/);assert.deepEqual(queries.map(q=>q[0]),['begin',"select set_config('vega.actor_id',$1,true)",'rollback']);assert.equal(released,true);});
