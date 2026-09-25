import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
const env={SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic'};
const sessionJwt=`header.${Buffer.from(JSON.stringify({session_id:'11111111-1111-4111-8111-111111111111'})).toString('base64url')}.signature`;
test('business API withholds domain confirmation until independent receipt acknowledgment',async()=>{
 let state='pending';const operationId='a'.repeat(64);
 const result=()=>({id:'booking',status:'reserved',independentReceipt:{operationId,state}});
 const api=createApplicationApi(env,{command:async()=>result(),operation:async()=>state==='acknowledged'?result():{pending:true,independentReceipt:{operationId,state}}},async()=>({ok:true,json:async()=>({id:'11111111-1111-4111-8111-111111111111'})}));
 const pending=await request(api,'/api/reservations',{method:'POST',token:'Bearer valid',body:{requestId:'r'}});
 assert.equal(pending.status,202);assert.equal(pending.result.pending,true);assert.equal(pending.result.status,undefined);assert.equal(pending.result.id,undefined);
 assert.equal((await request(api,'/api/recovery/operations/'+operationId,{token:'Bearer valid'})).status,202);
 state='acknowledged';const confirmed=await request(api,'/api/recovery/operations/'+operationId,{token:'Bearer valid'});assert.equal(confirmed.status,200);assert.equal(confirmed.result.status,'reserved');
});
test('sign-out completes without waiting for unavailable evidence persistence',async()=>{
 let observed=false;
 const api=createApplicationApi(env,{recordRevocation:()=>{observed=true;return new Promise(()=>{});}},async()=>({ok:true,status:204}));
 const result=await request(api,'/api/auth/sign-out',{method:'POST',token:`Bearer ${sessionJwt}`,body:{refreshToken:'r'}});
 assert.equal(result.status,200);assert.equal(result.result.signedOut,true);await Promise.resolve();assert.equal(observed,true);
});
test('sign-out revokes current provider session and replay cannot refresh or read; repeat is idempotent',async()=>{
 let active=true,reads=0;const calls=[];
 const api=createApplicationApi(env,{read:()=>{reads++;return {};}},async(url,init)=>{
  calls.push(url);assert.equal(init.headers.apikey,'synthetic');
  if(url.endsWith('/logout?scope=local')){assert.equal(init.headers.Authorization,`Bearer ${sessionJwt}`);if(!active)return {ok:false,status:403,json:async()=>({code:'session_not_found'})};active=false;return {ok:true,status:204};}
  if(url.includes('grant_type=refresh_token'))return {ok:false,status:400};
  if(url.endsWith('/user'))return {ok:false,status:403};
  throw new Error('Unexpected provider operation');
 });
 const args={method:'POST',token:`Bearer ${sessionJwt}`,body:{refreshToken:'captured'}};
 assert.deepEqual(await request(api,'/api/auth/sign-out',args),{status:200,result:{signedOut:true}});
 assert.equal((await request(api,'/api/auth/sign-out',args)).status,200);
 assert.equal((await request(api,'/api/auth/refresh',{method:'POST',body:{refreshToken:'captured'}})).status,401);
 assert.equal((await request(api,'/api/app',{token:`Bearer ${sessionJwt}`})).status,401);assert.equal(reads,0);
 assert.equal(calls.filter(u=>u.includes('/logout?scope=local')).length,2);
});
test('expired access is refreshed solely for current-session revocation; no rotated credentials escape',async()=>{
 const calls=[];const api=createApplicationApi(env,null,async(url,init)=>{
  calls.push(url);if(calls.length===1)return {ok:false,status:401,json:async()=>({code:'bad_jwt'})};
  if(calls.length===2){assert.deepEqual(JSON.parse(init.body),{refresh_token:'expired-access-refresh'});return {ok:true,json:async()=>({access_token:sessionJwt,refresh_token:'never-returned'})};}
  assert.ok(url.endsWith('/logout?scope=local'));return {ok:true,status:204};
 });
 const result=await request(api,'/api/auth/sign-out',{method:'POST',token:`Bearer ${sessionJwt}`,body:{refreshToken:'expired-access-refresh'}});
 assert.deepEqual(result,{status:200,result:{signedOut:true}});assert.equal(calls.length,3);
});
test('invalid credentials and provider failures never claim confirmed sign-out or access the store',async()=>{
 for(const status of [400,401,403,429,500]){
  const api=createApplicationApi(env,{read:()=>assert.fail('store')},async()=>({ok:false,status,json:async()=>({code:'bad_jwt'})}));
  const result=await request(api,'/api/auth/sign-out',{method:'POST',token:`Bearer ${sessionJwt}`,body:{refreshToken:'invalid'}});
  assert.ok([401,503].includes(result.status));assert.equal(result.result.signedOut,undefined);
 }
 const api=createApplicationApi(env,null,async()=>{throw new Error('timeout');});
 assert.equal((await request(api,'/api/auth/sign-out',{method:'POST',token:`Bearer ${sessionJwt}`,body:{}})).status,503);
});
test('session-less JWT cannot widen sign-out scope; missing credentials fail closed',async()=>{
 let calls=0;const api=createApplicationApi(env,null,async()=>{calls++;assert.fail('provider must not receive session-less JWT');});
 const nil=`Bearer header.${Buffer.from(JSON.stringify({session_id:'00000000-0000-0000-0000-000000000000'})).toString('base64url')}.signature`;
 for(const token of [undefined,'Bearer header.e30.signature',nil])assert.equal((await request(api,'/api/auth/sign-out',{method:'POST',token,body:{}})).status,401);
 assert.equal(calls,0);
});
test('duplication review and confirmation authenticate before dispatch and use separate read/command paths',async()=>{
 const id='11111111-1111-4111-8111-111111111111',calls=[];
 const api=createApplicationApi(env,{reviewClassDuplicate:async(user,body)=>{calls.push(['review',user,body]);return {reviewToken:'review'};},command:async(user,cmd)=>{calls.push(['command',user,cmd]);return {id:'new'};}},async()=>({ok:true,json:async()=>({id})}));
 const body={classId:'source',userId:'forged',details:{startsAt:'2099-10-03T12:00:00Z'}};
 for(const path of ['/api/classes/duplicate/review','/api/classes/duplicate'])assert.equal((await request(api,path,{method:'POST',body})).status,401);
 assert.equal(calls.length,0);
 assert.equal((await request(api,'/api/classes/duplicate/review',{token:'Bearer valid',method:'POST',body})).status,200);assert.deepEqual(calls,[['review',id,body]]);
 assert.equal((await request(api,'/api/classes/duplicate',{token:'Bearer valid',method:'POST',body})).status,200);assert.equal(calls[1][1],id);assert.equal(calls[1][2].action,'duplicate-class');
});
async function request(api,path,{token,body,method='GET'}={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:path,method,headers:{'content-type':'application/json',...(token?{authorization:token}:{})}});let status,result;await api(req,{writeHead:s=>status=s,end:x=>result=JSON.parse(x)});return {status,result};}
test('occurrence review uses authenticated read-only store method; confirm routes through transactional command',async()=>{
 const id='11111111-1111-4111-8111-111111111111',calls=[];
 const api=createApplicationApi(env,{reviewClassEdit:async(user,body)=>{calls.push(['review',user,body]);return {reviewToken:'review'};},command:async(user,cmd)=>{calls.push(['command',user,cmd]);return {outcome:'applied'};}},async()=>({ok:true,json:async()=>({id})}));
 const body={classId:'c',userId:'forged',details:{title:'Proposed'}};
 assert.equal((await request(api,'/api/classes/edit/review',{token:'Bearer valid',method:'POST',body})).status,200);assert.deepEqual(calls,[['review',id,body]]);
 assert.equal((await request(api,'/api/classes/edit',{token:'Bearer valid',method:'POST',body})).status,200);assert.equal(calls[1][1],id);assert.equal(calls[1][2].action,'edit-class');
 assert.equal((await request(api,'/api/classes/edit/review',{method:'POST',body})).status,401);assert.equal(calls.length,2);
});
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

test('refresh exchanges only the supplied refresh token and returns rotated credentials',async()=>{
 let sent,url;const api=createApplicationApi(env,null,async(u,init)=>{url=u;sent=JSON.parse(init.body);return {ok:true,json:async()=>({access_token:'new.access',refresh_token:'new-refresh',expires_in:3600,user:{user_metadata:{role:'staff'}}})};});
 const r=await request(api,'/api/auth/refresh',{method:'POST',body:{refreshToken:'old-refresh',role:'staff',userId:'attacker'}});
 assert.equal(r.status,200);assert.ok(url.endsWith('grant_type=refresh_token'));assert.deepEqual(sent,{refresh_token:'old-refresh'});assert.equal(r.result.refreshToken,'new-refresh');assert.equal(r.result.role,undefined);assert.equal(r.result.user,undefined);
});
test('invalid or revoked refresh session cannot access the store',async()=>{
 let used=false;const api=createApplicationApi(env,{read:()=>used=true},async()=>({ok:false,status:400}));
 assert.equal((await request(api,'/api/auth/refresh',{method:'POST',body:{refreshToken:'revoked'}})).status,401);
 assert.equal((await request(api,'/api/auth/refresh',{method:'POST',body:{}})).status,401);assert.equal(used,false);
});
