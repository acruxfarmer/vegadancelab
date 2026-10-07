import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {createMediaOwnerManagement} from '../src/runtime/media-owner-management.mjs';
const owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';
test('owner management uses verified principal without any staff or business headers',async()=>{
 let captured;const api=createApplicationApi({SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public'},{mediaOwnerManagement:async(id,input)=>{captured={id,input};return {items:[]};}},async()=>({ok:true,json:async()=>({id:owner,is_anonymous:false,user_metadata:{role:'staff'}})}));
 const req=Readable.from([Buffer.from(JSON.stringify({action:'archive',id:owner,expectedRevision:1}))]);req.url='/api/media-management';req.method='POST';req.headers={authorization:'Bearer token','content-type':'application/json','x-vega-business':'forged'};
 let status,body;await api(req,{writeHead:s=>status=s,end:b=>body=JSON.parse(b)});
 assert.equal(status,200);assert.equal(captured.id,owner);assert.equal(captured.input.action,'archive');assert.deepEqual(body,{items:[]});
});
test('owner list and business choices apply server authorization and omit business state',async()=>{
 const owned={id:owner,owner:{kind:'user',userId:owner},title:'Mine',source:{kind:'external_reference',provider:'example',reference:'sample'},lifecycle:'active'};
 const foreign={...owned,id:'foreign',owner:{kind:'user',userId:'other'}};
 const queries=[];const manage=createMediaOwnerManagement({connect:async()=>({release(){},async query(sql){queries.push(sql);if(sql.startsWith('select document from media_private.resources'))return {rows:[{document:owned},{document:foreign}]};return {rows:[]};}})});
 const result=await manage(owner);assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Mine');assert.deepEqual(result.businesses,[]);assert.equal(result.state,undefined);assert.equal(queries.at(-1),'commit');
});
test('management rejects unauthenticated identities before connecting and rolls back invalid actions',async()=>{
 let calls=0;const log=[];const manage=createMediaOwnerManagement({connect:async()=>{calls++;return {release(){log.push('released');},query:async sql=>{log.push(sql);return {rows:[]};}};}});
 await assert.rejects(manage(''),/Sign in/);assert.equal(calls,0);
 await assert.rejects(manage(owner,{action:'transfer',id:owner,expectedRevision:1}),/Unsupported/);assert.deepEqual(log.slice(-2),['rollback','released']);
});
