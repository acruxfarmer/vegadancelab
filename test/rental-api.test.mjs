import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
const env={SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic',RENDER:'true'};
const actor='11111111-1111-4111-8111-111111111111',placement='22222222-2222-4222-8222-222222222222';
async function request(api,action,{token='Bearer valid',body={},cookie,method='POST',query=''}={}){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:`/api/media/placements/${placement}/rental/${action}${query}`,method,headers:{'content-type':'application/json',authorization:token,...(cookie?{cookie}:{})}});
 let status,result;const headers={};await api(req,{setHeader:(k,v)=>headers[k]=v,writeHead:s=>status=s,end:x=>result=JSON.parse(x)});return {status,result,headers};
}
test('rental HTTP authenticates, supplies server device cookie and rejects authority injection',async()=>{
 let calls=[];const api=createApplicationApi(env,{rentalPlayback:{start:async(...args)=>{calls.push(args);return {rental:{sessionId:'session'}};}}},async()=>({ok:true,json:async()=>({id:actor})}));
 const r=await request(api,'start',{body:{requestId:'start'}});assert.equal(r.status,200);assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);assert.match(r.headers['Set-Cookie'],/; Secure$/);assert.equal(calls[0][0],actor);assert.equal(calls[0][1],placement);assert.match(calls[0][2].deviceId,/^[a-f0-9]{64}$/);
 const cookie=r.headers['Set-Cookie'].split(';')[0];await request(api,'start',{cookie,body:{sessionId:'session'}});assert.equal(calls[1][2].deviceId,calls[0][2].deviceId);
 for(const body of [{deviceId:'forged'},{evidence:{}},{principalId:actor},{sessionId:[]},{rentalPolicy:{}}])assert.equal((await request(api,'start',{body})).status,400);
 assert.equal((await request(api,'start',{token:undefined})).status,200);
 assert.equal((await request(api,'start',{token:''})).status,401);assert.equal((await request(api,'start',{query:'?scope=other'})).status,400);assert.equal(calls.length,3);
});
test('rental finish needs existing device continuity and reconciles revoked tickets',async()=>{
 const calls=[];const api=createApplicationApi(env,{rentalPlayback:{finish:async(...x)=>{calls.push(['finish',...x]);return {done:true};},revokePending:async(...x)=>calls.push(['revoke',...x])}},async()=>({ok:true,json:async()=>({id:actor})}));
 assert.equal((await request(api,'finish',{body:{sessionId:'s',attemptId:'a'}})).status,403);assert.equal(calls.length,0);
 const r=await request(api,'finish',{cookie:'vega_rental_device='+'a'.repeat(64),body:{sessionId:'s',attemptId:'a'}});assert.equal(r.status,200);assert.deepEqual(calls.map(x=>x[0]),['finish','revoke']);
});
