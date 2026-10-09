import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {createApplicationStore} from '../src/runtime/application-database.mjs';
import {createDirectPayments,sandboxPaymentEnabled} from '../src/runtime/direct-payments.mjs';
import {PAYMENT_BINDING as B,legacySquareIntegration} from '../src/runtime/providers/square-configuration.mjs';
import {digest,HISTORICAL_DRAFTS} from '../src/payments.mjs';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {developmentOffer,OFFER_ID,PRODUCT_ID} from '../src/commerce.mjs';
import {paymentStatusHTML} from '../public/payment-status.js';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
import {paymentPreparationEnabled} from '../src/runtime/direct-payments.mjs';

const member={userId:'e5946b40-9839-4a96-99d5-93262d9573f0',tenantId:B.tenantId,businessId:B.businessId,role:'member',participantIds:['vega-member-test-joe']};
const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
function harness(){
 const offer=developmentOffer();let state={...emptyState(),participants:[{id:'vega-member-test-joe'}],entitlementProducts:[{id:PRODUCT_ID,name:offer.productName,type:'class_pack',quantity:3,validDays:30,categories:offer.categories,classIds:[]}]};
 state=transition(state,{action:'purchase-draft',body:{requestId:'draft',offerId:OFFER_ID}},member).state;
 const purchaseId=state.purchaseDrafts[0].id;
 let revision=0,commands=new Map(),outbox=new Map(),tail=Promise.resolve();
 const h={authority:{...member},ack:true,binding:{...B},failUpdate:false};
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
 return Object.assign(h,{env,purchaseId,store,raw,service,calls,providerPayments,state:()=>structuredClone(state),edit:f=>f(state),start:(requestId='intent')=>service().start(member.userId,{purchaseId,requestId}),resume:()=>service().resume(member.userId,{purchaseId,attemptId:state.paymentAttempts[0].id})});
}
test('explicit plan partial failure is reported pending and a later worker retry bypasses cached failure safely',async()=>{
 const h=harness();
 h.edit(s=>{const p=s.purchaseDrafts[0],plan={version:1,actions:[{id:'credits',type:'BOOKING_CREDITS'}]};p.terms.fulfillmentPlan=plan;s.commerceOffers[0].fulfillmentPlan=structuredClone(plan);s.passes=null;});
 const first=await h.start();assert.equal(first.status,'succeeded');assert.equal(first.fulfillmentStatus,'pending');assert.equal(h.state().fulfillmentActions[0].status,'failed');
 h.edit(s=>s.passes=[]);const next=await h.resume();assert.equal(next.fulfillmentStatus,'issued');await h.resume();assert.equal(h.state().creditUnits.length,3);assert.equal(h.state().fulfillmentActions[0].attempts,2);assert.equal(h.providerPayments.size,1);
});
test('direct flow persists before provider contact and issues existing entitlements once under concurrent retries',async()=>{
 const h=harness();await Promise.all([h.start(),h.start(),h.start('same-purchase-new-http-intent')]);await h.resume();
 const s=h.state(),d=s.purchaseDrafts[0];assert.equal(s.paymentAttempts.length,1);assert.equal(h.providerPayments.size,1);assert.equal(s.entitlementIssuances.length,1);assert.equal(s.creditUnits.length,3);
 assert.equal(d.paymentStatus,'succeeded');assert.equal(d.fulfillmentStatus,'issued');assert.equal(d.validFrom,d.paymentConfirmedAt);assert.equal(d.refundWindowStartsAt,d.paymentConfirmedAt);
 assert.equal(Date.parse(d.expiresAt)-Date.parse(d.validFrom),30*86400000);assert.deepEqual(s.creditUnits[0].entitlement.categories,['Pack verification']);assert.equal(s.entitlementIssuances[0].source,'sandbox_purchase');
 const calls=h.calls.length;await h.resume();assert.equal(h.calls.length,calls);assert.equal(h.state().purchaseDrafts[0].paymentConfirmedAt,d.paymentConfirmedAt);
 assert.equal(JSON.stringify(s).includes(h.env.SQUARE_ACCESS_TOKEN),false);assert.equal(JSON.stringify(s).includes(h.env.SQUARE_SANDBOX_SOURCE_ID),false);
});
test('execution defaults disabled and rejects Production, Strata, historical drafts and missing binding without provider calls',async()=>{
 for(const override of [{VEGA_SANDBOX_PAYMENT_EXECUTION:undefined},{VEGA_ENV:'production'},{SQUARE_ENVIRONMENT:'production'},{SQUARE_APPLICATION_ID:'other-app'},{SQUARE_MERCHANT_ID:'other'},{SQUARE_LOCATION_ID:'other'},{VEGA_SANDBOX_PURCHASE_ID:[...HISTORICAL_DRAFTS][0]}]){
  const h=harness();Object.assign(h.env,override);assert.equal(sandboxPaymentEnabled(h.env),false);await assert.rejects(h.start());assert.equal(h.calls.length,0);
 }
 const h=harness();h.binding=null;await assert.rejects(h.start(),e=>e.status===503);assert.equal(h.calls.length,0);
});
test('unacknowledged intent never contacts provider; acknowledged retry preserves attempt key',async()=>{
 const h=harness();h.ack=false;const first=await h.start();assert.equal(first.status,'pending');assert.equal(h.calls.length,0);assert.equal(h.state().passes.length,0);
 h.ack=true;await h.resume();assert.equal(h.state().paymentAttempts[0].id,first.attemptId);assert.equal(h.providerPayments.size,1);
});
test('lost CreatePayment response retries original key across service restart, then GetPayment before issuance',async()=>{
 const h=harness();h.interruptCreate=true;assert.equal((await h.start()).status,'unresolved');assert.equal(h.state().passes.length,0);
 await h.resume();assert.equal(h.providerPayments.size,1);assert.equal(h.state().entitlementIssuances.length,1);assert.ok(h.calls.some(c=>c.method==='GET'));
});
test('GetPayment outage retains provider ID and resumes lookup without another CreatePayment',async()=>{
 const h=harness();h.failGet=true;await h.start();assert.equal(h.state().paymentAttempts[0].status,'unresolved');assert.equal(h.state().passes.length,0);
 const count=h.calls.filter(c=>c.path==='/v2/payments').length;h.failGet=false;await h.resume();assert.equal(h.calls.filter(c=>c.path==='/v2/payments').length,count);assert.equal(h.state().passes.length,1);
});
test('changed request payload, source, and active attempt ownership fail closed',async()=>{
 const h=harness();h.ack=false;await h.start();
 await assert.rejects(h.store.paymentCommand(member.userId,{action:'payment-prepare',body:{purchaseId:h.purchaseId,requestId:'intent',sourceDigest:digest('different')}}),e=>e.status===409);
 h.env.SQUARE_SANDBOX_SOURCE_ID=`cnon:${randomUUID()}`;await assert.rejects(h.start('new-source'),e=>e.status===409);assert.equal(h.state().paymentAttempts.length,1);assert.equal(h.calls.length,0);
});
test('provider identity and financial mismatches never fulfill or start clocks',async()=>{
 for(const alter of [p=>({...p,id:'wrong'}),p=>({...p,reference_id:'wrong'}),p=>({...p,location_id:'wrong'}),p=>({...p,application_details:{application_id:'wrong'}}),p=>({...p,amount_money:{amount:1,currency:'USD'}}),p=>({...p,total_money:{amount:6000,currency:'EUR'}}),p=>({...p,tip_money:{amount:1,currency:'USD'}}),p=>({...p,refunded_money:{amount:1,currency:'USD'}}),p=>({...p,source_type:'CASH'}),p=>({...p,updated_at:null})]){
  const h=harness();h.alter=alter;await h.start();assert.equal(h.state().purchaseDrafts[0].paymentStatus,'unresolved');assert.equal(h.state().passes.length,0);assert.equal(h.state().purchaseDrafts[0].paymentConfirmedAt,null);
 }
 const h=harness();h.identity.merchant_id='wrong';await h.start();assert.equal(h.providerPayments.size,0);assert.equal(h.state().passes.length,0);
});
test('APPROVED/PENDING do not fulfill; FAILED/CANCELED release only terminal attempts; decline is definitive',async()=>{
 for(const [status,expected] of [['APPROVED','pending'],['PENDING','pending'],['FAILED','failed'],['CANCELED','cancelled']]){
  const h=harness();h.providerStatus=status;await h.start();assert.equal(h.state().purchaseDrafts[0].paymentStatus,expected);assert.equal(h.state().passes.length,0);assert.equal(h.state().purchaseDrafts[0].validFrom,null);
 }
 const h=harness();h.decline=true;await h.start();assert.equal(h.state().paymentAttempts[0].status,'failed');assert.equal(h.state().passes.length,0);
});
test('fulfillment rollback preserves paid state and resumes without charge; offer snapshot survives catalog edits',async()=>{
 const h=harness();const original=h.store.paymentCommand;let failed=false;
 h.store.paymentCommand=async(...args)=>{if(args[1].action==='payment-fulfill'&&!failed){failed=true;h.failUpdate=true;}return original(...args);};
 await assert.rejects(h.start());const paid=h.state().purchaseDrafts[0];assert.equal(paid.paymentStatus,'succeeded');assert.equal(paid.fulfillmentStatus,'pending');assert.equal(h.state().passes.length,0);
 h.edit(s=>{s.entitlementProducts[0].quantity=99;s.entitlementProducts[0].validDays=90;});await h.resume();assert.equal(h.state().creditUnits.length,3);assert.equal(h.state().purchaseDrafts[0].paymentConfirmedAt,paid.paymentConfirmedAt);assert.equal(h.providerPayments.size,1);
});
test('staff, delegated member, cross-business authority and client evidence cannot initiate or fulfill',async()=>{
 for(const change of [{role:'staff'},{participantIds:['other']},{businessId:'other'},{tenantId:'other'}]){const h=harness();Object.assign(h.authority,change);await assert.rejects(h.start());assert.equal(h.calls.length,0);}
 const h=harness();await assert.rejects(h.raw.command(member.userId,{action:'payment-fulfill',body:{requestId:'forge',purchaseId:h.purchaseId}}),e=>e.status===403);
 await assert.rejects(h.service().start(member.userId,{purchaseId:h.purchaseId,requestId:'forge',evidence:{status:'COMPLETED'}}),e=>e.status===400);
 assert.equal(visibleState(h.state(),member).paymentAttempts,undefined);
});
test('status views separate payment from issuance and never give staff payment controls',()=>{
 const d={id:randomUUID(),paymentStatus:'succeeded',fulfillmentStatus:'pending',activeAttemptId:randomUUID()};const e=String,enabled={enabled:true,purchaseId:d.id};
 assert.match(paymentStatusHTML(d,e,false,enabled),/Paid — credits pending/);assert.match(paymentStatusHTML(d,e,false,enabled),/Check existing payment/);
 assert.doesNotMatch(paymentStatusHTML(d,e,true,enabled),/<form/);assert.doesNotMatch(paymentStatusHTML(d,e,false,{enabled:false}),/<form/);
});
test('failed durable prepare makes zero provider calls and can safely retry',async()=>{
 const h=harness();h.failUpdate=true;await assert.rejects(h.start());assert.equal(h.calls.length,0);assert.equal(h.state().paymentAttempts,undefined);
 await h.start();assert.equal(h.providerPayments.size,1);assert.equal(h.state().entitlementIssuances.length,1);
});
test('stale observations cannot downgrade confirmation or move clocks; provider payment cannot be claimed twice',async()=>{
 const h=harness();await h.start();const s=h.state(),a=s.paymentAttempts[0],stamp=s.purchaseDrafts[0].paymentConfirmedAt;
 await h.store.paymentCommand(member.userId,{action:'payment-observe',body:{purchaseId:h.purchaseId,attemptId:a.id,requestId:'stale',evidence:{status:'pending',reason:'late'}}});
 assert.equal(h.state().purchaseDrafts[0].paymentConfirmedAt,stamp);assert.equal(h.state().purchaseDrafts[0].paymentStatus,'succeeded');
 h.edit(state=>{state.paymentAttempts.push({...a,id:randomUUID(),status:'pending'});});
 const other=h.state().paymentAttempts[1];
 await assert.rejects(h.store.paymentCommand(member.userId,{action:'payment-observe',body:{purchaseId:h.purchaseId,attemptId:other.id,requestId:'claim',evidence:{...a.evidence,referenceId:other.id}}}),e=>e.status===409);
 assert.equal(h.state().entitlementIssuances.length,1);
});
test('old unresolved no-ID attempt never creates again outside the bounded retry window',async()=>{
 const h=harness();h.ack=false;await h.start();h.ack=true;
 h.edit(s=>{s.paymentAttempts[0].createdAt='2000-01-01T00:00:00.000Z';});
 await h.resume();assert.equal(h.providerPayments.size,0);assert.equal(h.state().paymentAttempts[0].reason,'create_retry_window_closed');assert.equal(h.state().passes.length,0);
});

