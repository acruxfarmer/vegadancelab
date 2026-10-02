import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {emptyState,ApplicationError} from '../src/application.mjs';
import {createScopedPurchaseDraft,developmentOffer} from '../src/commerce.mjs';
import {createApplicationStore} from '../src/runtime/application-database.mjs';
import {createPaymentWorkflow} from '../src/runtime/payment-workflow.mjs';
import {createAdapterRegistry} from '../src/runtime/payment-integrations.mjs';
import {createSquareAdapter} from '../src/runtime/providers/square.mjs';
import {PAYMENT_BINDING as B,SQUARE_INTEGRATION} from '../src/runtime/providers/square-configuration.mjs';
import {qualifiedTransaction} from '../src/payment-contract.mjs';
import {digest} from '../src/payments.mjs';
const key=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
const fail=(m,s)=>{throw new ApplicationError(m,s);};

function system(refs){
 const users=new Map(),states=new Map(),commands=new Map(),outbox=new Map(),selected=new Map(refs.map(r=>[r.tenantId,r]));
 let tail=Promise.resolve();
 for(const ref of refs){
  const user={userId:randomUUID(),tenantId:ref.tenantId,businessId:ref.businessId,role:'member',participantIds:[randomUUID()]};users.set(user.userId,user);
  const offer={...developmentOffer(),tenantId:ref.tenantId,businessId:ref.businessId};
  const state={...emptyState(),participants:[{id:user.participantIds[0]}],entitlementProducts:[{id:offer.productId,name:offer.productName,type:offer.productType,quantity:3,validDays:30,categories:offer.categories,classIds:[]}]};
  createScopedPurchaseDraft(state,{offerId:offer.id,requestId:'draft'},user,{id:randomUUID,now:()=>new Date().toISOString()},fail,offer);
  states.set(user.tenantId,{state,revision:0});
 }
 const pool={async connect(){let actor,release,snapshot;return {release(){},async query(sql,args=[]){
  if(sql==='begin'){const prior=tail;tail=new Promise(r=>release=r);await prior;snapshot=structuredClone({states,commands,outbox});}
  if(sql==='commit'){release();return {rows:[]};}
  if(sql==='rollback'){for(const [target,source] of [[states,snapshot.states],[commands,snapshot.commands],[outbox,snapshot.outbox]]){target.clear();for(const [k,v] of source)target.set(k,v);}release();return {rows:[]};}
  if(sql.startsWith('select set_config'))actor=users.get(args[0]);
  if(sql.startsWith('select tenant_id')){const u=users.get(args[0]);return {rows:u?[{tenant_id:u.tenantId,business_id:u.businessId,role:u.role,participant_ids:u.participantIds}]:[]};}
  if(sql.startsWith('select state'))return {rows:actor?.tenantId===args[0]&&actor.businessId===args[1]?[structuredClone(states.get(args[0]))]:[]};
  if(sql.startsWith('select integration_ref')){const r=args[2]?refs.find(r=>r.tenantId===args[0]&&r.businessId===args[1]&&r.id===args[2]&&r.version===args[3]):selected.get(args[0]);return {rows:r?[{integration_ref:structuredClone(r)}]:[]};}
  const commandKey=JSON.stringify(args.slice(0,4));
  if(sql.startsWith('select fingerprint'))return {rows:commands.has(commandKey)?[commands.get(commandKey)]:[]};
  if(sql.startsWith('select event_id,discovery_state'))return {rows:[{event_id:outbox.get(commandKey),state:'acknowledged'}]};
  if(sql.startsWith('update vega_private.app_state')){const row=states.get(args[1]);row.state=JSON.parse(args[0]);row.revision++;}
  if(sql.startsWith('insert into vega_private.app_commands'))commands.set(commandKey,{fingerprint:args[4],response:JSON.parse(args[5])});
  if(sql.startsWith('insert into vega_private.recovery_outbox'))outbox.set(JSON.stringify(args.slice(1,5)),args[0]);
  return {rows:[]};
 }}}};
 const raw=createApplicationStore(pool,{receiptPublicKey:key});
 const store={...raw,paymentCommand:async(...args)=>{const r=await raw.paymentCommand(...args);return {...r,independentReceipt:{...r.independentReceipt,state:'acknowledged'}};}};
 return {store,users:[...users.values()],state:u=>states.get(u.tenantId).state,selected,refs};
}
function simulator(ref){
 const transactions=new Map(),calls=[];const opaqueSource=randomUUID();
 return {contractVersion:1,capabilities:{immediateCard:true,idempotentSubmit:true,verifiedLookup:true},calls,transactions,
  validateIntent(i,fail){if(i.method!=='card'||i.collection!=='immediate'||i.partialAllowed||i.tipsAllowed)fail('Provider capability unsupported',422);},
  sourceFingerprint:()=>digest(opaqueSource),
  async submit(a,intent){calls.push('submit');transactions.set(a.idempotencyKey,intent);return {status:'pending',reason:'processor_accepted',paymentId:'native-transaction-1',transactionRef:qualifiedTransaction(ref,'native-transaction-1')};},
  async inspect(a,intent){calls.push('inspect');return {status:'succeeded',reason:'provider_succeeded',normalizationVersion:1,verified:true,paymentId:a.paymentId,referenceId:a.id,integrationRef:ref,transactionRef:qualifiedTransaction(ref,a.paymentId),amount:intent.amountMinor,currency:intent.currency,verification:{method:'authenticated_lookup',observedAt:new Date().toISOString(),evidenceDigest:digest({external:'SETTLED_CARD',id:a.paymentId})},providerEvidence:{provider:ref.provider,nativeState:'SETTLED_CARD'}};}
 };
}
async function exercise(sys,ref,adapter,sharedFlow){
 const user=sys.users.find(u=>u.tenantId===ref.tenantId),draft=sys.state(user).purchaseDrafts[0];
 let execute=false;const flow=sharedFlow??createPaymentWorkflow({store:sys.store,resolveAdapter:createAdapterRegistry([{integrationRef:ref,adapter}]),policy:mode=>mode==='prepare'||execute});
 const first=await flow.prepare(user.userId,{purchaseId:draft.id,requestId:'prepare'});
 const prepared=structuredClone(sys.state(user).paymentAttempts[0]);
 assert.equal(prepared.binding,undefined);assert.equal(prepared.integrationRef.id,ref.id);assert.equal(prepared.financialIntent.amountMinor,6000);assert.equal(prepared.financialIntent.autocomplete,undefined);
 execute=true;await flow.resume(user.userId,{purchaseId:draft.id,attemptId:first.attemptId});await flow.resume(user.userId,{purchaseId:draft.id,attemptId:first.attemptId});
 const state=sys.state(user),done=state.purchaseDrafts[0];assert.equal(state.paymentAttempts.length,1);assert.equal(state.entitlementIssuances.length,1);assert.equal(state.creditUnits.length,3);assert.equal(done.validFrom,done.paymentConfirmedAt);assert.equal(done.refundWindowStartsAt,done.paymentConfirmedAt);assert.equal(Date.parse(done.expiresAt)-Date.parse(done.validFrom),30*86400000);assert.equal(state.paymentAttempts[0].requestDigest,prepared.requestDigest);
 return {flow,user,draft,attemptId:first.attemptId};
}
test('same shared purchase/payment/confirmation/fulfillment pipeline substitutes Square and a second processor',async()=>{
 const ref={...SQUARE_INTEGRATION};const env={SQUARE_ENVIRONMENT:'sandbox',SQUARE_APPLICATION_ID:B.applicationId,SQUARE_MERCHANT_ID:B.merchantId,SQUARE_LOCATION_ID:B.locationId,SQUARE_ACCESS_TOKEN:randomUUID(),SQUARE_SANDBOX_SOURCE_ID:`cnon:${randomUUID()}`};let payment,submits=0;
 const square=createSquareAdapter(env,async(url,options)=>{
  assert.equal(new URL(url).host,B.host);let value;
  if(url.endsWith('/oauth2/token/status'))value={client_id:B.applicationId,merchant_id:B.merchantId};
  else if(options.method==='POST'){submits++;const b=JSON.parse(options.body);payment={id:'native-transaction-1',reference_id:b.reference_id,location_id:B.locationId,application_details:{application_id:B.applicationId},amount_money:b.amount_money,total_money:b.amount_money,source_type:'CARD',status:'COMPLETED',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};value={payment};}
  else value={payment};return {ok:true,status:200,json:async()=>value};
 });
 await exercise(system([ref]),ref,square);assert.equal(submits,1);
 const alternate={...ref,provider:'simulated-second',id:'alternate-card'};const adapter=simulator(alternate);await exercise(system([alternate]),alternate,adapter);assert.equal(adapter.transactions.size,1);
});
test('14 businesses share the same domain and registry while independently selecting adapters and native IDs',async()=>{
 const refs=Array.from({length:14},(_,i)=>({id:'cards',version:1,tenantId:`tenant-${i}`,businessId:`business-${i}`,provider:i%2?'simulated-second':'simulated-first',environment:'sandbox'}));
 const sys=system(refs),adapters=refs.map(simulator);
 const sharedFlow=createPaymentWorkflow({store:sys.store,resolveAdapter:createAdapterRegistry(refs.map((integrationRef,i)=>({integrationRef,adapter:adapters[i]}))),policy:()=>true});
 await Promise.all(refs.map((ref,i)=>exercise(sys,ref,adapters[i],sharedFlow)));
 const keys=new Set();
 for(const u of sys.users){const a=sys.state(u).paymentAttempts[0];keys.add(a.idempotencyKey);assert.equal(a.integrationRef.tenantId,u.tenantId);assert.equal(a.transactionRef.tenantId,u.tenantId);assert.equal(a.paymentId,'native-transaction-1');}
 assert.equal(keys.size,14);assert.ok(adapters.every(a=>a.transactions.size===1));
 const u=sys.users[0],foreign=sys.state(sys.users[1]).purchaseDrafts[0];
 await assert.rejects(sys.store.paymentContext(u.userId,foreign.id),e=>e.status===404);
 const wrongRef={...refs[0],businessId:refs[1].businessId};assert.throws(()=>createAdapterRegistry([{integrationRef:refs[0],adapter:adapters[0]}])(wrongRef),e=>e.status===503);
});
test('unsupported capabilities fail before durable intent or provider submission',async()=>{
 const ref={...SQUARE_INTEGRATION,provider:'simulated-second'},sys=system([ref]),a=simulator(ref);a.capabilities.verifiedLookup=false;
 const flow=createPaymentWorkflow({store:sys.store,resolveAdapter:()=>a,policy:()=>true}),u=sys.users[0];
 await assert.rejects(flow.prepare(u.userId,{purchaseId:sys.state(u).purchaseDrafts[0].id,requestId:'unsupported'}),e=>e.status===422);
 assert.equal(sys.state(u).paymentAttempts,undefined);assert.equal(a.calls.length,0);
});
test('integration replacement pins an unresolved attempt to its original version and fails if old adapter disappears',async()=>{
 const ref={...SQUARE_INTEGRATION,provider:'simulated-first'},sys=system([ref]),adapter=simulator(ref),u=sys.users[0],d=sys.state(u).purchaseDrafts[0];
 const flow=createPaymentWorkflow({store:sys.store,resolveAdapter:createAdapterRegistry([{integrationRef:ref,adapter}]),policy:()=>true});
 const r=await flow.prepare(u.userId,{purchaseId:d.id,requestId:'prepare'});
 const replacement={...ref,version:2,provider:'simulated-second'};sys.refs.push(replacement);sys.selected.set(u.tenantId,replacement);
 assert.deepEqual((await sys.store.paymentRead(u.userId,d.id,r.attemptId)).integrationRef,ref);
 const missing=createPaymentWorkflow({store:sys.store,resolveAdapter:createAdapterRegistry([{integrationRef:replacement,adapter:simulator(replacement)}]),policy:()=>true});
 await assert.rejects(missing.resume(u.userId,{purchaseId:d.id,attemptId:r.attemptId}),e=>e.status===503);
 assert.equal(sys.state(u).paymentAttempts.length,1);assert.equal(sys.state(u).purchaseDrafts[0].paymentConfirmedAt,null);
});
test('cross-integration completion evidence and adapter outages never confirm or issue',async()=>{
 for(const failure of ['wrong_scope','outage']){
  const ref={...SQUARE_INTEGRATION,provider:'simulated-second'},sys=system([ref]),a=simulator(ref),u=sys.users[0],d=sys.state(u).purchaseDrafts[0];const inspect=a.inspect;
  a.inspect=async(...args)=>{if(failure==='outage')throw Error('transport');const e=await inspect(...args);e.integrationRef={...ref,businessId:'foreign'};return e;};
  const flow=createPaymentWorkflow({store:sys.store,resolveAdapter:()=>a,policy:()=>true});const r=await flow.prepare(u.userId,{purchaseId:d.id,requestId:'prepare'});
  if(failure==='wrong_scope')await assert.rejects(flow.resume(u.userId,{purchaseId:d.id,attemptId:r.attemptId}),e=>e.status===409);else assert.equal((await flow.resume(u.userId,{purchaseId:d.id,attemptId:r.attemptId})).status,'unresolved');
  assert.equal(sys.state(u).purchaseDrafts[0].paymentConfirmedAt,null);assert.equal((sys.state(u).creditUnits||[]).length,0);
 }
});
test('core and shared workflow contain no Square-native configuration or request vocabulary',()=>{
 for(const path of ['../src/payments.mjs','../src/payment-contract.mjs','../src/runtime/payment-workflow.mjs']){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');assert.doesNotMatch(source,/square|merchantId|location_id|application_id|autocomplete|cnon:|\/v2\/payments/i);
 }
});

