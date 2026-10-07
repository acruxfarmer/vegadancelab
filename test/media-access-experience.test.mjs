import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPresentation,accessNotice} from '../public/media-access.js';
import {resolveMediaViewerAccess} from '../src/media-viewer-access.mjs';
import {placementPolicy} from '../src/media-placement.mjs';
import {mediaUI} from '../public/media-ui.js';
import {manageMediaAccess} from '../src/runtime/media-access-management.mjs';

test('canonical outcomes map to accessible generic states without inspecting entitlements',()=>{
 const states={authentication_required:'sign_in_required',membership_required:'locked',membership_not_current:'locked',paid_access_required:'locked',placement_unavailable:'unavailable',resource_unavailable:'unavailable',access_policy_invalid:'unavailable'};
 for(const [reason,state] of Object.entries(states)){
  const result=mediaPresentation({allowed:false,reason});assert.equal(result.state,state);assert.equal(result.playable,false);
  const html=accessNotice({allowed:false,reason},s=>s);assert.match(html,/role="status"/);assert.ok(!html.includes(reason));
 }
 for(const reason of ['public_access','qualifying_membership'])assert.equal(mediaPresentation({allowed:true,reason}).playable,true);
 assert.equal(mediaPresentation(null).playable,false);assert.equal(mediaPresentation({allowed:false,reason:'future_policy'}).state,'unavailable');
});
test('Pay on Demand is explicit, deny-only and independent of member/credit state',()=>{
 assert.deepEqual(placementPolicy({kind:'pay_on_demand'},{}),{kind:'pay_on_demand'});
 const placement={authorized:true,visible:true,context:{kind:'business',tenantId:'t',businessId:'b'},policy:{kind:'pay_on_demand'}};
 const state=new Proxy({}, {get(){throw Error('No commerce or membership evaluation permitted')}});
 for(const viewerId of [null,'member'])assert.deepEqual(resolveMediaViewerAccess({placement,resourceAvailable:true,state,viewerId}),{allowed:false,reason:'paid_access_required'});
 assert.equal(resolveMediaViewerAccess({placement:{...placement,visible:false},resourceAvailable:true}).reason,'placement_unavailable');
 assert.throws(()=>placementPolicy(undefined,{}));
});
test('mixed collection retains locked metadata but renders no locked player',async()=>{
 const data={context:{role:'member',tenantId:'t',businessId:'b',userId:'m'},videos:[{id:'locked',title:'Technique',description:'Practice',creator:'Instructor',poster:'/media-poster.svg',assetAvailable:true,accessDecision:{allowed:false,reason:'membership_required'}},{id:'open',title:'Warm up',assetAvailable:true,accessDecision:{allowed:true,reason:'public_access'}}]};
 const ui=mediaUI({getData:()=>data,api:()=>{throw Error('Rendering must not fetch bytes')},escape:s=>String(s??''),render(){}});
 const library=ui.html();assert.match(library,/Technique/);assert.match(library,/Warm up/);assert.match(library,/eligible members/);
 await ui.click({dataset:{mediaOpen:'locked'},hasAttribute:()=>false});const detail=ui.html();assert.match(detail,/eligible members/);assert.doesNotMatch(detail,/<video|data-media-play/);
 await ui.click({dataset:{mediaOpen:'open'},hasAttribute:()=>false});assert.match(ui.html(),/data-media-play/);
});
test('CTA slot does not activate checkout or accept external navigation',()=>{
 const html=accessNotice({allowed:false,reason:'authentication_required'},s=>s,[{state:'sign_in_required',href:'/member.html',label:'Sign in'},{state:'sign_in_required',href:'//evil.test',label:'Bad'}]);
 assert.match(html,/Sign in/);assert.doesNotMatch(html,/evil|checkout|Buy/);
});

test('staff management does not infer editable ownership when resource is hidden by RLS',async()=>{
 const c={query:async()=>({rows:[{resource_id:'externally-owned',resource:null,placement:{id:'p',revision:2,policy:{kind:'public'}}}]})};
 const a={userId:'staff',tenantId:'t',businessId:'b'},state={videos:[{id:'v',tenantId:'t',businessId:'b'}]};
 const view=await manageMediaAccess(c,a,state,'v');assert.equal(view.editable,false);assert.deepEqual(view.policy,{kind:'public'});
 await assert.rejects(manageMediaAccess(c,a,state,'v',{policy:{kind:'pay_on_demand'},expectedRevision:2}),/resource owner/);
});
