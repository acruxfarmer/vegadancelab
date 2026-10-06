import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transition,visibleState} from '../src/refund-application.mjs';
import {digest} from '../src/payments.mjs';
import {assessRefundEligibility} from '../src/refund-eligibility.mjs';
import {bookingAccounting} from '../src/cancellation.mjs';
import {createRefundWorkflow} from '../src/runtime/refund-workflow.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const stamp='2026-10-05T23:00:00Z';
function setup(){
 let state=structuredClone(fixture),n=0;
 const a={userId:'staff',role:'staff',tenantId:'vega-development',businessId:'vega-dance-lab',participantIds:[]},p=state.purchaseDrafts[0],pid=p.id;
 const proof=()=>({tenantId:a.tenantId,businessId:a.businessId,purchaseId:pid,paymentId:state.paymentAttempts[0].paymentId,amountMinor:p.totalMinor,currency:p.currency,stateDigest:digest(state),ownedComplete:true,providerClear:true,paymentVersion:'version-1',observedAt:stamp});
 const run=(action,body={},evidence,authority=a,at=stamp)=>{
  const before=structuredClone(state),r=transition(state,{action,body:{requestId:`r${++n}`,purchaseId:pid,reason:'Customer request',...body}},authority,{trustedRefund:true,refundEvidence:evidence,now:()=>at,id:()=>`e${++n}`});assert.deepEqual(state,before);state=r.state;return r.result.refund;
 };
 const intent=()=>run('refund-intent',{},proof());
 const dispatch=()=>run('refund-dispatch',{operationId:state.refundOperations[0].id},proof());
 const observe=(status,extra={})=>{const op=state.refundOperations[0];return run('refund-observe',{operationId:op.id},{...proof(),operationId:op.id,status,refundId:'refund-1',verified:true,...extra});};
 return {a,p,pid,proof,run,intent,dispatch,observe,get state(){return state;},set state(v){state=v;}};
}
test('full refund preserves commercial history and retires exactly three credits once',()=>{
 const h=setup(),before=structuredClone(h.state);h.intent();h.dispatch();h.observe('completed');h.observe('completed');
 assert.equal(h.state.creditUnits.filter(u=>u.status==='refunded').length,3);
 assert.equal(h.state.creditEvents.filter(e=>e.type==='refund_retire').length,3);
 for(const k of ['purchaseDrafts','paymentAttempts','entitlementIssuances','passes','reservations'])assert.deepEqual(h.state[k],before[k]);
 assert.deepEqual(h.state.creditEvents.slice(0,before.creditEvents.length),before.creditEvents);
 assert.equal(h.state.refundOperations[0].assessment.executionAuthorized,false);
});
test('duplicate staff submissions retain one operation and original actor',()=>{const h=setup(),op=h.intent();assert.deepEqual(h.run('refund-intent'),op);assert.equal(h.state.refundOperations.length,1);assert.throws(()=>h.run('refund-intent',{reason:'changed'}),/different intent/);});
for(const status of ['pending','unknown','failed','rejected'])test(`${status} remains held`,()=>{const h=setup();h.intent();h.dispatch();h.observe(status);assert.ok(h.state.creditUnits.every(u=>u.status==='refund_held'));assert.throws(()=>h.dispatch(),/already claimed/);});
for(const status of ['failed','rejected'])test(`${status} controlled release happens once`,()=>{const h=setup();h.intent();h.dispatch();h.observe(status);const op=h.state.refundOperations[0],e={...h.proof(),status,verified:true,refundId:'refund-1',operationId:op.id};h.run('refund-release',{operationId:op.id},e);h.run('refund-release',{operationId:op.id},e);assert.ok(h.state.creditUnits.every(u=>u.status==='available'));assert.equal(h.state.activity.filter(e=>e.action==='refund-hold-released').length,1);assert.throws(()=>h.dispatch());});
for(const status of ['pending','unknown','completed'])test(`cannot release ${status}`,()=>{const h=setup();h.intent();h.dispatch();h.observe(status);assert.throws(()=>h.run('refund-release',{operationId:h.state.refundOperations[0].id},h.proof()));});
test('held credit cannot be consumed by booking accounting',()=>{const h=setup();h.intent();assert.throws(()=>bookingAccounting(h.state,h.a,{id:()=>'',now:()=>stamp},m=>{throw Error(m);}).consume({id:'booking',participantId:h.p.participantId,passId:h.state.passes[0].id},{creditRequired:true,startsAt:stamp,category:'Pack verification'}),/No eligible/);});
test('held participant cannot create a reservation, including no-credit reservation',()=>{const h=setup();h.intent();assert.throws(()=>h.run('reserve',{participantId:h.p.participantId,classId:'any'}),/booking is held/);});
for(const [name,change] of [
 ['missing provider',e=>e.providerClear=false],['incomplete owned evidence',e=>e.ownedComplete=false],['stale',e=>e.observedAt='2026-10-05T22:59:00Z'],['future',e=>e.observedAt='2026-10-05T23:00:01Z'],['wrong purchase',e=>e.purchaseId='foreign'],['changed state',e=>e.stateDigest='wrong'],['wrong amount',e=>e.amountMinor=1],['missing version',e=>delete e.paymentVersion]
])test(`intent rejects ${name}`,()=>{const h=setup(),e=h.proof();change(e);assert.throws(()=>h.run('refund-intent',{},e));assert.equal(h.state.refundOperations,undefined);});
for(const a of [{role:'member'},{businessId:'foreign'},{tenantId:'foreign'}])test(`denied authority ${JSON.stringify(a)}`,()=>{const h=setup();assert.throws(()=>h.run('refund-intent',{},h.proof(),{...h.a,...a}));});
test('untrusted command cannot inject evidence',()=>{const h=setup();assert.throws(()=>transition(h.state,{action:'refund-intent',body:{purchaseId:h.pid,requestId:'x'}},h.a),/Internal refund/);});
test('exact cutoff and restored usage retain closed reasons',()=>{
 const h=setup(),at='2026-11-01T22:22:38.284Z';assert.throws(()=>h.run('refund-intent',{}, {...h.proof(),observedAt:at},h.a,at),/REFUND_CUTOFF_POLICY_UNRESOLVED/);
 h.state.creditEvents.push({...h.state.creditEvents[0],type:'restore'});assert.throws(()=>h.intent(),/RESTORED_USAGE_POLICY_UNRESOLVED/);
});
test('conflicting terminal outcome and foreign observation do not mutate',()=>{const h=setup();h.intent();h.dispatch();assert.throws(()=>h.observe('completed',{businessId:'foreign'}));h.observe('completed');assert.throws(()=>h.observe('failed'),/Conflicting terminal/);});
test('unrelated entitlement stays unchanged',()=>{const h=setup();h.state.creditUnits.push({id:'other',status:'available',participantId:'other',passId:'other'});h.intent();h.dispatch();h.observe('completed');assert.deepEqual(h.state.creditUnits.at(-1),{id:'other',status:'available',participantId:'other',passId:'other'});});
test('second business uses identical domain transition without Vega branching',()=>{
 const h=setup();function remap(x){if(Array.isArray(x))return x.map(remap);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k==='tenantId'?'tenant-two':k==='businessId'?'business-two':remap(v)]));return x;}
 h.state=remap(h.state);Object.assign(h.a,{tenantId:'tenant-two',businessId:'business-two'});h.state.paymentAttempts[0].offerDigest=digest(h.state.purchaseDrafts[0].terms);h.intent();h.dispatch();h.observe('completed');assert.equal(h.state.refundOperations[0].businessId,'business-two');
});
test('closed assessment is unchanged before intent; members cannot see refund operations',()=>{const h=setup(),args={state:h.state,authority:h.a,purchaseId:h.pid,at:stamp,refundRecords:[]};assert.equal(assessRefundEligibility(args).status,'eligible');h.intent();assert.equal(h.state.refundOperations[0].assessment.status,'eligible');assert.equal(visibleState(h.state,{...h.a,role:'member',participantIds:[]}).refundOperations,undefined);});

