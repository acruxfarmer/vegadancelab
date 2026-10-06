import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {createDirectPayments,sandboxPaymentEnabled} from '../src/runtime/direct-payments.mjs';
import {PAYMENT_BINDING as B,legacySquareIntegration} from '../src/runtime/providers/square-configuration.mjs';
import {digest,HISTORICAL_DRAFTS} from '../src/payments.mjs';
import {emptyState,transition,visibleState} from '../src/refund-application.mjs';
import {developmentOffer,OFFER_ID,PRODUCT_ID} from '../src/commerce.mjs';
import {paymentStatusHTML} from '../public/payment-status.js';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
import {paymentPreparationEnabled} from '../src/runtime/direct-payments.mjs';

const member={userId:'e5946b40-9839-4a96-99d5-93262d9573f0',tenantId:B.tenantId,businessId:B.businessId,role:'member',participantIds:['vega-member-test-joe']};
const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
const staff={...member,userId:'f42715d4-a601-43f8-a02e-33eb8f9021d6',role:'staff',participantIds:[]};
function harness(){
 const offer=developmentOffer();let state={...emptyState(),participants:[{id:'vega-member-test-joe'}],entitlementProducts:[{id:PRODUCT_ID,name:offer.productName,type:'class_pack',quantity:3,validDays:30,categories:offer.categories,classIds:[]}]};
 state=transition(state,{action:'front-desk-sale',body:{requestId:'draft',offerId:OFFER_ID,offerVersion:1,customerId:'development-member-joe'}},staff).state;
 const purchaseId=state.purchaseDrafts[0].id;
 let revision=0,commands=new Map(),outbox=new Map(),tail=Promise.resolve();
 const h={authority:{...staff},ack:true,binding:{...B},failUpdate:false};
 const pool={async connect(){let release,snapshot;
  return {release(){},async query(sql,args=[]){
   if(sql==='begin'){const before=tail;tail=new Promise(r=>{release=r});await before;snapshot=structuredClone({state,revision,commands,outbox});}
   if(sql==='commit'){release();return {rows:[]};}
   if(sql==='rollback'){({state,revision,commands,outbox}=snapshot);release();return {rows:[]};}
   if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:h.authority.tenantId,business_id:h.authority.businessId,role:h.authority.role,participant_ids:h.authority.participantIds}]};
   if(sql.startsWith('select binding'))return {rows:h.binding?[{binding:structuredClone(h.binding)}]:[]};
   if(sql.startsWith('select integration_ref')){const ref=legacySquareIntegration(h.binding,h.authority);return {rows:ref?[{integration_ref:ref}]:[]};}
   if(sql.startsWith('select state'))return {rows:[{state:structuredClone(state),revision}]};
   if(sql.startsWith('select fingerprint'))return {rows:commands.has(args[3])?[commands.get(args[3])]:[]};
   if(sql.startsWith('select event_id,discovery_state'))return {rows:[{...outbox.get(args[3]),state:h.ack?'acknowledged':'pending'}]};
   if(sql.startsWith('update vega_private.app_state')){if(h.failUpdate){h.failUpdate=false;throw Error('simulated transaction interruption');}state=JSON.parse(args[0]);revision++;}
   if(sql.startsWith('insert into vega_private.app_commands'))commands.set(args[3],{fingerprint:args[4],response:JSON.parse(args[5])});
   if(sql.startsWith('insert into vega_private.recovery_outbox'))outbox.set(args[4],{event_id:args[0]});
   return {rows:[]};
  }};
 }};
 const raw=createApplicationStore(pool,{receiptPublicKey});
 // New receipts begin pending in the real store. Tests simulate the existing independent acknowledgment.
 const store={...raw,paymentCommand:async(...args)=>{const r=await raw.paymentCommand(...args);return {...r,independentReceipt:{...r.independentReceipt,state:h.ack?'acknowledged':'pending'}};}};
 const env={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',VEGA_SANDBOX_PAYMENT_EXECUTION:'authorized',SQUARE_ENVIRONMENT:'sandbox',SQUARE_APPLICATION_ID:B.applicationId,SQUARE_MERCHANT_ID:B.merchantId,SQUARE_LOCATION_ID:B.locationId,VEGA_SANDBOX_PURCHASE_ID:purchaseId,SQUARE_ACCESS_TOKEN:randomUUID(),SQUARE_SANDBOX_SOURCE_ID:`cnon:${randomUUID()}`};
 const calls=[],providerPayments=new Map();let crash=false;
 h.providerStatus='COMPLETED';h.alter=p=>p;h.identity={client_id:B.applicationId,merchant_id:B.merchantId};
 const fetcher=async(url,options)=>{
  assert.equal(new URL(url).host,B.host);assert.equal(options.redirect,'error');
  calls.push({path:new URL(url).pathname,method:options.method});
  const reply=(value,status=200)=>({ok:status<300,status,json:async()=>value});
  if(url.endsWith('/oauth2/token/status'))return reply(h.identity);
  if(options.method==='POST'){
   assert.ok(state.paymentAttempts?.length,'intent committed before provider contact');
   const body=JSON.parse(options.body);assert.equal(body.amount_money.amount,6000);assert.equal(body.location_id,B.locationId);
   if(h.decline)return reply({errors:[{code:'CARD_DECLINED'}]},400);
   let p=providerPayments.get(body.idempotency_key);
   if(!p){p={id:randomUUID(),reference_id:body.reference_id,location_id:B.locationId,application_details:{application_id:B.applicationId},amount_money:{amount:6000,currency:'USD'},total_money:{amount:6000,currency:'USD'},source_type:'CARD',status:h.providerStatus,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};providerPayments.set(body.idempotency_key,p);}
   if(h.interruptCreate&&!crash){crash=true;throw Error('simulated lost response');}
   return reply({payment:p});
  }
  if(h.failGet)throw Error('simulated lookup outage');
  const p=[...providerPayments.values()].find(p=>url.endsWith(p.id));
  return reply({payment:h.alter(structuredClone(p))});
 };
 const service=()=>createDirectPayments(env,store,fetcher);
 return Object.assign(h,{env,purchaseId,store,raw,service,calls,providerPayments,state:()=>structuredClone(state),edit:f=>f(state),start:(requestId='intent')=>service().start(staff.userId,{purchaseId,requestId}),resume:()=>service().resume(staff.userId,{purchaseId,attemptId:state.paymentAttempts[0].id})});
}