function preparationHarness(){
 const h=harness();Object.assign(h.env,{VEGA_PAYMENT_ATTEMPT_PREPARATION:'enabled',VEGA_SANDBOX_PAYMENT_EXECUTION:'disabled'});
 delete h.env.SQUARE_ACCESS_TOKEN;delete h.env.SQUARE_SANDBOX_SOURCE_ID;
 h.prepare=(requestId='prepare')=>h.service().prepare(member.userId,{purchaseId:h.purchaseId,requestId});
 return h;
}
function assertUnpaid(h,before){
 const s=h.state(),d=s.purchaseDrafts[0];assert.equal(h.calls.length,0);assert.equal(h.providerPayments.size,0);
 for(const key of ['passes','creditUnits','entitlementIssuances','reservations'])assert.deepEqual(s[key],before[key]);
 for(const key of ['paymentConfirmedAt','validFrom','expiresAt','refundWindowStartsAt'])assert.equal(d[key],null);
 assert.equal(d.fulfillmentStatus,'not_issued');assert.notEqual(d.status,'paid');
 assert.ok(!(s.activity||[]).some(e=>['payment-observation','payment-source-bound','purchase-fulfilled'].includes(e.action)));
}
test('disabled preparation persists and reopens one stable attempt under simultaneous same and different request IDs',async()=>{
 const h=preparationHarness(),before=h.state();assert.equal(paymentPreparationEnabled(h.env),true);assert.equal(sandboxPaymentEnabled(h.env),false);
 const results=await Promise.all(Array.from({length:12},(_,i)=>h.prepare(i<6?'prepare':`prepare-${i}`)));
 assert.equal(new Set(results.map(r=>r.attemptId)).size,1);
 const a=h.state().paymentAttempts[0];assert.equal(h.state().paymentAttempts.length,1);assert.equal(a.idempotencyKey,a.id);assert.deepEqual(a.integrationRef,legacySquareIntegration(B,member));assert.equal(a.binding,undefined);assert.equal(a.sourceDigest,null);assert.equal(a.executionStartedAt,undefined);assert.match(a.requestDigest,/^[a-f0-9]{64}$/);
 assert.equal((await h.prepare()).attemptId,a.id);
 assert.deepEqual((await h.store.paymentRead(member.userId,h.purchaseId,a.id)).attempt,a);
 for(const role of ['member','staff']){
  const view=visibleState(h.state(),{...member,role});const d=view.purchaseDrafts.find(d=>d.id===h.purchaseId);
  assert.equal(d.activeAttemptId,a.id);assert.equal(d.paymentSummary.status,'pending');
  assert.doesNotMatch(paymentStatusHTML(d,String,role==='staff',{enabled:false}),/<form/);
 }
 await assert.rejects(h.start(),e=>e.status===403);await assert.rejects(h.resume(),e=>e.status===403);assertUnpaid(h,before);
});
test('preparation changed payload conflicts and rejects extra client evidence without new attempts',async()=>{
 const h=preparationHarness(),before=h.state();await h.prepare();
 const draft=structuredClone(h.state().purchaseDrafts[0]);draft.id=randomUUID();draft.paymentStatus='not_started';delete draft.activeAttemptId;h.edit(s=>s.purchaseDrafts.push(draft));
 h.env.VEGA_SANDBOX_PURCHASE_ID=draft.id;
 await assert.rejects(h.service().prepare(member.userId,{purchaseId:draft.id,requestId:'prepare'}),e=>e.status===409);
 await assert.rejects(h.service().prepare(member.userId,{purchaseId:draft.id,requestId:'extra',amount:1}),e=>e.status===400);
 assert.equal(h.state().paymentAttempts.length,1);assertUnpaid(h,before);
});
test('preparation rolls back failed persistence; invalid terms, authority, environment and binding fail closed',async()=>{
 const h=preparationHarness();h.failUpdate=true;await assert.rejects(h.prepare());assert.equal(h.state().paymentAttempts,undefined);await h.prepare();assert.equal(h.state().paymentAttempts.length,1);
 for(const change of [{VEGA_ENV:'production'},{VEGA_EXTERNAL_EFFECTS:'enabled'},{VEGA_PAYMENT_ATTEMPT_PREPARATION:undefined},{VEGA_SANDBOX_PAYMENT_EXECUTION:'authorized'},{VEGA_SANDBOX_PAYMENT_EXECUTION:undefined},{SQUARE_ENVIRONMENT:'production'},{SQUARE_APPLICATION_ID:'strata'},{SQUARE_MERCHANT_ID:'other'},{SQUARE_LOCATION_ID:'other'},{VEGA_SANDBOX_PURCHASE_ID:[...HISTORICAL_DRAFTS][0]}]){
  const h=preparationHarness();Object.assign(h.env,change);await assert.rejects(h.prepare());assert.equal(h.calls.length,0);assert.equal(h.state().paymentAttempts,undefined);
 }
 for(const change of [{role:'staff'},{participantIds:['other']},{businessId:'other'},{tenantId:'other'}]){const h=preparationHarness();Object.assign(h.authority,change);await assert.rejects(h.prepare());assert.equal(h.state().paymentAttempts,undefined);}
 for(const mutate of [h=>{h.binding=null;},h=>{h.binding.locationId='other';},h=>h.edit(s=>{s.purchaseDrafts[0].terms.totalMinor=1;}),h=>h.edit(s=>{s.purchaseDrafts[0].currency='EUR';})]){const h=preparationHarness();mutate(h);await assert.rejects(h.prepare());assert.equal(h.calls.length,0);assert.equal(h.state().paymentAttempts,undefined);}
});
test('authenticated preparation API works while start/resume and unauthenticated preparation remain blocked',async()=>{
 const h=preparationHarness(),before=h.state();Object.assign(h.env,{SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'local-fixture'});
 let authCalls=0;const api=createApplicationApi(h.env,h.store,async url=>{assert.equal(url,'https://cjdoczrxcjynjhgpgqop.supabase.co/auth/v1/user');authCalls++;return {ok:true,json:async()=>({id:member.userId})};});
 async function call(path,body,authenticated=true){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer local-fixture'}:{})}});let status,value;await api(req,{writeHead(s){status=s;},end(v){value=JSON.parse(v);}});return {status,value};}
 assert.equal((await call('/api/commerce/payments/prepare',{purchaseId:h.purchaseId,requestId:'api'},false)).status,401);assert.equal(authCalls,0);
 const first=await call('/api/commerce/payments/prepare',{purchaseId:h.purchaseId,requestId:'api'});assert.equal(first.status,202);assert.equal(first.value.executionEnabled,false);
 assert.equal((await call('/api/commerce/payments/prepare',{purchaseId:h.purchaseId,requestId:'api'})).value.attemptId,first.value.attemptId);
 for(const path of ['/api/commerce/payments','/api/commerce/payments/resume'])assert.equal((await call(path,{purchaseId:h.purchaseId,attemptId:first.value.attemptId,requestId:'blocked'})).status,404);
 assertUnpaid(h,before);
});
test('later simulated authorization binds source once without changing preparation fingerprint or idempotency key',async()=>{
 const h=preparationHarness();await h.prepare();const prepared=h.state().paymentAttempts[0];
 Object.assign(h.env,{VEGA_SANDBOX_PAYMENT_EXECUTION:'authorized',SQUARE_ACCESS_TOKEN:randomUUID(),SQUARE_SANDBOX_SOURCE_ID:`cnon:${randomUUID()}`});
 h.interruptCreate=true;await h.resume();await h.resume();
 const a=h.state().paymentAttempts[0];assert.equal(a.idempotencyKey,prepared.idempotencyKey);assert.equal(a.requestDigest,prepared.requestDigest);assert.match(a.executionRequestDigest,/^[a-f0-9]{64}$/);assert.equal(h.providerPayments.size,1);assert.equal(h.state().entitlementIssuances.length,1);
});

test('legacy prepared evidence resolves without rewriting original binding, key, offer or request fingerprints',async()=>{
 const h=preparationHarness();await h.prepare();
 h.edit(s=>{const a=s.paymentAttempts[0];delete a.integrationRef;delete a.financialIntent;a.binding={...B};a.requestDigest=digest({amount:6000,currency:'USD',binding:B,sourceDigest:null,referenceId:a.id,autocomplete:true});});
 const original=h.state().paymentAttempts[0];
 const read=await h.store.paymentRead(member.userId,h.purchaseId,original.id);assert.deepEqual(read.integrationRef,legacySquareIntegration(B,member));assert.deepEqual(read.attempt,original);
 await h.prepare();assert.deepEqual(h.state().paymentAttempts[0],original);assert.equal(h.calls.length,0);
 Object.assign(h.env,{VEGA_SANDBOX_PAYMENT_EXECUTION:'authorized',SQUARE_ACCESS_TOKEN:randomUUID(),SQUARE_SANDBOX_SOURCE_ID:`cnon:${randomUUID()}`});
 await h.resume();await h.resume();const after=h.state().paymentAttempts[0];
 for(const field of ['id','binding','idempotencyKey','referenceId','requestDigest','offerDigest','prepareRequestId','createdAt'])assert.deepEqual(after[field],original[field]);
 assert.equal(after.integrationRef,undefined);assert.equal(h.providerPayments.size,1);assert.equal(h.state().entitlementIssuances.length,1);assert.deepEqual(after.evidence.integrationRef,read.integrationRef);
});

test('fresh disabled preparation coexists with closed drafts and a legacy attempt without rewriting historical state',async()=>{
 const h=preparationHarness();
 h.edit(s=>{
  const draft=structuredClone(s.purchaseDrafts[0]);
  for(const id of HISTORICAL_DRAFTS)s.purchaseDrafts.push({...structuredClone(draft),id,requestId:`closed:${id}`});
  const oldId=randomUUID(),oldAttempt=randomUUID();
  s.purchaseDrafts.push({...draft,id:oldId,requestId:'historical',paymentStatus:'pending',activeAttemptId:oldAttempt});
  s.paymentAttempts=[{id:oldAttempt,purchaseId:oldId,buyerId:member.userId,participantId:member.participantIds[0],binding:{...B},status:'pending',sourceDigest:null,prepareSourceDigest:null,paymentId:null,idempotencyKey:oldAttempt,referenceId:oldAttempt,requestDigest:digest('original-native-request'),offerDigest:digest(draft.terms),createdAt:'2026-10-01T00:00:00.000Z',paymentConfirmedAt:null}];
 });
 const before=h.state(),historicalDrafts=before.purchaseDrafts.slice(1),historicalAttempts=before.paymentAttempts;
 assert.equal(before.paymentAttempts.filter(a=>a.purchaseId===h.purchaseId).length,0);
 const results=await Promise.all(Array.from({length:12},(_,i)=>h.prepare(i<6?'fresh-shared':`fresh-distinct-${i}`)));
 assert.equal(new Set(results.map(r=>r.attemptId)).size,1);
 const after=h.state(),fresh=after.paymentAttempts.find(a=>a.purchaseId===h.purchaseId);
 assert.deepEqual(after.purchaseDrafts.slice(1),historicalDrafts);
 assert.deepEqual(after.paymentAttempts.filter(a=>a.id!==fresh.id),historicalAttempts);
 assert.deepEqual(after.activity.slice(0,before.activity.length),before.activity);
 assert.equal(after.activity.filter(a=>a.action==='payment-intent'&&a.subjectId===h.purchaseId).length,1);
 assert.deepEqual(fresh.integrationRef,legacySquareIntegration(B,member));
 assert.deepEqual(fresh.financialIntent,{amountMinor:6000,currency:'USD',collection:'immediate',method:'card',partialAllowed:false,tipsAllowed:false});
 assert.equal(fresh.binding,undefined);assert.equal(fresh.idempotencyKey,fresh.id);assert.equal(fresh.reason,'prepared_execution_disabled');
 assert.deepEqual(after.purchaseDrafts[0].terms,before.purchaseDrafts[0].terms);
 assertUnpaid(h,before);
});

test('fresh pending receipt remains honest and identical retries after acknowledgment retain the original attempt',async()=>{
 const h=preparationHarness(),before=h.state();h.ack=false;
 const first=await h.prepare('fresh-pending');
 assert.equal(first.independentReceipt.state,'pending');assert.equal(first.executionEnabled,false);
 const inserted=h.state().paymentAttempts[0];
 assert.equal((await h.prepare('fresh-pending')).attemptId,inserted.id);
 h.ack=true;
 const acknowledged=await h.prepare('fresh-pending');
 assert.equal(acknowledged.independentReceipt.state,'acknowledged');
 assert.deepEqual(h.state().paymentAttempts,[inserted]);
 assertUnpaid(h,before);
});
