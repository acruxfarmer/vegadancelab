import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/fulfillment-fixture.mjs';
import {mediaAccessTarget,mediaOffer,mediaOfferSummary,attachMediaOffer} from '../src/media-commerce.mjs';
import {resolveMediaViewerAccess} from '../src/media-viewer-access.mjs';
import {createPurchaseDraft} from '../src/commerce.mjs';
import {commerceUI} from '../public/commerce-ui.js';
import {paymentStatusHTML} from '../public/payment-status.js';
import {createNativeMediaDelivery} from '../src/runtime/native-media-delivery.mjs';
import {createScaleEngineDelivery} from '../src/runtime/providers/scaleengine-delivery.mjs';
const fail=m=>{throw Error(m);};
function setup(){
 const h=fixture(),p=h.state.purchaseDrafts[0];
 const placement={id:'22222222-2222-4222-8222-222222222222',resourceId:'33333333-3333-4333-8333-333333333333',revision:1,context:{kind:'business',tenantId:h.a.tenantId,businessId:h.a.businessId},authorized:true,visible:true,policy:{kind:'pay_on_demand'}};
 const resource={id:placement.resourceId,owner:{...placement.context},lifecycle:'active'};
 Object.assign(p.terms,{id:'disposable-media-offer',productType:'digital_access',productName:'Disposable media',validDays:null,categories:[],classIds:[],fulfillmentPlan:{version:1,actions:[{id:'view-access',type:'DURABLE_ACCESS',target:mediaAccessTarget(placement)}]}});p.offerId=p.terms.id;h.sync();
 h.state.commerceProducts=[{id:p.terms.productId,name:p.terms.productName,type:p.terms.productType,quantity:p.terms.quantity,validDays:null,categories:[],classIds:[]}];
 h.state.commerceOffers=[structuredClone(p.terms)];h.state.commerceOfferAvailability=[{offerId:p.offerId,offerVersion:1,tenantId:p.tenantId,businessId:p.businessId,active:true}];
 const body={placementId:placement.id,offerId:p.offerId,expectedRevision:1,requestId:'attach'};
 const attach=(a=h.staff,material={placement,resource})=>attachMediaOffer(h.state,body,a,material,{id:()=> 'attach-audit',now:()=> '2026-10-05T23:00:00Z'},fail);
 const resolve=(overrides={})=>resolveMediaViewerAccess({placement,resourceAvailable:true,viewerId:h.a.userId,authority:h.a,state:h.state,...overrides});
 return {...h,placement,resource,attach,resolve};
}
test('active scoped offer attaches; price and payment data stay outside canonical media',()=>{const h=setup(),before=structuredClone(h.resource);h.attach();assert.equal(mediaOfferSummary(h.state,h.placement).priceMinor,6000);assert.deepEqual(h.resource,before);assert.equal(h.resource.priceMinor,undefined);});
test('inactive offer has no purchase CTA and cannot attach',()=>{const h=setup();h.attach();h.state.commerceOfferAvailability[0].active=false;assert.equal(mediaOfferSummary(h.state,h.placement),null);assert.throws(()=>h.attach(),/active offer/);});
test('business, ownership and principal restrictions prevent monetizing others media',()=>{for(const kind of ['business','owner','viewer','target']){const h=setup();if(kind==='business')h.state.commerceOffers[0].businessId='other';if(kind==='owner')h.resource.owner={kind:'user',userId:h.a.userId};if(kind==='target')h.state.commerceOffers[0].fulfillmentPlan.actions[0].target.id='other';assert.throws(()=>h.attach(kind==='viewer'?h.a:h.staff));}});
test('existing draft engine freezes media offer and creates no access or credits',()=>{const h=setup();h.attach();h.state.purchaseDrafts=[];const draft=createPurchaseDraft(h.state,{offerId:'disposable-media-offer',requestId:'purchase'},h.a,{id:()=> 'new-purchase',now:()=> '2026-10-05T23:00:00Z'},fail,{placement:h.placement,resource:h.resource});assert.equal(draft.status,'draft');assert.deepEqual(draft.terms.fulfillmentPlan.actions[0].target,mediaAccessTarget(h.placement));assert.equal(h.state.accessEntitlements,undefined);assert.equal(h.state.creditUnits.length,0);});
test('inactive or unpublished offer cannot start an existing checkout draft',()=>{const h=setup();h.attach();for(const condition of ['inactive','hidden']){h.state.commerceOfferAvailability[0].active=condition!=='inactive';h.placement.visible=condition!=='hidden';assert.throws(()=>createPurchaseDraft(h.state,{offerId:'disposable-media-offer',requestId:'purchase'},h.a,{id:()=> 'p',now:()=>''},fail,{placement:h.placement,resource:h.resource}));}});
test('no entitlement denies; persisted fulfillment allows; full refund revokes and relocks',()=>{const h=setup();h.attach();const owner=structuredClone(h.resource);assert.equal(h.resolve().reason,'paid_access_required');h.fulfill();assert.deepEqual(h.resolve(),{allowed:true,reason:'durable_access'});const before=structuredClone(h.state);for(let n=0;n<3;n++)assert.equal(h.resolve().allowed,true);h.fulfill();assert.deepEqual(h.state,before);assert.equal(h.state.accessEntitlements.length,1);assert.equal(h.state.creditUnits.length,0);h.refund();assert.equal(h.resolve().reason,'paid_access_required');assert.equal(h.state.accessEntitlements[0].state,'revoked');assert.equal(h.state.purchaseDrafts.length,1);assert.deepEqual(h.resource,owner);});
test('failed/incomplete payment does not grant or unlock',()=>{for(const status of ['failed','pending','unresolved']){const h=setup();h.state.paymentAttempts[0].status=status;h.state.purchaseDrafts[0].paymentStatus=status;assert.throws(()=>h.fulfill());assert.equal(h.resolve().allowed,false);assert.equal(h.state.accessEntitlements,undefined);}});
test('purchase never unlocks another principal, placement, business or resource',()=>{const h=setup();h.fulfill();for(const override of [{viewerId:'other'},{authority:{...h.a,businessId:'other'}},{placement:{...h.placement,id:'other'}},{placement:{...h.placement,context:{...h.placement.context,businessId:'other'}}},{resourceId:'other'}])assert.equal(h.resolve(override).allowed,false);});
test('existing access survives offer deactivation but not publication withdrawal',()=>{const h=setup();h.attach();h.fulfill();h.state.commerceOfferAvailability[0].active=false;assert.equal(h.resolve().allowed,true);assert.equal(mediaOfferSummary(h.state,h.placement),null);h.placement.authorized=false;assert.equal(h.resolve().allowed,false);});
test('media checkout uses offer price and access language, with return to existing player',()=>{const h=setup();h.fulfill();const p=h.state.purchaseDrafts[0];const html=commerceUI({escape:s=>String(s??''),getData:()=>({context:h.a,commerceSelfParticipantId:h.a.participantIds[0],commerceOffers:[p.terms],purchaseDrafts:[p]}),mutate(){},notify(){}}).render();assert.match(html,/Viewing access/);assert.match(html,/access granted/);assert.match(html,/watch.html\?placement=/);assert.doesNotMatch(html,/3 credits|credits issued/);const button=paymentStatusHTML({...p,fulfillmentStatus:'pending',activeAttemptId:null,paymentStatus:'not_started',totalMinor:100,currency:'USD'},String,false,{enabled:true,purchaseId:p.id});assert.match(button,/Pay USD \$1.00/);assert.doesNotMatch(button,/\$60/);});
test('ambiguous offers/links fail closed',()=>{const h=setup();h.attach();h.state.mediaCommerceLinks.push({...h.state.mediaCommerceLinks[0]});assert.equal(mediaOffer(h.state,h.placement),null);});

