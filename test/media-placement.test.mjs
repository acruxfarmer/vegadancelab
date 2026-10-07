import test from 'node:test';
import assert from 'node:assert/strict';
import {placementPolicy,qualifiesForMembership} from '../src/media-placement.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';
import {emptyState,transition} from '../src/application.mjs';

const contexts=['vega','willow'].map(businessId=>({kind:'business',tenantId:'development',businessId}));
const at='2026-10-07T12:00:00.000Z';
function entitlementState(context){
 let state={...emptyState(),participants:[{id:'p',name:'Member'}]},n=0;
 const run=(action,body)=>{const r=transition(state,{action,body:{requestId:`req-${++n}`,...body}},{userId:'staff',role:'staff',participantIds:[]},{id:()=>`${context.businessId}-${++n}`,now:()=>at});state=r.state;return r.result;};
 const products=[1,2].map(i=>run('entitlement-product',{name:`Membership ${i}`,type:'membership',quantity:2,validDays:30}));
 for(const [i,p] of products.entries())run('issue-entitlement',{productId:p.id,participantId:'p',issuanceRef:`grant-${i}`,membershipRef:`member-${i}`,periodStart:'2026-10-01T00:00:00.000Z',reason:'Qualification fixture'});
 state.mediaGroups=[{...context,id:'category',kind:'category'},{...context,id:'collection',kind:'collection'}];
 return {state,products};
}
function fixture(){
 const businesses=new Map(contexts.map(c=>[c.businessId,entitlementState(c)]));
 const resources=new Map([['resource',{id:'resource',owner:{kind:'user',userId:'owner'},lifecycle:'active'}],['business-resource',{id:'business-resource',owner:contexts[0],lifecycle:'active'}]]);
 let placements=[],audit=[],n=0,time=at;
 const manage=(actor,c)=>actor===`staff-${c.businessId}`;
 const repo={async transaction(actor,fn){
  const next=structuredClone(placements),events=structuredClone(audit);
  const result=await fn({
   resource:async id=>resources.get(id),resourceActive:async id=>resources.get(next.find(p=>p.id===id)?.resourceId)?.lifecycle==='active',
   canManageBusiness:async c=>manage(actor,c),lock:async()=>{},
   find:async(r,c)=>next.find(p=>p.resourceId===r&&p.context.businessId===c.businessId&&p.context.tenantId===c.tenantId),get:async id=>next.find(p=>p.id===id),
   insert:async p=>{if(!businesses.has(p.context.businessId))throw Error('Invalid context');next.push(p);},
   update:async p=>{next[next.findIndex(x=>x.id===p.id)]=p;},audit:async e=>events.push(e),
   businessState:async c=>businesses.get(c.businessId).state,
   member:async c=>actor===`member-${c.businessId}`?{userId:actor,role:'member',participantIds:['p'],...c}:null
  });placements=next;audit=events;return structuredClone(result);
 }};
 const service=createMediaPlacementService({repository:repo,authenticate:async userId=>({userId}),id:()=>`placement-${++n}`,now:()=>time});
 return {service,businesses,resources,placements:()=>placements,audit:()=>audit,time:t=>time=t};
}
const config=(policy={kind:'public'})=>({visible:true,policy,categoryIds:['category'],collectionIds:['collection']});
test('owner authorizes one resource into two contexts without ownership or business mutations',async()=>{
 const f=fixture(),before=structuredClone([...f.businesses]),resource=structuredClone(f.resources.get('resource'));
 const a=await f.service.authorize('owner','resource',contexts[0],{kind:'public'}),b=await f.service.authorize('owner','resource',contexts[1],{kind:'public'});
 assert.notEqual(a.id,b.id);assert.equal(a.resourceId,b.resourceId);assert.equal(a.visible,false);
 assert.deepEqual(f.resources.get('resource'),resource);assert.deepEqual([...f.businesses],before);
 assert.equal((await f.service.authorize('owner','resource',contexts[0],{kind:'public'})).id,a.id);assert.equal(f.audit().length,2);
});
test('unrelated user and target staff cannot authorize another owner resource; owner is not context staff',async()=>{
 const f=fixture();for(const actor of ['other','staff-vega'])await assert.rejects(f.service.authorize(actor,'resource',contexts[0],{kind:'public'}),/owner access/);
 const p=await f.service.authorize('owner','resource',contexts[0],{kind:'public'});await assert.rejects(f.service.configure('owner',p.id,1,config()),/Context media/);
 await assert.rejects(f.service.configure('staff-willow',p.id,1,config()),/Context media/);
});
test('business ownership uses the same placement semantics and scoped management',async()=>{
 const f=fixture(),p=await f.service.authorize('staff-vega','business-resource',contexts[1],{kind:'public'});
 await assert.rejects(f.service.authorize('staff-willow','business-resource',contexts[1],{kind:'public'}),/owner access/);
 const live=await f.service.configure('staff-willow',p.id,1,config());assert.equal(live.visible,true);
 await assert.rejects(f.service.withdraw('staff-willow',p.id,2),/owner access/);
 assert.equal((await f.service.withdraw('staff-vega',p.id,2)).authorized,false);
});
test('public placement needs no entitlement or sign-in, but hidden and withdrawn placements deny',async()=>{
 const f=fixture(),p=await f.service.authorize('owner','resource',contexts[0],{kind:'public'});assert.deepEqual(await f.service.access(null,p.id),{allowed:false});
 await f.service.configure('staff-vega',p.id,1,config());assert.equal((await f.service.access(null,p.id)).allowed,true);
 await f.service.withdraw('owner',p.id,2);assert.deepEqual(await f.service.access(null,p.id),{allowed:false});
 await assert.rejects(f.service.configure('staff-vega',p.id,3,config()),/inactive/);
 await assert.rejects(f.service.authorize('owner','resource',contexts[0],{kind:'public'}),/withdrawn/);
});
test('withdrawal retains resource, other placement, audit and all entitlement state',async()=>{
 const f=fixture(),before=structuredClone([...f.businesses]);
 const a=await f.service.authorize('owner','resource',contexts[0],{kind:'public'}),b=await f.service.authorize('owner','resource',contexts[1],{kind:'public'});
 await f.service.configure('staff-vega',a.id,1,config());await f.service.configure('staff-willow',b.id,1,config());
 await f.service.withdraw('owner',a.id,2);assert.equal((await f.service.access(null,b.id)).allowed,true);
 assert.equal(f.resources.get('resource').lifecycle,'active');assert.deepEqual([...f.businesses],before);
 assert.deepEqual(f.audit().map(e=>e.action),['authorized','authorized','configured','configured','withdrawn']);
});
for(const context of contexts)test(`${context.businessId}: membership OR uses existing periods, ignores zero credits, expires exactly, remains non-consumptive`,async()=>{
 const f=fixture(),{state,products}=f.businesses.get(context.businessId),p=await f.service.authorize('owner','resource',context,{kind:'memberships',productIds:products.map(p=>p.id)});
 await f.service.configure(`staff-${context.businessId}`,p.id,1,config({kind:'memberships',productIds:products.map(p=>p.id)}));
 const actor=`member-${context.businessId}`;assert.equal((await f.service.access(actor,p.id)).allowed,true);
 for(const u of state.creditUnits)u.status='consumed';const before=structuredClone(state);
 assert.equal((await f.service.access(actor,p.id)).allowed,true);assert.deepEqual(state,before);
 state.memberships[0].periods=[];assert.equal((await f.service.access(actor,p.id)).allowed,true);
 f.time('2026-10-31T00:00:00.000Z');assert.equal((await f.service.access(actor,p.id)).allowed,false);
 f.time('2026-09-30T23:59:59.999Z');assert.equal((await f.service.access(actor,p.id)).allowed,false);
});
test('business-specific policy references and member linkage cannot cross contexts',async()=>{
 const f=fixture(),pa=f.businesses.get('vega').products[0].id,pb=f.businesses.get('willow').products[0].id;
 const a=await f.service.authorize('owner','resource',contexts[0],{kind:'memberships',productIds:[pa]}),b=await f.service.authorize('owner','resource',contexts[1],{kind:'memberships',productIds:[pb]});
 await assert.rejects(f.service.configure('staff-willow',b.id,1,config({kind:'memberships',productIds:[pa]})),/unavailable/);
 await f.service.configure('staff-vega',a.id,1,config({kind:'memberships',productIds:[pa]}));
 await f.service.configure('staff-willow',b.id,1,config({kind:'memberships',productIds:[pb]}));
 assert.equal((await f.service.access('member-vega',b.id)).allowed,false);assert.equal((await f.service.access('member-willow',a.id)).allowed,false);
 assert.equal((await f.service.access(null,a.id)).allowed,false);
});
test('invalid/deferred products, arbitrary policies and ownership fields are rejected',async()=>{
 const f=fixture(),p=await f.service.authorize('owner','resource',contexts[0],{kind:'public'}),s=f.businesses.get('vega').state;
 s.entitlementProducts.push({id:'pack',type:'class_pack'});
 for(const ids of [['missing'],['pack'],[],['pack','pack']])assert.throws(()=>placementPolicy({kind:'memberships',productIds:ids},s));
 await assert.rejects(f.service.configure('staff-vega',p.id,1,{...config(),owner:{kind:'user',userId:'staff-vega'}}),/Unsupported/);
 await assert.rejects(f.service.configure('staff-vega',p.id,1,config({kind:'all'})),/membership/);
 await assert.rejects(f.service.configure('staff-vega',p.id,0,config()),/changed/);
});
test('inconsistent issuance/period, missing product and ambiguous participant linkage fail closed',async()=>{
 const f=fixture(),{state,products}=f.businesses.get('vega'),ids=[products[0].id];
 const grant=state.entitlementIssuances[0];grant.expiresAt='malformed';assert.equal(qualifiesForMembership(state,['p'],ids,at),false);
 grant.expiresAt=state.memberships[0].periods[0].endsAt;grant.participantId='other';assert.equal(qualifiesForMembership(state,['p'],ids,at),false);
 grant.participantId='p';state.entitlementIssuances.push(structuredClone(grant));assert.equal(qualifiesForMembership(state,['p'],ids,at),false);
});
test('archived resource invalidates all placement decisions without mutating placements',async()=>{
 const f=fixture(),p=await f.service.authorize('owner','resource',contexts[0],{kind:'public'});await f.service.configure('staff-vega',p.id,1,config());
 f.resources.get('resource').lifecycle='archived';assert.equal((await f.service.access(null,p.id)).allowed,false);assert.equal(f.placements()[0].authorized,true);
});
test('repository rolls back and releases on failures',async()=>{
 const queries=[];let released=false;const repository=createMediaPlacementRepository({connect:async()=>({query:async q=>{queries.push(q);return {rows:[]};},release:()=>released=true})});
 await assert.rejects(repository.transaction('owner',()=>{throw Error('test failure')}),/test failure/);assert.equal(queries.at(-1),'rollback');assert.equal(released,true);
});

test('same-business staff edit availability without changing identity or ownership; external context cannot',async()=>{
 const f=fixture(),p=await f.service.authorize('staff-vega','business-resource',contexts[0],{kind:'public'}),before=structuredClone(f.resources.get('business-resource'));
 const changed=await f.service.configure('staff-vega',p.id,1,config({kind:'pay_on_demand'}));
 assert.equal(changed.id,p.id);assert.equal(changed.resourceId,p.resourceId);assert.deepEqual(f.resources.get('business-resource'),before);
 const external=await f.service.authorize('owner','resource',contexts[0],{kind:'pay_on_demand'});
 await assert.rejects(f.service.configure('staff-vega',external.id,1,config({kind:'public'})),/resource owner/);
 const local=await f.service.configure('staff-vega',external.id,1,config({kind:'pay_on_demand'}));assert.equal(local.visible,true);assert.equal((await f.service.access(null,local.id)).allowed,false);
 await assert.rejects(f.service.configure('staff-willow',changed.id,2,config({kind:'public'})),/Context media/);
 await assert.rejects(f.service.authorize('owner','resource',contexts[1]),/Explicit access/);
});
