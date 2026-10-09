import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSquareAdapter,verifyPayment} from '../src/runtime/providers/square.mjs';
import {createSquareRefundAdapter} from '../src/runtime/providers/square-refunds.mjs';
import {createRefundWorkflow} from '../src/runtime/refund-workflow.mjs';
import {financialIntent} from '../src/payment-contract.mjs';
import {digest} from '../src/payments.mjs';
import {refundTransition} from '../src/bounded-refunds.mjs';
import {boundedRefundReadiness} from '../src/bounded-refund-readiness.mjs';
import {fixture,durable,booking} from './helpers/fulfillment-fixture.mjs';
import {PAYMENT_BINDING as B,SQUARE_INTEGRATION} from '../src/runtime/providers/square-configuration.mjs';
import {createScopedPurchaseDraft,developmentOffer} from '../src/commerce.mjs';
import {emptyState} from '../src/application.mjs';
import {paymentTransition} from '../src/payments.mjs';
const env={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',SQUARE_ENVIRONMENT:'sandbox',SQUARE_APPLICATION_ID:B.applicationId,SQUARE_MERCHANT_ID:B.merchantId,SQUARE_LOCATION_ID:B.locationId,SQUARE_ACCESS_TOKEN:'mock',SQUARE_SANDBOX_SOURCE_ID:'cnon:mock'};
const at='2026-10-05T23:00:00Z';
for(const [amount,currency] of [[100,'USD'],[6000,'USD'],[1299,'CAD']])test(`Square preserves ${amount} ${currency} frozen intent on submit, retry and lookup`,async()=>{
 const intent=financialIntent({totalMinor:amount,currency}),a={id:'attempt',idempotencyKey:'attempt',financialIntent:structuredClone(intent),executionStartedAt:new Date().toISOString()};
 const posts=[];let payment;
 const adapter=createSquareAdapter(env,async(url,o)=>{
  if(url.endsWith('/oauth2/token/status'))return Response.json({client_id:B.applicationId,merchant_id:B.merchantId});
  if(o.method==='POST'){const b=JSON.parse(o.body);posts.push(b);payment={id:'payment',reference_id:a.id,location_id:B.locationId,application_details:{application_id:B.applicationId},amount_money:b.amount_money,total_money:b.amount_money,source_type:'CARD',status:'COMPLETED',created_at:at,updated_at:at};}
  return Response.json({payment});
 });
 await adapter.submit(a,intent);await adapter.submit(a,intent);assert.deepEqual(posts[0],posts[1]);assert.deepEqual(posts[0].amount_money,{amount,currency});
 a.paymentId='payment';const result=await adapter.inspect(a,intent);assert.equal(result.amount,amount);assert.equal(result.currency,currency);assert.equal(result.status,'succeeded');
 assert.equal(verifyPayment({...payment,amount_money:{amount:amount+1,currency}},a).status,'unresolved');
 assert.equal((await adapter.submit(a,{...intent,amountMinor:amount+1})).reason,'financial_intent_mismatch');assert.equal(posts.length,2);
});
test('invalid financial intent is rejected before transport',async()=>{
 let calls=0;const adapter=createSquareAdapter(env,async()=>{calls++;throw Error();});
 for(const amount of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal((await adapter.submit({},{...financialIntent({totalMinor:amount,currency:'USD'})})).status,'unresolved');
 assert.equal(calls,0);
});
test('offer changes cannot change the frozen draft, payment attempt or retry amount',async()=>{
 const terms={...developmentOffer(),priceMinor:100,currency:'USD',fulfillmentPlan:{version:1,actions:[]}};
 const authority={userId:'buyer',role:'member',tenantId:terms.tenantId,businessId:terms.businessId,participantIds:['participant']};
 const state={...emptyState(),participants:[{id:'participant'}],entitlementProducts:[{id:terms.productId,name:terms.productName,type:terms.productType,quantity:terms.quantity,validDays:terms.validDays,categories:terms.categories,classIds:terms.classIds}]};
 let n=0;const clock={id:()=>`identity-${++n}`,now:()=>new Date().toISOString()},fail=m=>{throw Error(m);};
 const p=createScopedPurchaseDraft(state,{offerId:terms.id,requestId:'draft'},authority,clock,fail,terms);
 terms.priceMinor=9999;terms.currency='CAD';state.commerceOffers.push({...terms,id:'later-version',version:2});
 const command={action:'payment-prepare',body:{purchaseId:p.id,sourceDigest:'a'.repeat(64),requestId:'prepare'}};
 paymentTransition(state,command,authority,{...clock,integrationRef:SQUARE_INTEGRATION},fail);
 const before=structuredClone(state.paymentAttempts[0]);paymentTransition(state,command,authority,{...clock,integrationRef:SQUARE_INTEGRATION},fail);
 assert.deepEqual(state.paymentAttempts[0],before);assert.equal(state.paymentAttempts.length,1);assert.deepEqual(before.financialIntent,financialIntent({totalMinor:100,currency:'USD'}));
 const posts=[];const adapter=createSquareAdapter(env,async(url,o)=>{if(url.endsWith('/oauth2/token/status'))return Response.json({client_id:B.applicationId,merchant_id:B.merchantId});posts.push(JSON.parse(o.body));return Response.json({payment:{id:'payment'}});});
 await adapter.submit(before,financialIntent(p));await adapter.submit(before,financialIntent(p));assert.deepEqual(posts[0],posts[1]);assert.deepEqual(posts[0].amount_money,{amount:100,currency:'USD'});
});

function refundFixture(actions,amount){
 const h=fixture(actions),p=h.state.purchaseDrafts[0],a=h.state.paymentAttempts[0];
 p.id='a8a8a8a8-1111-4111-8111-123456789abc';a.purchaseId=p.id;p.totalMinor=p.subtotalMinor=p.terms.priceMinor=amount;
 a.financialIntent=financialIntent(p);a.evidence.amount=amount;h.sync();h.fulfill();
 const calls=[];let op;
 const adapter=createSquareRefundAdapter({...env,VEGA_SANDBOX_REFUND_EXECUTION:'authorized',VEGA_SANDBOX_REFUND_PURCHASE_ID:p.id},async(url,o)=>{
  calls.push({url,o});let body;
  if(url.endsWith('/oauth2/token/status'))body={client_id:B.applicationId,merchant_id:B.merchantId};
  else if(url.includes('/locations/'))body={location:{id:B.locationId,merchant_id:B.merchantId,currency:'USD',status:'ACTIVE'}};
  else if(url.includes('/payments/'))body={payment:{id:a.paymentId,status:'COMPLETED',location_id:B.locationId,application_details:{application_id:B.applicationId},reference_id:a.id,source_type:'CARD',amount_money:{amount,currency:p.currency},total_money:{amount,currency:p.currency},version_token:'stable',created_at:p.paymentConfirmedAt}};
  else if(url.includes('/refunds?'))body={refunds:[]};else if(url.includes('/disputes?'))body={disputes:[]};
  else {const request=o.body?JSON.parse(o.body):null;if(request){assert.equal(request.payment_id,a.paymentId);assert.deepEqual(request.amount_money,{amount,currency:p.currency});assert.equal(request.idempotency_key,op.providerKey);}
   body={refund:{id:'refund',payment_id:a.paymentId,location_id:B.locationId,amount_money:{amount,currency:p.currency},status:'COMPLETED',reason:`Refund ${op.id}: ${op.reason}`}};
  }
  return Response.json(body);
 },()=>at);
 let n=0;const store={
  refundContext:async()=>({purchase:{purchaseId:p.id,paymentId:a.paymentId,attemptId:a.id,tenantId:p.tenantId,businessId:p.businessId,amountMinor:amount,currency:p.currency,integrationRef:SQUARE_INTEGRATION},operation:h.state.refundOperations?.[0],stateDigest:digest(h.state),businessReadiness:boundedRefundReadiness({state:h.state,authority:h.staff,purchaseId:p.id,at})}),
  operation:async()=>({independentReceipt:{state:'acknowledged'}}),
  refundCommand:async(_u,command,evidence)=>{const r=refundTransition(h.state,command,h.staff,{id:()=>`event-${++n}`,now:()=>at,evidence},m=>{throw Error(m);});op=h.state.refundOperations[0];return {...r,independentReceipt:{operationId:'captured'}};}
 };
 return {...h,p,a,calls,adapter,flow:createRefundWorkflow({store,adapter,enabled:id=>id===p.id,id:()=>`command-${++n}`,now:()=>at})};
}
for(const [name,actions,amount] of [['soda',[],100],['video',[durable],100],['booking',[booking],6000],['mixed-full',[booking,durable],6000]])test(`${name}: current-purchase full refund dispatches S8A reversal exactly once`,async()=>{
 const h=refundFixture(actions,amount),body={purchaseId:h.p.id,reason:'Customer request',requestId:'intent'};
 const prepared=await h.flow.prepare('staff',body);body.operationId=prepared.refund.id;
 await h.flow.execute('staff',body);const completed=digest(h.state);
 await h.flow.execute('staff',body);await h.flow.reconcile('staff',body);assert.equal(digest(h.state),completed);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/v2/refunds')&&c.o.method==='POST').length,1);
 assert.ok(h.state.fulfillmentActions.every(a=>a.status==='revoked'));
 assert.ok((h.state.accessEntitlements||[]).every(e=>e.state==='revoked'));assert.equal(h.state.creditUnits.length,actions.includes(booking)?3:0);
 assert.ok(h.state.creditUnits.every(u=>u.status==='refunded'));assert.throws(()=>h.fulfill());assert.equal(digest(h.state),completed);
});
test('refund cannot target another purchase or business, or a mismatched payment amount',async()=>{
 const h=refundFixture([durable],100);await assert.rejects(h.flow.prepare('staff',{purchaseId:'other',requestId:'r'}));assert.equal(h.calls.length,0);
 const o={purchaseId:h.p.id,paymentId:h.a.paymentId,attemptId:h.a.id,tenantId:h.p.tenantId,businessId:'other',amountMinor:100,currency:'USD',integrationRef:SQUARE_INTEGRATION};
 await assert.rejects(h.adapter.readiness(o));assert.equal(h.calls.length,0);
 await assert.rejects(h.adapter.readiness({...o,businessId:h.p.businessId,amountMinor:101}));
});
test('Square provider modules contain no price fixture or fulfillment dispatch knowledge',()=>{
 for(const path of ['square.mjs','square-refunds.mjs'])assert.doesNotMatch(readFileSync(new URL('../src/runtime/providers/'+path,import.meta.url),'utf8'),/6000|DURABLE_ACCESS|BOOKING_CREDITS|class_pack|digital_access|3609b576/);
});
