import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {createApplicationStore} from '../src/runtime/application-database.mjs';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const uid='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124';
const purchaseId=fixture.purchaseDrafts[0].id;
const path=`/api/commerce/purchases/${purchaseId}/refund-assessment`;
function setup(change=()=>{}){
 const x={state:structuredClone(fixture),role:'staff',business:'vega-dance-lab',at:'2026-10-02T22:57:44Z',inventory:true,records:[],method:'GET',path,token:true};change(x);
 const before=structuredClone(x.state),queries=[];let released=false,inventoryCalls=0;
 const pool={connect:async()=>({release(){released=true;},async query(sql,args){
  queries.push(sql);
  if(sql==='begin isolation level repeatable read read only'||sql==='commit'||sql==='rollback'||sql.startsWith('select set_config'))return {rows:[]};
  if(sql.startsWith('select tenant_id')){assert.equal(args[0],uid);return {rows:[{tenant_id:'vega-development',business_id:x.business,role:x.role,participant_ids:[]}]};}
  if(sql.startsWith('select state,revision')){assert.deepEqual(args,['vega-development',x.business]);return {rows:[{state:x.state,revision:'127'}]};}
  assert.fail('Unexpected SQL: '+sql);
 }})};
 const options={assessmentNow:()=>x.at};
 if(x.inventory)options.refundInventory=({authority,revision,purchaseId})=>{inventoryCalls++;return {complete:!x.incomplete,tenantId:authority.tenantId,businessId:authority.businessId,purchaseId,revision:x.stale?'126':revision,records:x.records};};
 const store=createApplicationStore(pool,options);
 const api=createApplicationApi({SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'},store,async url=>{assert.equal(url,'https://cjdoczrxcjynjhgpgqop.supabase.co/auth/v1/user');return {ok:true,json:async()=>({id:uid})};});
 return {x,queries,async run(){const req=Readable.from([]);req.url=x.path;req.method=x.method;req.headers=x.token?{authorization:'Bearer synthetic'}:{};let status,body,headers;await api(req,{writeHead(s,h){status=s;headers=h;},end(b){body=JSON.parse(b);}});assert.deepEqual(x.state,before);assert.ok(queries.every(q=>!/\b(insert|update|delete|alter|create)\b/i.test(q)));if(queries.length)assert.ok(released);assert.equal(headers['Cache-Control'],'no-store');return {status,body,inventoryCalls};}};
}
const cases=[
 ['authorized staff eligible',()=>{},200,'eligible','OWNED_PAYMENT_CONFIRMED'],
 ['member denied',x=>x.role='member',403,'denied','OWNERSHIP_SCOPE_DENIED'],
 ['cross business',x=>x.business='other',403,'denied','OWNERSHIP_SCOPE_DENIED'],
 ['missing purchase',x=>x.state.purchaseDrafts=[],403,'denied','OWNERSHIP_SCOPE_DENIED'],
 ['expired',x=>x.at='2026-11-02T00:00:00Z',200,'ineligible','REFUND_WINDOW_EXPIRED'],
 ['partial consumption',x=>x.state.creditUnits[0].status='spent',200,'ineligible','ENTITLEMENT_CONSUMED'],
 ['full consumption',x=>x.state.creditUnits.forEach(u=>u.status='spent'),200,'ineligible','ENTITLEMENT_CONSUMED'],
 ['already refunded',x=>x.state.purchaseDrafts[0].status='refunded',200,'ineligible','EXISTING_REFUND_OR_REVERSAL'],
 ['refund inventory record',x=>x.records=[{purchaseId,status:'completed'}],200,'blocked','EXISTING_REFUND_OR_REVERSAL'],
 ['reversal',x=>x.state.creditUnits[0].status='reversed',200,'ineligible','EXISTING_REFUND_OR_REVERSAL'],
 ['inconsistent payment',x=>x.state.paymentAttempts[0].evidence.verified=false,200,'blocked','OWNED_PROVIDER_STATE_INCONSISTENT'],
 ['inconsistent fulfillment',x=>x.state.passes=[],200,'blocked','FULFILLMENT_STATE_INCONSISTENT'],
 ['missing inventory default',x=>x.inventory=false,200,'blocked','REFUND_STATE_UNRESOLVED'],
 ['incomplete inventory',x=>x.incomplete=true,200,'blocked','REFUND_STATE_UNRESOLVED'],
 ['stale inventory',x=>x.stale=true,200,'blocked','REFUND_STATE_UNRESOLVED'],
 ['malformed inventory',x=>x.records=[null],200,'blocked','REFUND_STATE_UNRESOLVED'],
 ['cutoff unresolved',x=>x.at='2026-11-01T22:22:38.284Z',200,'blocked','REFUND_CUTOFF_POLICY_UNRESOLVED'],
 ['restored usage unresolved',x=>x.state.creditEvents.push({...x.state.creditEvents[0],type:'consume'},{...x.state.creditEvents[0],type:'restore'}),200,'blocked','RESTORED_USAGE_POLICY_UNRESOLVED'],
];
for(const [name,change,http,status,reason] of cases)test(`refund endpoint: ${name}`,async()=>{const h=setup(change);const r=await h.run();assert.equal(r.status,http);assert.equal(r.body.status,status);assert.ok(r.body.reasonCodes.includes(reason));assert.equal(r.body.purchaseId,purchaseId);assert.equal(r.body.staffApprovalRequired,true);assert.equal(r.body.executionAuthorized,false);assert.equal(r.body.assessedAt,h.x.at);assert.equal(r.body.revision,status==='denied'?null:'127');if(h.x.role!=='staff')assert.ok(!h.queries.some(q=>q.startsWith('select state')));if(status==='denied')assert.equal(r.inventoryCalls,0);});
for(const [name,change,status] of [['unauthenticated',x=>x.token=false,401],['POST forbidden',x=>x.method='POST',405],['client inventory forbidden',x=>x.path+='?refundRecords=[]',400]])test(`refund endpoint: ${name}`,async()=>{const h=setup(change),r=await h.run();assert.equal(r.status,status);assert.equal(h.queries.length,0);});
