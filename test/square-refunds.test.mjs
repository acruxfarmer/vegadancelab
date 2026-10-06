import test from 'node:test';
import assert from 'node:assert/strict';
import {createSquareRefundAdapter,REFUND_CANDIDATE} from '../src/runtime/providers/square-refunds.mjs';
import {PAYMENT_BINDING as B,SQUARE_INTEGRATION} from '../src/runtime/providers/square-configuration.mjs';
const at='2026-10-05T23:00:00Z';
function fixture(change=()=>{}){
 const o={id:'operation',providerKey:'operation',reason:'Customer request',purchaseId:REFUND_CANDIDATE,paymentId:'8VcoKhYwBs2FzSVqIjZjCD8yqyAZY',attemptId:'attempt',tenantId:B.tenantId,businessId:B.businessId,amountMinor:6000,currency:'USD',quantity:3,integrationRef:SQUARE_INTEGRATION,status:'dispatching',paymentVersion:'v1'};
 const e={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',VEGA_SANDBOX_REFUND_EXECUTION:'authorized',VEGA_SANDBOX_REFUND_PURCHASE_ID:REFUND_CANDIDATE,SQUARE_ENVIRONMENT:'sandbox',SQUARE_APPLICATION_ID:B.applicationId,SQUARE_MERCHANT_ID:B.merchantId,SQUARE_LOCATION_ID:B.locationId,SQUARE_ACCESS_TOKEN:'synthetic-test-only'};
 const p={id:o.paymentId,status:'COMPLETED',location_id:B.locationId,application_details:{application_id:B.applicationId},reference_id:o.attemptId,source_type:'CARD',amount_money:{amount:6000,currency:'USD'},total_money:{amount:6000,currency:'USD'},created_at:'2026-10-02T22:22:37Z',version_token:'v1'};
 const x={o,e,p,refunds:[],disputes:[],status:'COMPLETED',calls:[],page:false,throwPost:false,wrongRefund:false};change(x);
 const fetcher=async(url,options)=>{
  x.calls.push({url,options});assert.ok(url.startsWith('https://connect.squareupsandbox.com/'));assert.equal(options.redirect,'error');
  let body;
  if(url.endsWith('/oauth2/token/status'))body={client_id:B.applicationId,merchant_id:B.merchantId};
  else if(url.includes('/locations/'))body={location:{id:B.locationId,merchant_id:B.merchantId,currency:'USD',status:'ACTIVE'}};
  else if(url.includes('/payments/'))body={payment:p};
  else if(url.includes('/disputes?'))body={disputes:x.disputes};
  else if(url.includes('/refunds?'))body={refunds:x.refunds,...(x.page&&!url.includes('cursor=')?{cursor:'next'}:{})};
  else if(url.endsWith('/refunds')||url.includes('/refunds/refund-1')){
   if(x.throwPost)throw Error('simulated lost response');
   body={refund:{id:'refund-1',payment_id:x.wrongRefund?'wrong':o.paymentId,location_id:B.locationId,status:x.status,amount_money:{amount:6000,currency:'USD'},reason:`Refund ${o.id}: ${o.reason}`}};
  }else assert.fail(url);
  return {ok:true,json:async()=>structuredClone(body)};
 };
 return {...x,adapter:createSquareRefundAdapter(e,fetcher,()=>at)};
}
test('fresh bounded provider evidence exhausts pages without status filtering',async()=>{const x=fixture(x=>x.page=true),r=await x.adapter.readiness(x.o);assert.equal(r.providerClear,true);assert.equal(r.coverage.paginationExhausted,true);assert.equal(x.calls.filter(c=>c.url.includes('/refunds?')).length,2);assert.ok(x.calls.every(c=>!c.url.includes('status=')));assert.ok(x.calls.every(c=>c.options.method==='GET'||c.url.endsWith('/oauth2/token/status')));});
for(const [name,change] of [['existing pending refund',x=>x.refunds=[{payment_id:x.o.paymentId,status:'PENDING'}]],['dispute',x=>x.disputes=[{disputed_payment:{payment_id:x.o.paymentId}}]],['wrong amount',x=>x.p.amount_money.amount=5000],['refunded payment',x=>x.p.refunded_money={amount:6000}],['wrong location',x=>x.p.location_id='foreign'],['foreign scope',x=>x.o.businessId='foreign'],['missing version',x=>delete x.p.version_token]])test(`readiness blocks ${name}`,async()=>{const x=fixture(change);await assert.rejects(x.adapter.readiness(x.o));});
for(const [provider,status] of [['COMPLETED','completed'],['PENDING','pending'],['FAILED','failed'],['REJECTED','rejected']])test(`provider ${provider} normalized independently`,async()=>{const x=fixture(x=>x.status=provider);const r=await x.adapter.submit(x.o);assert.equal(r.status,status);const post=x.calls.find(c=>c.url.endsWith('/v2/refunds'));assert.equal(JSON.parse(post.options.body).idempotency_key,x.o.providerKey);assert.equal(JSON.parse(post.options.body).payment_version_token,'v1');assert.equal(x.calls.filter(c=>c.url.endsWith('/v2/refunds')).length,1);});
test('lost response stays unknown with exactly one POST',async()=>{const x=fixture(x=>x.throwPost=true);assert.equal((await x.adapter.submit(x.o)).status,'unknown');assert.equal(x.calls.filter(c=>c.url.endsWith('/v2/refunds')).length,1);});
test('forged/mismatched result remains unknown',async()=>{const x=fixture(x=>x.wrongRefund=true);assert.equal((await x.adapter.submit(x.o)).status,'unknown');});
test('missing refund ID is not inferred absent and causes no request',async()=>{const x=fixture();assert.equal((await x.adapter.inspect(x.o)).status,'unknown');assert.equal(x.calls.length,0);});
test('known refund reconciliation is GET-only apart from read-only token introspection',async()=>{const x=fixture();x.o.providerRefundId='refund-1';assert.equal((await x.adapter.inspect(x.o)).status,'completed');assert.equal(x.calls.filter(c=>c.url.endsWith('/v2/refunds')).length,0);});
for(const [name,change] of [['disabled',x=>x.e.VEGA_SANDBOX_REFUND_EXECUTION='disabled'],['production',x=>x.e.VEGA_ENV='production'],['other purchase',x=>x.o.purchaseId='other']])test(`transport blocks ${name} before requests`,async()=>{const x=fixture(change);await assert.rejects(x.adapter.submit(x.o));assert.equal(x.calls.length,0);});
