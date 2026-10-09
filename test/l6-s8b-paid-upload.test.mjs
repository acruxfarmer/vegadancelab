import test from 'node:test';
import assert from 'node:assert/strict';
import {paidFixtureUploadAdapter} from '../scripts/l6-s8b-upload-adapter.mjs';
const id='11111111-1111-4111-8111-111111111111',name='acrux-l6-s8b-'+id+'.mp4';
const file=()=>({name,path:name,parent:'.',type:'file',size:3578,metadata:{deleted:0,invalid:0,video_codec:'h264',duration:3},vod_url:'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/'+name+'/playlist.m3u8'});
const config={cdnId:'123',apiSecret:'test-secret'};
test('one upload after absent-file preflight accepts observed root response and exact provider mapping',async()=>{
 const calls=[];const a=paidFixtureUploadAdapter(config,async(url,o)=>{calls.push({url,method:o.method||'GET'});return calls.length===1?new Response(null,{status:404}):Response.json({errors:[],data:file()});});
 assert.equal((await a.upload(id,Buffer.alloc(3578))).assetRef,'/'+name);
 const ready=await a.inspect(id);assert.equal(ready.state,'ready');assert.equal(ready.playbackRef,file().vod_url);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls[1].url,'https://acruxanalog-sestore.secdn.net/v1/upload/'+name);
});
test('existing file and uncertain upload never trigger overwrite or automatic retry',async()=>{
 let calls=0;const existing=paidFixtureUploadAdapter(config,async()=>{calls++;return Response.json({data:file()});});
 await assert.rejects(existing.upload(id,Buffer.alloc(3578)));assert.equal(calls,1);
 calls=0;const uncertain=paidFixtureUploadAdapter(config,async()=>{if(++calls===1)return new Response(null,{status:404});throw Error('network');});
 await assert.rejects(uncertain.upload(id,Buffer.alloc(3578)));assert.equal(calls,2);
});
test('readiness fails closed for wrong identity, missing index and unrelated playback mapping',async()=>{
 for(const change of [{path:'other.mp4'},{size:12},{vod_url:file().vod_url.replace(name,'other.mp4')}]){
  const a=paidFixtureUploadAdapter(config,async()=>Response.json({data:{...file(),...change}}));await assert.rejects(a.inspect(id));
 }
 const a=paidFixtureUploadAdapter(config,async()=>Response.json({data:{...file(),metadata:{}}}));assert.equal((await a.inspect(id)).state,'processing');
});
