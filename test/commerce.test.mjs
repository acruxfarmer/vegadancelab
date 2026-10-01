import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {PRODUCT_ID,OFFER_ID,developmentOffer} from '../src/commerce.mjs';
import {commerceUI} from '../public/commerce-ui.js';
import {createRequestJournal} from '../public/request-journal.js';
export const member={userId:'e5946b40-9839-4a96-99d5-93262d9573f0',tenantId:'vega-development',businessId:'vega-dance-lab',role:'member',participantIds:['vega-member-test-joe']};
export function fixture(){return {...emptyState(),participants:[{id:'vega-member-test-joe',name:'Development member'}],entitlementProducts:[{id:PRODUCT_ID,name:'DEV TEST — Three-class pack',type:'class_pack',quantity:3,validDays:30,categories:['Pack verification'],classIds:[]}]};}
const command=(extra={})=>({action:'purchase-draft',body:{requestId:'draft-1',offerId:OFFER_ID,...extra}});
const run=(state=fixture(),a=member,extra={})=>transition(state,command(extra),a);
test('draft totals and immutable terms use the approved offer, leaving all original state and clocks untouched',()=>{
 const original=fixture(),before=structuredClone(original),{state,result:d}=run(original);
 assert.deepEqual(original,before);
 for(const key of Object.keys(before))if(key!=='activity')assert.deepEqual(state[key],before[key],key);
 assert.equal(d.totalMinor,6000);assert.equal(d.taxMinor,0);assert.equal(d.currency,'USD');
 assert.equal(d.terms.priceLabel,'DEVELOPMENT TEST PRICE ONLY');assert.equal(d.terms.quantity,3);assert.equal(d.terms.validDays,30);
 assert.deepEqual(d.terms.categories,['Pack verification']);assert.equal(d.terms.refundPolicy.requestWithinDays,30);
 assert.equal(d.terms.refundPolicy.windowStartsAt,'confirmed_payment_successful_purchase_completion');
 for(const key of ['paymentConfirmedAt','validFrom','expiresAt','refundWindowStartsAt'])assert.equal(d[key],null,key);
 assert.equal(d.status,'draft');assert.equal(d.paymentStatus,'not_started');assert.equal(d.fulfillmentStatus,'not_issued');
 const copy=developmentOffer();copy.priceMinor=99;assert.equal(d.terms.priceMinor,6000);
 state.entitlementProducts[0].validDays=90;assert.equal(d.terms.validDays,30);
 assert.throws(()=>run(state),/product terms/);
});
test('draft creation preserves pre-existing credits, bookings and issuance history byte for byte',()=>{
 const s=fixture();s.passes=[{id:'existing',participantId:member.participantIds[0],quantity:2}];
 s.creditUnits=[{id:'credit',status:'available',passId:'existing'}];s.creditEvents=[{type:'issue',id:'event'}];
 s.reservations=[{id:'booking',status:'reserved',attendanceStatus:'present'}];s.entitlementIssuances=[{id:'grant',source:'staff_courtesy'}];
 const after=run(s).state;
 for(const key of ['passes','creditUnits','creditEvents','reservations','entitlementIssuances','entitlementProducts'])assert.deepEqual(after[key],s[key],key);
});
test('commerce request identity survives a reload and is scoped to the authenticated buyer',async()=>{
 const entries=new Map(),storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 const scope=[member.tenantId,member.businessId,member.userId],body={offerId:OFFER_ID},path='/api/commerce/drafts';
 const first=await createRequestJournal(storage).acquire(scope,path,body),reloaded=createRequestJournal(storage);
 assert.deepEqual(await reloaded.acquire(scope,path,body),first);
 assert.notEqual((await reloaded.acquire([...scope,'other-user'],path,body)).requestId,first.requestId);
 reloaded.complete(first);assert.notEqual((await reloaded.acquire(scope,path,body)).requestId,first.requestId);
});
test('retry returns the original draft and one audit event; explicit new intent may create another',()=>{
 const first=run(),second=run(first.state);assert.deepEqual(second.result,first.result);
 assert.equal(second.state.purchaseDrafts.length,1);assert.equal(second.state.activity.length,1);
 const third=run(second.state,member,{requestId:'another'});assert.equal(third.state.purchaseDrafts.length,2);
});
test('client cannot set financial terms, recipient, fulfillment or identity',()=>{
 for(const [key,value] of Object.entries({priceMinor:1,currency:'EUR',taxMinor:50,quantity:9,participantId:'other',buyerId:'other',paymentStatus:'succeeded',fulfillmentStatus:'issued',validFrom:'now'}))assert.throws(()=>run(fixture(),member,{[key]:value}),e=>e.status===400,key);
 assert.throws(()=>run(fixture(),member,{offerId:'other'}),e=>e.status===404);
});
test('self-purchase excludes delegated, ambiguous, staff and cross-business authority',()=>{
 for(const change of [{userId:'delegate'},{participantIds:['other']},{participantIds:['vega-member-test-joe','other']},{role:'staff'},{tenantId:'other'},{businessId:'other'}])assert.throws(()=>run(fixture(),{...member,...change}),e=>e.status===403);
 const s=fixture();s.participants=[];assert.throws(()=>run(s),e=>e.status===403);
});
test('member views are buyer-bound and business-bound; staff can inspect only its business',()=>{
 const {state}=run();state.purchaseDrafts.push({...state.purchaseDrafts[0],id:'foreign',businessId:'other'});
 assert.equal(visibleState(state,member).purchaseDrafts.length,1);
 assert.equal(visibleState(state,{...member,role:'staff'}).purchaseDrafts.length,1);
 assert.equal(visibleState(state,{...member,userId:'delegate'}).purchaseDrafts.length,0);
 assert.equal(visibleState(state,{...member,businessId:'other'}).commerceOffers.length,0);
});
test('conflicting stored offer fails closed without changing original terms',()=>{
 const {state}=run();state.commerceOffers[0].priceMinor=1;
 assert.throws(()=>run(state,member,{requestId:'new'}),/Immutable offer/);
});
test('member and staff views clearly separate unpaid drafts from credits and escape data',()=>{
 const {state}=run();state.purchaseDrafts[0].id='<script>';
 const render=role=>commerceUI({escape:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),getData:()=>({...visibleState(state,{...member,role}),context:{role}})}).render();
 const html=render('member');assert.match(html,/USD \$60\.00/);assert.match(html,/DEVELOPMENT TEST PRICE ONLY/);assert.match(html,/Create unpaid draft/);assert.match(html,/refund clocks have not started/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(render('staff'),/Staff status view only/);assert.doesNotMatch(render('staff'),/Create unpaid draft/);
});
