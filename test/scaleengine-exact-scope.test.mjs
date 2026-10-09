import test from 'node:test';
import assert from 'node:assert/strict';
import {scaleEngineAssetScope} from '../src/runtime/providers/scaleengine-asset-scope.mjs';
import {proveScaleEngineExactScope} from '../src/runtime/providers/scaleengine-exact-scope-proof.mjs';
const url=name=>'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/'+name+'/playlist.m3u8';
const binding={id:'b',resourceId:'r',provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/a.mp4',playbackRef:url('a.mp4')};
const resource={id:'r',lifecycle:'active'};
function fixture(options={}){
 const events=[],calls=[];let payload;
 const fetcher=async(raw,o)=>{
  const u=new URL(raw);calls.push({u,o});assert.equal(o.redirect,'error');
  if(u.hostname==='acruxanalog-sestore.secdn.net'){
   const name=u.pathname.split('/').at(-1);return Response.json({data:{name,path:name,parent:'.',type:'file',size:400,metadata:{deleted:0,invalid:0,duration:3},vod_url:url(name)}});
  }
  if(o.method==='PUT'){
   payload=JSON.parse(o.body);return Response.json({data:{key:'returned-key',pass:'returned-pass',app:payload.app,video:payload.video,active:true,expire_date:payload.expire_date,...options.ticket}});
  }
  if(o.method==='DELETE')return new Response(null,{status:options.cleanupStatus||204});
  assert.equal(o.headers?.Authorization,undefined);
  if(!u.search)return new Response(null,{status:403});
  assert.equal(u.searchParams.get('key'),'returned-key');assert.equal(u.searchParams.get('pass'),'returned-pass');
  if(u.pathname.includes('/b.mp4/'))return new Response(null,{status:options.bStatus||403});
  if(options.aFails)return new Response(null,{status:403});
  if(u.pathname.endsWith('playlist.m3u8'))return new Response('#EXTM3U\n'+(options.child||'chunk.ts')+'\n');
  const bytes=Buffer.alloc(376);bytes[0]=bytes[188]=0x47;return new Response(bytes);
 };
 const run=(override={})=>proveScaleEngineExactScope({environment:'development',cdnId:'123',apiSecret:'account-secret',resource,binding,otherFile:'b.mp4',observe:async e=>events.push(e),...override},fetcher);
 return {run,events,calls,payload:()=>payload};
}
test('scope uses the ready persisted mapping, with no guessed resource filename',()=>{
 assert.equal(scaleEngineAssetScope(binding).video,'sestore99/acruxanalog/a.mp4');
 const changed={...binding,assetRef:'/different.mp4',playbackRef:url('different.mp4')};
 assert.equal(scaleEngineAssetScope(changed).video,'sestore99/acruxanalog/different.mp4');
});
test('ambiguous, wildcard, escaped, mismatched and unready mappings fail closed',()=>{
 for(const b of [{...binding,state:'uploading'},{...binding,assetRef:'/wrong.mp4'},...['https://other.example/a.mp4',url('*.mp4'),url('%61.mp4'),url('../a.mp4'),url('a.mp4')+'?key=secret'].map(playbackRef=>({...binding,playbackRef}))])assert.throws(()=>scaleEngineAssetScope(b));
});
test('canonical identity mismatch cannot make a provider request',async()=>{
 const f=fixture();await assert.rejects(f.run({resource:{id:'other',lifecycle:'active'}}));assert.equal(f.calls.length,0);
});
test('one exact ticket plays A bytes, denies real B, remains valid for A, and is removed',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.assetAPlayback,true);assert.equal(result.assetBDenied,true);assert.equal(result.stillValidAfterDenial,true);
 assert.equal(f.payload().video,'sestore99/acruxanalog/a.mp4');assert.equal(f.payload().app,'acruxanalog-vod');assert.equal(f.payload().ip,'auto');assert.equal(f.payload().uses,5);
 assert.equal(f.calls.filter(c=>c.o.method==='PUT').length,1);assert.equal(f.calls.filter(c=>c.o.method==='DELETE').length,1);
 assert.notEqual(f.payload().pass,'returned-pass');
 const evidence=JSON.stringify(f.events);for(const secret of ['returned-key','returned-pass','account-secret',f.payload().pass,'?key='])assert.equal(evidence.includes(secret),false);
 assert.equal(f.events.at(-1).ticketRemoved,true);
});
test('B success fails isolation without retrying or changing scope',async()=>{
 const f=fixture({bStatus:200});await assert.rejects(f.run(),e=>e.safeCategory==='asset-b-isolation-failed');assert.equal(f.calls.filter(c=>c.o.method==='PUT').length,1);assert.equal(f.events.at(-1).ticketRemoved,true);
});
test('A failure stops before ticketed B and still cleans up',async()=>{
 const f=fixture({aFails:true});await assert.rejects(f.run(),e=>e.safeCategory==='asset-a-playback-failed');assert.equal(f.events.some(e=>e.stage==='asset-b-same-ticket'),false);assert.equal(f.events.at(-1).ticketRemoved,true);
});
test('out-of-asset playlist child cannot receive the ticket',async()=>{
 const f=fixture({child:'https://evil.example/segment.ts'});await assert.rejects(f.run(),e=>e.safeCategory==='playlist-reference-outside-asset');assert.equal(f.calls.some(c=>c.u.hostname==='evil.example'),false);assert.equal(f.events.at(-1).ticketRemoved,true);
});
test('missing returned password never falls back to locally generated password',async()=>{
 const f=fixture({ticket:{pass:''}});await assert.rejects(f.run(),e=>e.safeCategory==='returned-ticket-invariants-failed');assert.equal(f.events.some(e=>e.stage==='asset-a-playback'),false);assert.equal(f.events.at(-1).ticketRemoved,true);
});
test('cleanup failure prevents a passing proof result',async()=>{
 const f=fixture({cleanupStatus:500});await assert.rejects(f.run(),e=>e.safeCategory==='ticket-cleanup-unconfirmed');assert.equal(f.events.at(-1).cleanupPending,true);
});
test('production and same-asset negative controls fail before requests',async()=>{
 for(const overrides of [{environment:'production'},{otherFile:'a.mp4'}]){const f=fixture();await assert.rejects(f.run(overrides));assert.equal(f.calls.length,0);}
});