test('same resource placements retain independent paid, public and membership policies across businesses',()=>{
 const h=setup();h.attach();h.fulfill();h.fulfill();
 assert.equal(h.state.accessEntitlements.length,1);
 assert.deepEqual(h.state.accessEntitlements[0].target,mediaAccessTarget(h.placement));
 assert.deepEqual(h.resolve(),{allowed:true,reason:'durable_access'});
 const b={...h.placement,id:'another-placement'};
 assert.equal(b.resourceId,h.placement.resourceId);
 assert.deepEqual(h.resolve({placement:b}),{allowed:false,reason:'paid_access_required'});
 // Give the viewer valid authority in Business B: denial must come from the
 // entitlement scope, not merely an authority/context mismatch.
 const otherContext={...b.context,businessId:'business-b'};
 for(const id of [b.id,h.placement.id])assert.deepEqual(h.resolve({placement:{...b,id,context:otherContext},authority:{...h.a,businessId:'business-b'}}),{allowed:false,reason:'paid_access_required'});
 assert.deepEqual(h.resolve({placement:{...b,policy:{kind:'public'}}}),{allowed:true,reason:'public_access'});
 assert.equal(h.resolve({placement:{...b,policy:{kind:'memberships',productIds:['unowned-membership']}}}).allowed,false);
 const entitlement=structuredClone(h.state.accessEntitlements[0]);
 h.refund();
 assert.equal(h.resolve().allowed,false);
 assert.equal(h.state.accessEntitlements.length,1);
 assert.equal(h.state.accessEntitlements[0].id,entitlement.id);
 assert.deepEqual(h.state.accessEntitlements[0].target,entitlement.target);
 assert.equal(h.state.accessEntitlements[0].state,'revoked');
 assert.equal(h.state.purchaseDrafts.length,1);
 assert.equal(h.state.creditUnits.length,0);
});

