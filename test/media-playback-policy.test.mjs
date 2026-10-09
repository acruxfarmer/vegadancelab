import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackPolicy,resolvePlaybackSequence,requireBumperOwnership} from '../src/media-playback-policy.mjs';
import {configurePlaybackPolicy,createPlaybackPolicyDelivery} from '../src/runtime/media-playback-policy.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const context={kind:'business',tenantId:'t',businessId:'b'},placement={id,resourceId:other,context,authorized:true,visible:true,policy:{kind:'public'}};
const resource={id,owner:{kind:'business',...context},lifecycle:'active'};
const ref={kind:'media_resource',resourceId:id};
for(const [policy,expected] of [[undefined,['PRIMARY']],[{preRoll:ref},['PRE_ROLL','PRIMARY']],[{postRoll:ref},['PRIMARY','POST_ROLL']],[{preRoll:ref,postRoll:ref},['PRE_ROLL','PRIMARY','POST_ROLL']]])test('policy order '+expected.join(' '),()=>{
 assert.deepEqual(resolvePlaybackSequence({decision:{allowed:true},placement,policy}).map(s=>s.stage),expected);
});
test('denied access short circuits even malformed policy',()=>assert.deepEqual(resolvePlaybackSequence({decision:{allowed:false},policy:{bad:true}}),[]));
test('generic identity only: rejects provider URLs, unknown fields and malformed references',()=>{
 for(const p of [{preRoll:{kind:'url',resourceId:id}},{preRoll:{...ref,url:'https://example.test'}},{preRoll:{...ref,resourceId:'https://example.test'}},{hasAd:true},null,[]])assert.throws(()=>playbackPolicy(p));
});
test('same canonical resource does not inherit another placement policy',()=>{
 const a=resolvePlaybackSequence({decision:{allowed:true},placement,policy:{preRoll:ref}}),b=resolvePlaybackSequence({decision:{allowed:true},placement:{...placement,id:other}});assert.equal(a.length,2);assert.equal(b.length,1);
});
function tx(r=resource,manage=true){let saved;return {get:async()=>placement,canManageBusiness:async()=>manage,resourceActive:async()=>true,resource:async()=>r,savePlaybackPolicy:async(p,revision,policy)=>{saved=policy;return {policy};},saved:()=>saved};}
test('same-business bumper assignment succeeds',async()=>{const t=tx();await configurePlaybackPolicy(t,id,0,{preRoll:ref});assert.deepEqual(t.saved(),{preRoll:ref});});
for(const owner of [{kind:'business',tenantId:'t',businessId:'other'},{kind:'business',tenantId:'other',businessId:'b'},{kind:'user',userId:'owner'}])test('reject bumper owner '+JSON.stringify(owner),async()=>{const t=tx({...resource,owner});await assert.rejects(configurePlaybackPolicy(t,id,0,{preRoll:ref}));assert.equal(t.saved(),undefined);});
test('other business manager cannot configure policy',async()=>{const t=tx(resource,false);await assert.rejects(configurePlaybackPolicy(t,id,0,{preRoll:ref}));assert.equal(t.saved(),undefined);});
test('remove both slots restores primary only',async()=>{const t=tx();const {policy}=await configurePlaybackPolicy(t,id,2,{});assert.deepEqual(resolvePlaybackSequence({decision:{allowed:true},placement,policy}).map(x=>x.stage),['PRIMARY']);});
test('archived or changed bumper ownership fails playback revalidation',()=>{assert.throws(()=>requireBumperOwnership(placement,{...resource,lifecycle:'archived'}));assert.throws(()=>requireBumperOwnership(placement,{...resource,owner:{kind:'user'}}));});
function deliveryFixture({allowed=true,owner=resource.owner}={}){
 const calls=[];const primaryResource={...resource,id:other,source:{kind:'managed_reference'}};
 const binding=id=>({resourceId:id,state:'ready',provider:'fixture-provider',assetRef:'asset-'+id,playbackRef:'opaque-ref'});
 const material={placement,resource:primaryResource,binding:binding(other)};
 const c={release(){},async query(sql){calls.push(sql);if(sql.includes('native_viewer_material'))return {rows:[{material:allowed?material:{...material,placement:{...placement,policy:{kind:'pay_on_demand'}}}}]};if(sql.includes('playback_policy_material'))return {rows:[{material:{placement,revision:1,policy:{preRoll:ref},sources:{[id]:{resource:{...resource,owner,source:{kind:'managed_reference'}},binding:binding(id)}}}}]};if(sql.includes('commerce_material'))return {rows:[{}]};return {rows:[]};}};
 const grants=[];const resolve=createPlaybackPolicyDelivery({connect:async()=>c},{adapters:{'fixture-provider':{authorize:async b=>{grants.push(b.resourceId);return {kind:'hls',proof:b.resourceId};}}}});
 return {resolve,calls,grants};
}
test('runtime deny performs no policy lookup or delivery',async()=>{const f=deliveryFixture({allowed:false});await assert.rejects(f.resolve(null,id));assert.equal(f.calls.some(s=>s.includes('playback_policy_material')),false);assert.equal(f.grants.length,0);});
test('runtime manifest does not authorize media; each stage uses its own exact binding',async()=>{const f=deliveryFixture();assert.deepEqual(await f.resolve(null,id),{revision:1,stages:['PRE_ROLL','PRIMARY']});assert.equal(f.grants.length,0);await f.resolve(null,id,'PRE_ROLL',1);await f.resolve(null,id,'PRIMARY',1);assert.deepEqual(f.grants,[id,other]);});
test('runtime rejects changed policy revision or unconfigured stage',async()=>{const f=deliveryFixture();await assert.rejects(f.resolve(null,id,'PRE_ROLL',0));await assert.rejects(f.resolve(null,id,'POST_ROLL',1));assert.equal(f.grants.length,0);});
test('runtime refuses foreign or personal bumper even if stored policy references it',async()=>{const f=deliveryFixture({owner:{kind:'user',userId:'someone'}});await assert.rejects(f.resolve(null,id,'PRE_ROLL',1));assert.equal(f.grants.length,0);});

