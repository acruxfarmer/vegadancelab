import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {emptyState,transition,visibleState,ApplicationError} from '../src/refund-application.mjs';
import {developmentFrontDeskPolicy,createFrontDeskSale,frontDeskView} from '../src/front-desk.mjs';
import {paymentTransition} from '../src/payments.mjs';
import {qualifiedTransaction} from '../src/payment-contract.mjs';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {frontDeskUI} from '../public/front-desk-ui.js';
const policy=developmentFrontDeskPolicy(),customer=policy.customers[0],offer=policy.offers[0];
const staff={userId:randomUUID(),role:'staff',tenantId:policy.tenantId,businessId:policy.businessId,participantIds:[]};
const member={...staff,userId:customer.buyerId,role:'member',participantIds:[customer.participantId]};
const clock={id:randomUUID,now:()=> '2026-10-06T18:00:00.000Z'},fail=(m,s)=>{throw new ApplicationError(m,s);};
const fixture=(p=policy)=>({...emptyState(),participants:p.customers.map(c=>({id:c.participantId,name:'Existing customer'})),entitlementProducts:p.offers.map(o=>({id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds}))});
const body={requestId:'front-desk-1',customerId:customer.id,offerId:offer.id,offerVersion:offer.version};
test('staff sale freezes business terms, separates identities and leaves fulfillment and bookings unchanged',()=>{
 const before=fixture(),{state,result}=transition(before,{action:'front-desk-sale',body},staff,clock);
 assert.equal(result.createdByStaffId,staff.userId);assert.equal(result.buyerId,customer.buyerId);assert.equal(result.participantId,customer.participantId);
 assert.equal(result.saleChannel,'front_desk');assert.deepEqual(result.terms,offer);assert.equal(result.totalMinor,6000);
 assert.equal(result.paymentStatus,'not_started');assert.equal(result.fulfillmentStatus,'not_issued');assert.equal(result.validFrom,null);
 for(const k of Object.keys(before))if(k!=='activity')assert.deepEqual(state[k],before[k],k);
 assert.equal(before.purchaseDrafts,undefined);
 const replay=transition(state,{action:'front-desk-sale',body},staff,clock);assert.deepEqual(replay.result,result);assert.equal(replay.state.purchaseDrafts.length,1);
});
test('server rejects forged identity, price, terms, stale offers, unknown customers and foreign scope',()=>{
 for(const change of [{role:'member'},{tenantId:'other'},{businessId:'other'}])assert.throws(()=>transition(fixture(),{action:'front-desk-sale',body},{...staff,...change}),e=>e.status===403);
 for(const extra of [{buyerId:staff.userId},{participantId:'other'},{priceMinor:1},{terms:offer},{paymentStatus:'succeeded'},{offerVersion:2},{customerId:'other'}])assert.throws(()=>transition(fixture(),{action:'front-desk-sale',body:{...body,...extra}},staff));
 const stale=fixture();stale.entitlementProducts[0].quantity=99;assert.throws(()=>transition(stale,{action:'front-desk-sale',body},staff),e=>e.status===409);
});
test('changed customer with same staff request conflicts; different staff attribution remains explicit',()=>{
 const p=structuredClone(policy);p.customers.push({id:'second',buyerId:'second-buyer',participantId:'second-person'});
 const state=fixture(p);createFrontDeskSale(state,body,staff,clock,fail,p);
 assert.throws(()=>createFrontDeskSale(state,{...body,customerId:'second'},staff,clock,fail,p),e=>e.status===409);
 assert.equal(state.purchaseDrafts.length,1);
});
test('staff views expose only configured eligible customers; member receives owned sale projection',()=>{
 const {state,result}=transition(fixture(),{action:'front-desk-sale',body},staff,clock);
 assert.equal(frontDeskView(state,staff).frontDesk.customers.length,1);assert.deepEqual(frontDeskView(state,member),{});
 assert.equal(visibleState(state,member).purchaseDrafts[0].id,result.id);
 assert.equal(visibleState(state,{...member,userId:'other'}).purchaseDrafts.length,0);
});
test('same owned sale/payment/fulfillment contract works for two businesses and two simulated providers',()=>{
 for(const business of ['one','two'])for(const provider of ['processor-alpha','processor-beta']){
  const p=structuredClone(policy);p.tenantId=`tenant-${business}`;p.businessId=business;
  Object.assign(p.offers[0],{tenantId:p.tenantId,businessId:business});
  const a={...staff,tenantId:p.tenantId,businessId:business},state=fixture(p),d=createFrontDeskSale(state,body,a,clock,fail,p);
  const ref={id:'payment-provider',version:1,provider,environment:'sandbox',tenantId:a.tenantId,businessId:a.businessId};
  const run=(action,b)=>paymentTransition(state,{action,body:{purchaseId:d.id,requestId:action,...b}},a,{...clock,integrationRef:ref},fail);
  const prepared=run('payment-prepare',{sourceDigest:'a'.repeat(64)}),attemptId=prepared.attemptId,paymentId=randomUUID();
  run('payment-observe',{attemptId,evidence:{status:'succeeded',verified:true,normalizationVersion:1,integrationRef:ref,referenceId:attemptId,paymentId,transactionRef:qualifiedTransaction(ref,paymentId),amount:6000,currency:'USD',verification:{method:'authenticated_lookup',observedAt:clock.now(),evidenceDigest:'b'.repeat(64)}}});
  run('payment-fulfill',{attemptId});run('payment-fulfill',{attemptId});assert.equal(state.creditUnits.length,3);assert.equal(state.entitlementIssuances.length,1);
  assert.equal(visibleState(state,{...member,tenantId:a.tenantId,businessId:business}).purchaseDrafts[0].id,d.id);
 }
});
test('deployed API routes staff sale through authenticated existing store and preserves recovery status',async()=>{
 const env={SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture'},seen=[];
 const api=createApplicationApi(env,{command:async(u,c)=>{seen.push({u,c});return {id:'sale',independentReceipt:{operationId:'a'.repeat(64),state:'pending'}};}},async()=>({ok:true,json:async()=>({id:staff.userId})}));
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.url='/api/commerce/front-desk/sales';req.method='POST';req.headers={'content-type':'application/json',authorization:'Bearer fixture'};
 let status,result;await api(req,{writeHead:s=>{status=s;},end:b=>{result=JSON.parse(b);}});
 assert.equal(status,202);assert.equal(result.pending,true);assert.equal(seen[0].u,staff.userId);assert.equal(seen[0].c.action,'front-desk-sale');
});
test('front-desk presentation discloses Sandbox scope, disabled collection and escapes customer data',()=>{
 const state=fixture();state.participants[0].name='<script>bad</script>';
 const html=frontDeskUI({getData:()=>({...visibleState(state,staff),context:staff,paymentExecution:{enabled:false}}),escape:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')}).render();
 assert.match(html,/Front-desk sale/);assert.match(html,/Payment execution is disabled/);assert.match(html,/Physical card terminals are not supported/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