test('confirmed payment can finish owned fulfillment when the original adapter is unavailable',async()=>{
 const ref={...SQUARE_INTEGRATION,provider:'simulated-second'},sys=system([ref]),adapter=simulator(ref),u=sys.users[0],d=sys.state(u).purchaseDrafts[0];
 const command=sys.store.paymentCommand;let failIssue=true,adapterMissing=false;
 sys.store.paymentCommand=(user,cmd)=>{if(cmd.action==='payment-fulfill'&&failIssue)throw Error('local issuance interrupted');return command(user,cmd);};
 const flow=createPaymentWorkflow({store:sys.store,resolveAdapter:()=>{if(adapterMissing)throw Error('provider disappeared');return adapter;},policy:()=>true});
 const prepared=await flow.prepare(u.userId,{purchaseId:d.id,requestId:'prepare'});
 await assert.rejects(flow.resume(u.userId,{purchaseId:d.id,attemptId:prepared.attemptId}));
 const stamp=sys.state(u).purchaseDrafts[0].paymentConfirmedAt;assert.ok(stamp);assert.equal(sys.state(u).purchaseDrafts[0].fulfillmentStatus,'pending');
 const calls=adapter.calls.length;failIssue=false;adapterMissing=true;
 await flow.resume(u.userId,{purchaseId:d.id,attemptId:prepared.attemptId});
 assert.equal(adapter.calls.length,calls);assert.equal(sys.state(u).entitlementIssuances.length,1);assert.equal(sys.state(u).purchaseDrafts[0].paymentConfirmedAt,stamp);
});

test('legacy provider transaction identity does not collide with another processor in the same business',async()=>{
 const ref={...SQUARE_INTEGRATION,id:'replacement',provider:'simulated-second'},sys=system([ref]),u=sys.users[0];
 const legacy={id:randomUUID(),purchaseId:randomUUID(),status:'succeeded',binding:{...B},paymentId:'native-transaction-1',requestDigest:digest('historical immutable request')};
 sys.state(u).paymentAttempts=[structuredClone(legacy)];
 const adapter=simulator(ref),flow=createPaymentWorkflow({store:sys.store,resolveAdapter:()=>adapter,policy:()=>true}),d=sys.state(u).purchaseDrafts[0];
 const p=await flow.prepare(u.userId,{purchaseId:d.id,requestId:'prepare'});await flow.resume(u.userId,{purchaseId:d.id,attemptId:p.attemptId});
 assert.deepEqual(sys.state(u).paymentAttempts[0],legacy);assert.equal(sys.state(u).entitlementIssuances.length,1);
});