function coordinator({outcome='completed',lost=false}={}){
 const h=setup();let tail=Promise.resolve(),calls=0;
 const store={async refundContext(){return {purchase:{purchaseId:h.pid},stateDigest:digest(h.state),ownedComplete:true,operation:h.state.refundOperations?.[0]};},async operation(){return {independentReceipt:{state:'acknowledged'}};},refundCommand(user,cmd,e){
  const job=tail.then(()=>{const op=h.run(cmd.action,cmd.body,e);if(cmd.action==='refund-intent'){h.state.refundOperations[0].intentReceiptId='receipt';op.intentReceiptId='receipt';}return {refund:op,independentReceipt:{operationId:'receipt',state:'pending'}};});tail=job.catch(()=>{});return job;
 }};
 const adapter={readiness:async()=>h.proof(),async submit(op){calls++;if(lost)throw Error('transport lost');return {...h.proof(),operationId:op.id,status:outcome,refundId:'refund-1',verified:true};},inspect:async op=>({...h.proof(),operationId:op.id,status:'unknown'})};
 // Match the real clock for coordinator transport-exception evidence.
 const workflow=createRefundWorkflow({store,adapter,enabled:()=>true,now:()=>stamp});
 return {h,store,workflow,get calls(){return calls;}};
}
test('concurrent duplicate execution permits one provider submission',async()=>{const c=coordinator();const prepared=await c.workflow.prepare('staff',{purchaseId:c.h.pid,reason:'Customer request',requestId:'intent'});const b={purchaseId:c.h.pid,operationId:prepared.refund.id,requestId:'execute'};const results=await Promise.allSettled([c.workflow.execute('staff',b),c.workflow.execute('staff',b)]);assert.equal(c.calls,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(c.h.state.refundOperations[0].status,'completed');});
test('unknown provider result never submits again on replay or reconciliation',async()=>{const c=coordinator({outcome:'unknown'});const p=await c.workflow.prepare('staff',{purchaseId:c.h.pid,reason:'Customer request',requestId:'intent'}),b={purchaseId:c.h.pid,operationId:p.refund.id,requestId:'execute'};await c.workflow.execute('staff',b);await c.workflow.execute('staff',b);await c.workflow.reconcile('staff',b);assert.equal(c.calls,1);assert.equal(c.h.state.refundOperations[0].status,'unknown');});
test('disabled coordinator performs no reads or writes',async()=>{const w=createRefundWorkflow({store:{refundContext(){assert.fail();}},adapter:{}});await assert.rejects(w.prepare('staff',{}),/disabled/);});
test('lost provider response retains hold and never retries on staff replay',async()=>{const c=coordinator({lost:true});const p=await c.workflow.prepare('staff',{purchaseId:c.h.pid,reason:'Customer request',requestId:'intent'}),b={purchaseId:c.h.pid,operationId:p.refund.id,requestId:'execute'};await c.workflow.execute('staff',b);await c.workflow.execute('staff',b);assert.equal(c.calls,1);assert.equal(c.h.state.refundOperations[0].status,'unknown');assert.ok(c.h.state.creditUnits.every(u=>u.status==='refund_held'));});
test('lost dispatch commit acknowledgment cannot submit or redispatch',async()=>{const c=coordinator();const p=await c.workflow.prepare('staff',{purchaseId:c.h.pid,reason:'Customer request',requestId:'intent'}),b={purchaseId:c.h.pid,operationId:p.refund.id,requestId:'execute'};const original=c.store.refundCommand;c.store.refundCommand=async(...args)=>{const r=await original(...args);if(args[1].action==='refund-dispatch')throw Error('commit acknowledgment lost');return r;};await assert.rejects(c.workflow.execute('staff',b));await c.workflow.execute('staff',b);assert.equal(c.calls,0);assert.equal(c.h.state.refundOperations[0].status,'dispatching');});
test('intent recovery acknowledgment required before dispatch',async()=>{const c=coordinator();const p=await c.workflow.prepare('staff',{purchaseId:c.h.pid,reason:'Customer request',requestId:'intent'});c.store.operation=async()=>({pending:true});await assert.rejects(c.workflow.execute('staff',{purchaseId:c.h.pid,operationId:p.refund.id,requestId:'execute'}),/acknowledgment/);assert.equal(c.calls,0);assert.equal(c.h.state.refundOperations[0].status,'intent');});
test('changed frozen purchase after intent blocks dispatch',()=>{const h=setup();h.intent();h.state.purchaseDrafts[0].terms.quantity=4;assert.throws(()=>h.dispatch(),/Purchase changed/);});
