import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {createDevelopmentServer} from '../src/runtime/refund-web.mjs';
import {refundUI} from '../public/refund-ui.js';
const env={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic'};
for(const action of ['prepare','execute','reconcile','release'])test(`disabled ${action} cannot call store or Square`,async()=>{
 let auth=0;const api=createApplicationApi(env,{refundContext(){assert.fail('store access');}},async url=>{assert.equal(url,env.SUPABASE_URL+'/auth/v1/user');auth++;return {ok:true,json:async()=>({id:'4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124'})};});
 const req=Readable.from([Buffer.from(JSON.stringify({purchaseId:'candidate',requestId:'request'}))]);req.url='/api/commerce/refunds/'+action;req.method='POST';req.headers={authorization:'Bearer synthetic','content-type':'application/json'};
 let status,body;await api(req,{writeHead(s){status=s;},end(b){body=JSON.parse(b);}});assert.equal(status,503);assert.match(body.error,/disabled/);assert.equal(auth,1);
});
test('unauthenticated refund cannot inspect purchase',async()=>{const api=createApplicationApi(env,{},()=>assert.fail('network'));const req=Readable.from([]);Object.assign(req,{url:'/api/commerce/refunds/execute',method:'POST',headers:{}});let status;await api(req,{writeHead(s){status=s;},end(){}});assert.equal(status,401);});
test('staff UI clearly disables execution; member receives no refund surface',()=>{let role='staff';const ui=refundUI({getData:()=>({context:{role},purchaseDrafts:[{id:'p',currency:'USD',totalMinor:6000}],refundWorkflow:{purchaseId:'p',enabled:false}}),escape:String});assert.match(ui.render(),/Refund execution is disabled/);assert.match(ui.render(),/<button disabled>/);role='member';assert.equal(ui.render(),'');});
test('new runtime serves refund UI and leaves actual execution disabled',async()=>{const server=createDevelopmentServer(env);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const origin=`http://127.0.0.1:${server.address().port}`;const r=await fetch(origin+'/refund-ui.js');assert.equal(r.status,200);assert.match(await r.text(),/refundUI/);const c=await fetch(origin+'/api/config');assert.equal((await c.json()).externalEffects,'disabled');}finally{await new Promise(resolve=>server.close(resolve));}});
