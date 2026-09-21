import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
const env={SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic'};
async function request(api,path,{token,body,method='GET'}={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:path,method,headers:{'content-type':'application/json',...(token?{authorization:token}:{})}});let status,result;await api(req,{writeHead:s=>status=s,end:x=>result=JSON.parse(x)});return {status,result};}
test('missing and forged sessions cannot read application or execute commands',async()=>{
 let used=false;const api=createApplicationApi(env,{read:()=>used=true},async()=>({ok:false,status:401}));
 assert.equal((await request(api,'/api/app')).status,401);
 assert.equal((await request(api,'/api/app',{token:'Bearer forged'})).status,401);assert.equal(used,false);
});
test('validated identity comes from auth service, never request user or metadata',async()=>{
 const id='11111111-1111-4111-8111-111111111111';let identity;
 const api=createApplicationApi(env,{command:async(user)=>{identity=user;return {saved:true};}},async()=>({ok:true,json:async()=>({id,user_metadata:{role:'staff'}})}));
 const response=await request(api,'/api/reservations',{token:'Bearer valid',method:'POST',body:{userId:'attacker',requestId:'x'}});assert.equal(response.status,200);assert.equal(identity,id);
});
