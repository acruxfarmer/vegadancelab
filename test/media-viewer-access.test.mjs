import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {resolveMediaViewerAccess} from '../src/media-viewer-access.mjs';
import {createMediaViewerStore} from '../src/runtime/media-viewer-store.mjs';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {emptyState,transition} from '../src/application.mjs';

const viewer='11111111-1111-4111-8111-111111111111',placementId='22222222-2222-4222-8222-222222222222';
const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(16)]);
const context={kind:'business',tenantId:'test',businessId:'studio'},at='2026-10-07T00:00:00.000Z';
function fixture(){
 let state={...emptyState(),participants:[{id:'p',name:'Test member'}]},i=0;
 const run=(action,body)=>{const r=transition(state,{action,body:{requestId:`r-${++i}`,...body}},{userId:'staff',role:'staff',participantIds:[]},{id:()=>`id-${++i}`,now:()=>at});state=r.state;return r.result;};
 const products=[1,2].map(n=>run('entitlement-product',{name:`Membership ${n}`,type:'membership',quantity:1,validDays:30}));
 products.forEach((p,n)=>run('issue-entitlement',{productId:p.id,participantId:'p',issuanceRef:`grant-${n}`,membershipRef:`membership-${n}`,periodStart:'2026-10-01T00:00:00.000Z',reason:'test fixture'}));
 const placement={id:placementId,resourceId:'resource',context,authorized:true,visible:true,policy:{kind:'memberships',productIds:products.map(p=>p.id)}};
 const authority={...context,userId:viewer,role:'member',participantIds:['p']};
 const video={id:'video',tenantId:context.tenantId,businessId:context.businessId,revision:2,publishState:'published',asset:{kind:'private-inline-mp4-v1',data:bytes.toString('base64'),digest:createHash('sha256').update(bytes).digest('hex')}};
 state.videos=[video];return {state,placement,authority,viewerId:viewer,resourceAvailable:true,at,video};
}
test('public access is independent of identity, memberships and credit collections',()=>{
 const f=fixture();f.placement.policy={kind:'public'};f.state=new Proxy({}, {get(){throw Error('Public access must not inspect entitlements')}});
 for(const viewerId of [null,viewer,'unrelated'])assert.deepEqual(resolveMediaViewerAccess({...f,viewerId}),{allowed:true,reason:'public_access'});
});
test('current membership and exhausted credits qualify without state mutation',()=>{
 const f=fixture();for(const u of f.state.creditUnits)u.status='consumed';const before=structuredClone(f.state);
 assert.deepEqual(resolveMediaViewerAccess(f),{allowed:true,reason:'qualifying_membership'});assert.deepEqual(f.state,before);
});
test('exact end and future periods deny using established validity semantics',()=>{
 const f=fixture();for(const time of ['2026-10-31T00:00:00.000Z','2026-09-30T23:59:59.999Z'])assert.deepEqual(resolveMediaViewerAccess({...f,at:time}),{allowed:false,reason:'membership_not_current'});
});
test('OR qualifies when only the second approved membership is current',()=>{const f=fixture();f.state.memberships[0].periods=[];assert.equal(resolveMediaViewerAccess(f).allowed,true);});
test('missing identity, unrelated products, wrong business and forged participant scope deny',()=>{
 const f=fixture();assert.equal(resolveMediaViewerAccess({...f,viewerId:null}).reason,'authentication_required');
 for(const authority of [null,{...f.authority,userId:'other'},{...f.authority,businessId:'wrong'},{...f.authority,tenantId:'wrong'},{...f.authority,participantIds:['unknown']}])assert.equal(resolveMediaViewerAccess({...f,authority}).allowed,false);
 f.state.memberships.forEach(m=>m.productId='unrelated');assert.equal(resolveMediaViewerAccess(f).reason,'membership_required');
});
test('withdrawn, hidden, missing, mismatched and unavailable resources deny before qualification',()=>{
 const f=fixture();for(const placement of [null,{...f.placement,authorized:false},{...f.placement,visible:false}])assert.equal(resolveMediaViewerAccess({...f,placement}).reason,'placement_unavailable');
 assert.equal(resolveMediaViewerAccess({...f,resourceId:'other'}).reason,'placement_unavailable');
 assert.equal(resolveMediaViewerAccess({...f,resourceAvailable:false}).reason,'resource_unavailable');
 assert.equal(resolveMediaViewerAccess(f).allowed,true);
});
test('malformed policies and invalid or deferred product references fail closed',()=>{
 const f=fixture();for(const policy of [null,{}, {kind:'public',extra:true},{kind:'memberships',productIds:[]},{kind:'memberships',productIds:['missing']},{kind:'memberships',productIds:[f.placement.policy.productIds[0]],and:true}])assert.equal(resolveMediaViewerAccess({...f,placement:{...f.placement,policy}}).reason,'access_policy_invalid');
 f.state.entitlementProducts.forEach(p=>p.type='class_pack');assert.equal(resolveMediaViewerAccess(f).reason,'access_policy_invalid');
});
test('inconsistent issuance cannot grant access and leaves all state unchanged',()=>{
 const f=fixture();f.state.entitlementIssuances.forEach(g=>g.expiresAt='invalid');const before=structuredClone(f.state);assert.equal(resolveMediaViewerAccess(f).allowed,false);assert.deepEqual(f.state,before);
});
function database(f){
 const queries=[];let released=0;
 return {queries,get released(){return released},connect:async()=>({release:()=>released++,query:async(sql,args)=>{
  queries.push(sql);
  if(sql.includes('viewer_material'))return {rows:[{material:{placement:f.placement,video:f.resourceAvailable?f.video:null}}]};
  if(sql.includes('legacy_viewer_placement'))return {rows:[{id:placementId}]};
  if(sql.includes('app_members'))return {rows:[{tenant_id:context.tenantId,business_id:context.businessId,role:'member',participant_ids:['p']}]};
  if(sql.includes('app_state'))return {rows:[{state:f.state,revision:1}]};
  return {rows:[]};
 }})};
}
test('playback store returns bytes only after qualification and records safe reasons',async()=>{
 const f=fixture(),pool=database(f),events=[],store=createMediaViewerStore(pool,{now:()=>at,observe:e=>events.push(e)}),before=structuredClone(f.state);
 assert.deepEqual(await store.play(viewer,placementId),bytes);f.placement.authorized=false;
 await assert.rejects(store.play(viewer,placementId),e=>e.mediaReason==='placement_unavailable');
 assert.deepEqual(f.state,before);assert.equal(pool.queries.some(q=>/^\s*(update|insert|delete)/i.test(q)),false);assert.equal(pool.released,2);assert.equal(events[1].reason,'placement_unavailable');assert.equal(JSON.stringify(events).includes('asset'),false);
});
test('unpublished or corrupt bytes cannot be returned by an otherwise qualified request',async()=>{
 const f=fixture(),store=createMediaViewerStore(database(f),{now:()=>at});f.resourceAvailable=false;await assert.rejects(store.play(viewer,placementId),e=>e.mediaReason==='resource_unavailable');
 f.resourceAvailable=true;f.video.asset.data='Yg==';await assert.rejects(store.play(viewer,placementId),e=>e.mediaReason==='resource_unavailable');
});
test('legacy direct URL cannot bypass a withdrawn placement',async()=>{
 const f=fixture();f.placement.authorized=false;const store=createApplicationStore(database(f));
 await assert.rejects(store.mediaPlayback({userId:viewer,...context},'video',2),e=>e.mediaReason==='placement_unavailable');
});
const env={SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'};
async function request(api,url,{token,headers={}}={}){const req=Readable.from([]);req.url=url;req.method='GET';req.headers={...headers,...(token?{authorization:'Bearer test-token'}:{})};let status,body,responseHeaders;await api(req,{writeHead:(s,h)=>{status=s;responseHeaders=h},end:b=>body=b});return {status,body,headers:responseHeaders};}
test('anonymous public HTTP playback works without calling auth or reading credit data',async()=>{
 const f=fixture();f.placement.policy={kind:'public'};const store=createMediaViewerStore(database(f)),api=createApplicationApi(env,{mediaPlacementPlayback:(v,p)=>store.play(v,p)},()=>{throw Error('Public auth not needed')});
 const response=await request(api,`/api/media/placements/${placementId}/play`);assert.equal(response.status,200);assert.deepEqual(response.body,bytes);assert.equal(response.headers['Cache-Control'],'private, no-store');
});
test('direct restricted HTTP requests and forged scope headers cannot bypass server qualification',async()=>{
 const f=fixture(),store=createMediaViewerStore(database(f),{now:()=>at}),api=createApplicationApi(env,{mediaPlacementPlayback:(v,p)=>store.play(v,p)},async()=>({ok:true,json:async()=>({id:viewer})})),url=`/api/media/placements/${placementId}/play`;
 assert.equal((await request(api,url)).status,401);
 assert.equal((await request(api,url,{token:true,headers:{'x-vega-business':'forged','x-role':'owner'}})).status,200);
 f.placement.authorized=false;const denied=await request(api,url,{token:true});assert.equal(denied.status,403);assert.equal(denied.body.includes('productIds'),false);
 assert.equal((await request(api,url+'?allowed=true',{token:true})).status,400);
});
