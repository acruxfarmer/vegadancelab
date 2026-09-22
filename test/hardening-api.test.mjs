import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
const env={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic'};
const identity='11111111-1111-4111-8111-111111111111';
async function request(api,{path='/api/reservations',raw='{}',type='application/json'}={}){
 const req=Readable.from([Buffer.from(raw)]);Object.assign(req,{url:path,method:'POST',headers:{authorization:'Bearer synthetic','content-type':type}});let status,result;
 await api(req,{writeHead:s=>status=s,end:b=>result=JSON.parse(b)});return {status,result};
}
test('malformed bodies and identifiers never reach command execution',async()=>{
 let calls=0;const api=createApplicationApi(env,{command:()=>{calls++;}},async()=>({ok:true,json:async()=>({id:identity})}));
 for(const [args,status] of [[{raw:'{'},400],[{raw:'null'},400],[{raw:'[]'},400],[{raw:'1'},400],[{raw:'"string"'},400],[{raw:'x'.repeat(16385)},413],[{type:'text/plain'},415],[{path:'/api/reservations/%2F/cancel'},404],[{path:'/api/reservations/'+ 'a'.repeat(129)+'/cancel'},404]])assert.equal((await request(api,args)).status,status);
 assert.equal(calls,0);
});
test('revocation and authentication outage fail closed; database outage is generic and recoverable',async()=>{
 let calls=0;
 for(const auth of [async()=>({ok:false,status:401}),async()=>({ok:false,status:503}),async()=>{throw new Error('secret provider detail');},async()=>({ok:true,json:async()=>({id:'-'.repeat(36)})})]){
  const api=createApplicationApi(env,{command:()=>calls++},auth);const r=await request(api);assert.ok([401,503].includes(r.status));assert.doesNotMatch(JSON.stringify(r),/secret/);
 }assert.equal(calls,0);
 let unavailable=true;const api=createApplicationApi(env,{command:()=>{if(unavailable)throw new Error('secret connection detail');return {ok:true};}},async()=>({ok:true,json:async()=>({id:identity})}));
 const r=await request(api);assert.equal(r.status,503);assert.equal(r.result.error,'Application temporarily unavailable');unavailable=false;assert.equal((await request(api)).status,200);
});
test('application readiness returns 503 during database failure and recovers without changing liveness',async()=>{
 let broken=true;const server=createDevelopmentServer(env,null,null,{check:async()=>{if(broken)throw new Error('private database detail');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{let r=await fetch(base+'/health/application');assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private/);assert.equal((await fetch(base+'/health/live')).status,200);broken=false;assert.equal((await fetch(base+'/health/application')).status,200);}finally{await new Promise(r=>server.close(r));}
});