test('staff sale concurrent payment and recovery retain actor, customer and exactly one charge/grant',async()=>{
 const h=harness();await Promise.all([h.start(),h.start(),h.start('new-http-request')]);await h.resume();
 const s=h.state(),p=s.purchaseDrafts[0];
 assert.equal(h.providerPayments.size,1);assert.equal(s.paymentAttempts.length,1);assert.equal(s.entitlementIssuances.length,1);assert.equal(s.creditUnits.length,3);
 assert.equal(p.buyerId,member.userId);assert.equal(p.createdByStaffId,staff.userId);assert.equal(p.participantId,member.participantIds[0]);
 assert.ok(s.activity.every(x=>x.actorId===staff.userId));assert.equal(s.entitlementIssuances[0].actorId,staff.userId);
 assert.deepEqual(s.reservations,[]);assert.equal(p.fulfillmentStatus,'issued');
 assert.equal(visibleState(s,member).purchaseDrafts[0].id,p.id);assert.equal(visibleState(s,staff).purchaseDrafts[0].id,p.id);
 assert.equal(visibleState(s,{...member,userId:'another'}).purchaseDrafts.length,0);
 assert.equal(visibleState(s,{...member,businessId:'another'}).purchaseDrafts.length,0);
});
test('staff sale lookup uncertainty and lost submission response retain one payment and no premature credit',async()=>{
 for(const key of ['failGet','interruptCreate']){
  const h=harness();h[key]=true;assert.equal((await h.start()).status,'unresolved');assert.equal(h.state().passes.length,0);
  h[key]=false;await h.resume();assert.equal(h.providerPayments.size,1);assert.equal(h.state().creditUnits.length,3);
 }
});
test('staff sale pending, failed and cancelled payments issue no credits',async()=>{
 for(const status of ['PENDING','APPROVED','FAILED','CANCELED']){
  const h=harness();h.providerStatus=status;await h.start();assert.equal(h.state().passes.length,0);assert.equal(h.state().purchaseDrafts[0].validFrom,null);
 }
 const h=harness();h.decline=true;await h.start();assert.equal(h.providerPayments.size,0);assert.equal(h.state().passes.length,0);
});
test('staff paid/unfulfilled transaction rollback is recoverable without recharging or changed terms',async()=>{
 const h=harness(),original=h.store.paymentCommand;let failed=false;
 h.store.paymentCommand=async(...args)=>{if(args[1].action==='payment-fulfill'&&!failed){failed=true;h.failUpdate=true;}return original(...args);};
 await assert.rejects(h.start());const p=h.state().purchaseDrafts[0];assert.equal(p.paymentStatus,'succeeded');assert.equal(p.fulfillmentStatus,'pending');
 h.edit(s=>{s.entitlementProducts[0].quantity=99;});const submits=h.calls.filter(c=>c.method==='POST').length;
 await h.resume();assert.equal(h.calls.filter(c=>c.method==='POST').length,submits);assert.equal(h.state().creditUnits.length,3);assert.equal(h.state().purchaseDrafts[0].paymentConfirmedAt,p.paymentConfirmedAt);
});
test('staff sale keeps independent receipt and execution gates',async()=>{
 const h=harness();h.ack=false;await h.start();assert.equal(h.calls.length,0);assert.equal(h.state().passes.length,0);
 h.ack=true;await h.resume();assert.equal(h.providerPayments.size,1);
 const disabled=harness();disabled.env.VEGA_SANDBOX_PAYMENT_EXECUTION='disabled';await assert.rejects(disabled.start());assert.equal(disabled.calls.length,0);
});
test('staff sale rejects cross-scope staff and client-forged confirmation',async()=>{
 for(const delta of [{role:'other'},{businessId:'other'},{tenantId:'other'},{role:'member',participantIds:['another']},{...member}]){
  const h=harness();Object.assign(h.authority,delta);await assert.rejects(h.start());assert.equal(h.calls.length,0);
 }
 const h=harness();await assert.rejects(h.raw.command(staff.userId,{action:'payment-fulfill',body:{requestId:'forge',purchaseId:h.purchaseId}}),e=>e.status===403);
});
test('staff payment controls apply only to a designated front-desk sale and distinguish pending fulfillment',()=>{
 const h=harness(),d=h.state().purchaseDrafts[0],execution={enabled:true,purchaseId:d.id};
 assert.match(paymentStatusHTML(d,String,true,execution),/data-commerce-payment/);
 assert.doesNotMatch(paymentStatusHTML(d,String,false,execution),/data-commerce-payment/);
 assert.doesNotMatch(paymentStatusHTML(d,String,true,{enabled:false}),/data-commerce-payment/);
 assert.doesNotMatch(paymentStatusHTML(d,String,true,{...execution,purchaseId:'other'}),/data-commerce-payment/);
 assert.match(paymentStatusHTML({...d,paymentStatus:'succeeded',fulfillmentStatus:'pending'},String,true,execution),/Paid — credits pending/);
});