test('paid placement resolves the canonical ready binding into exact ordinary delivery; sibling and refund deny before provider calls',async()=>{
 const h=setup();h.attach();
 const binding={id:'binding',resourceId:h.resource.id,provider:'scaleengine',integrationRef:'development-media',state:'ready',revision:4,assetRef:'/scope-proof.mp4',playbackRef:'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/scope-proof.mp4/playlist.m3u8'};
 const sibling={...h.placement,id:'sibling'};const payloads=[];
 const pool={connect:async()=>({release(){},async query(sql,args){
  if(sql.includes('native_viewer_material'))return {rows:[{material:{resource:h.resource,binding,placement:args[0]===sibling.id?sibling:h.placement}}]};
  if(sql.includes('app_members'))return {rows:[{role:h.a.role,participant_ids:h.a.participantIds}]};
  if(sql.includes('app_state'))return {rows:[{state:h.state}]};
  return {rows:[]};
 }})};
 const adapter=createScaleEngineDelivery({environment:'development',cdnId:'123',apiSecret:'mock-only'},async(_url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({data:{key:'mock-key',pass:'mock-returned-pass'}});});
 const delivery=createNativeMediaDelivery(pool,{adapters:{scaleengine:adapter}});
 await assert.rejects(delivery.resolve(h.a.userId,h.placement.id,true));assert.equal(payloads.length,0);
 h.fulfill();const before=structuredClone(h.state);
 const grant=await delivery.resolve(h.a.userId,h.placement.id,true);
 assert.equal(grant.kind,'hls');assert.equal(payloads[0].video,'sestore99/acruxanalog/scope-proof.mp4');
 assert.equal(new URL(grant.url).searchParams.get('pass'),'mock-returned-pass');
 assert.deepEqual(h.state,before);
 await assert.rejects(delivery.resolve(h.a.userId,sibling.id,true));assert.equal(payloads.length,1);
 h.refund();await assert.rejects(delivery.resolve(h.a.userId,h.placement.id,true));assert.equal(payloads.length,1);
});
