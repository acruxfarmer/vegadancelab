import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistReferenceStructure,playlistQueryNames,inspectScaleEnginePlaylist} from '../src/runtime/providers/scaleengine-playlist-inspection.mjs';
const master='https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/a.mp4/playlist.m3u8';
const scope='sestore99/acruxanalog/a.mp4';
test('query-only rejection retains exact child path but no query values',()=>{
 const s=playlistReferenceStructure(master,'chunk.m3u8?key=secret-key&pass=secret-pass&other=sensitive',scope);
 assert.equal(s.childReferenceWithoutQueryOrFragment,'chunk.m3u8');assert.deepEqual(s.currentGuardReasons,['query-present']);assert.equal(s.sameLogicalAsset,true);assert.equal(s.originChanges,false);assert.equal(s.referenceKind,'relative');
 for(const v of ['secret-key','secret-pass','sensitive'])assert.equal(JSON.stringify(s).includes(v),false);
});
test('different namespace remains unproven and records literal path without guessing',()=>{
 const s=playlistReferenceStructure(master,'/other/namespace/chunk.m3u8',scope);
 assert.equal(s.childReferenceWithoutQueryOrFragment,'/other/namespace/chunk.m3u8');assert.equal(s.sameLogicalAsset,null);assert.equal(s.referenceKind,'root-relative');assert.deepEqual(s.currentGuardReasons,['pathname-outside-master-directory']);
});
test('unrelated origin, userinfo, fragments and known path secrets are sanitized',()=>{
 const s=playlistReferenceStructure(master,'https://user:password@unrelated.example/known-secret/chunk?key=abc#secret-fragment',scope,['known-secret']);
 assert.equal(s.originChanges,true);assert.equal(s.sameLogicalAsset,null);assert.equal(s.referenceKind,'absolute');
 for(const v of ['password','known-secret','abc','secret-fragment'])assert.equal(JSON.stringify(s).includes(v),false);
 assert.equal(s.childFollowed,false);
});
function fixture(child,options={}){
 const calls=[],events=[];let payload;
 const run=()=>inspectScaleEnginePlaylist({environment:'development',cdnId:'123',apiSecret:'account-secret',capture:options.capture,resource:{id:'r',lifecycle:'active'},binding:{resourceId:'r',provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/a.mp4',playbackRef:master},observe:async e=>events.push(e)},async(url,o)=>{
  calls.push({url,o});assert.equal(o.redirect,'error');
  if(o.method==='PUT'){payload=JSON.parse(o.body);return Response.json({data:{key:'returned-key',pass:'returned-pass',app:payload.app,video:payload.video,active:true,expire_date:payload.expire_date}});}
  if(o.method==='DELETE')return new Response(null,{status:options.cleanupFails?500:200});
  assert.equal(new URL(url).searchParams.get('pass'),'returned-pass');assert.equal(o.headers,undefined);
  return new Response('#EXTM3U\n'+child+'\n');
 });return {run,calls,events,payload:()=>payload};
}
test('one ticket, one master GET, zero child requests and cleanup even for rejected child',async()=>{
 const f=fixture('https://unrelated.example/child?key=returned-key&pass=returned-pass');const result=await f.run();
 assert.equal(result.childFollowed,false);assert.equal(f.calls.length,3);assert.equal(f.calls.filter(c=>!c.o.method).length,1);assert.equal(f.payload().video,scope);assert.equal(f.payload().uses,5);assert.equal(f.payload().ip,'auto');assert.equal(f.events.at(-1).ticketRemoved,true);
 for(const v of ['returned-key','returned-pass','account-secret',f.payload().pass])assert.equal(JSON.stringify(f.events).includes(v),false);
});
test('guard-accepted child is also never followed during inspection',async()=>{
 const f=fixture('chunk.m3u8');await f.run();assert.equal(f.calls.length,3);assert.equal(f.events.find(e=>e.stage==='child-structure-captured').currentGuardRejects,false);
});
test('cleanup failure prevents a completed inspection result',async()=>{
 const f=fixture('chunk.m3u8',{cleanupFails:true});await assert.rejects(f.run(),e=>e.safeCategory==='ticket-cleanup-unconfirmed');assert.equal(f.events.at(-1).cleanupPending,true);
});
test('query summary counts repeated names without retaining any values',()=>{
 assert.deepEqual(playlistQueryNames(master,'chunk?key=hidden1&pass=hidden2&key=hidden3'),{parameterNames:['key','pass'],parameterCount:3,duplicateNamesPresent:true,duplicateParameterNames:['key']});
 assert.deepEqual(playlistQueryNames(master,'chunk'),{parameterNames:[],parameterCount:0,duplicateNamesPresent:false,duplicateParameterNames:[]});
});
test('unsafe names fail closed without echoing secret material',()=>{
 for(const child of ['chunk?secret-token=x','chunk?bad%20name=x'])assert.throws(()=>playlistQueryNames(master,child,['secret-token']),e=>e.safeCategory==='query-name-not-safe-to-record'&&!e.message.includes('secret-token'));
});
test('names-only inspection saves no URL structure or values and never follows child',async()=>{
 const f=fixture('child?key=returned-key&pass=returned-pass&session=private-session',{capture:'query-names'});
 const result=await f.run();assert.equal(result.queryNamesCaptured,true);assert.equal(f.calls.length,3);
 const event=f.events.find(e=>e.stage==='child-query-names-captured');assert.deepEqual(event.parameterNames,['key','pass','session']);assert.equal(event.parameterCount,3);assert.equal(event.duplicateNamesPresent,false);
 assert.equal(f.events.some(e=>e.stage==='child-structure-captured'),false);
 for(const secret of ['returned-key','returned-pass','private-session','account-secret'])assert.equal(JSON.stringify(f.events).includes(secret),false);
 assert.equal(f.events.at(-1).ticketRemoved,true);
});
