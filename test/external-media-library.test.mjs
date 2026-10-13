import test from 'node:test';
import assert from 'node:assert/strict';
import {externalMediaId,externalPage,externalPolicy,providerItem,externalPresentation} from '../src/external-media.mjs';
import {cachedSource,externalMetadata,createExternalMediaLibrary,startExternalMetadataExpiry} from '../src/runtime/external-media-library.mjs';
import {editMediaResource} from '../src/media-resource.mjs';
import {filterMedia} from '../public/media-library.js';
import {createYouTubeConnectionAdapter} from '../src/runtime/providers/external-media-youtube.mjs';
import {createVimeoConnectionAdapter} from '../src/runtime/providers/external-media-vimeo.mjs';
import {createMediaConnectionWorkflow} from '../src/runtime/media-connection-workflow.mjs';
import {createMediaConnectionSecrets} from '../src/runtime/media-connection-secrets.mjs';
import {handleExternalMediaApi} from '../src/runtime/external-media-api.mjs';
const video={id:'abcdefghijk',snippet:{title:'Source title',channelId:'channel',channelTitle:'Creator',liveBroadcastContent:'none'},status:{privacyStatus:'public',embeddable:true,uploadStatus:'processed'}};
const credentials={accessToken:'private-token',scopes:['https://www.googleapis.com/auth/youtube.readonly'],expiresAt:'2099-01-01T00:00:00Z'};
const config={clientId:'client',clientSecret:'secret',redirectUri:'https://vega-development-web.onrender.com/api/media-connections/youtube/callback'};
const json=x=>new Response(JSON.stringify(x));
test('retention starts without provider configuration or library access, repeats and stops cleanly',async()=>{
 const calls=[];let tick,cancelled=false;
 const expiry=startExternalMetadataExpiry({async query(sql){calls.push(sql);return {rows:[{available:true}]};}},{schedule(fn,ms){assert.equal(ms,3600000);tick=fn;return 1;},cancel(){cancelled=true;}});
 await expiry.ready;assert.equal(calls.length,2);tick();await expiry.stop();assert.equal(calls.length,3);assert.equal(cancelled,true);
 assert.ok(calls.slice(1).every(sql=>sql==='select media_private.expire_external_metadata()'));
 let scheduled=false;const absent=startExternalMetadataExpiry({query:async()=>({rows:[{available:false}]})},{schedule(){scheduled=true;}});await absent.ready;await absent.stop();assert.equal(scheduled,false);
});
test('retention initialization fails closed and periodic failures expose only a fixed category',async()=>{
 let calls=0,tick,failures=0;
 const expiry=startExternalMetadataExpiry({async query(){if(++calls===1)return {rows:[{available:true}]};if(calls>2)throw Error('private database details');return {rows:[]};}},{schedule(fn){tick=fn;},onError(){failures++;}});
 await expiry.ready;tick();await expiry.stop();assert.equal(failures,1);
 const failed=startExternalMetadataExpiry({query:async()=>{throw Error('offline');}});await assert.rejects(failed.ready,/offline/);await failed.stop();
});
test('external identities cannot inject a host, query, path or embed HTML',()=>{
 for(const value of ['https://evil.test','../123','123?token=secret','<iframe>'])for(const p of ['youtube','vimeo'])assert.throws(()=>externalMediaId(p,value));
 assert.throws(()=>externalPage('vimeo','https://evil.test'));assert.throws(()=>externalPage('youtube','a&token=secret'));
 assert.equal(externalPresentation('youtube',video.id).url,'https://www.youtube.com/embed/abcdefghijk');
 for(const policy of [{kind:'pay_on_demand'},{kind:'rental'},{}])assert.throws(()=>externalPolicy(policy));
});
test('discovery metadata is not a promise of universal playability',()=>{
 assert.equal(providerItem('youtube',video,'channel').eligible,true);
 for(const changes of [{status:{...video.status,embeddable:false}},{status:{...video.status,privacyStatus:'private'}},{contentDetails:{regionRestriction:{blocked:['US']}}},{snippet:{...video.snippet,liveBroadcastContent:'live'}}])assert.equal(providerItem('youtube',{...video,...changes},'channel').eligible,false);
 assert.throws(()=>providerItem('youtube',video,'another-channel'));
 const v={uri:'/videos/123',name:'Video',user:{uri:'/users/1',name:'Creator'},status:'available',privacy:{view:'anybody',embed:'public'}};
 assert.equal(providerItem('vimeo',v,'/users/1').eligible,true);
 assert.equal(providerItem('vimeo',{...v,privacy:{view:'anybody',embed:'whitelist'}},'/users/1').eligible,false);
});
test('YouTube discovery is bounded, validates account and preserves pagination as an opaque token',async()=>{
 const calls=[],replies=[{items:[{id:'channel',contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]},{items:[{contentDetails:{videoId:video.id}}],nextPageToken:'next_page'},{items:[video]}];
 const adapter=createYouTubeConnectionAdapter({...config,fetcher:async(url,options)=>{calls.push({url,options});return json(replies.shift());}});
 const result=await adapter.discover(credentials,'channel');assert.equal(calls.length,3);assert.match(calls[1].url,/maxResults=12/);assert.equal(result.nextPage,'next_page');assert.equal(result.items[0].eligible,true);assert.doesNotMatch(JSON.stringify(result),/private-token|secret/);
 assert.ok(calls.every(c=>c.options.redirect==='error'));
 const wrong=createYouTubeConnectionAdapter({...config,fetcher:async()=>json({items:[{id:'other'}]})});await assert.rejects(wrong.discover(credentials,'channel'));
});
test('Vimeo pagination never follows remote next URLs and missing media is distinguished from transient error',async()=>{
 let path;const adapter=createVimeoConnectionAdapter({...config,redirectUri:config.redirectUri.replace('youtube','vimeo'),fetcher:async url=>{path=url;return json({data:[],paging:{next:'https://evil.test/steal'}});}});
 assert.equal((await adapter.discover(credentials,'/users/1','2')).nextPage,'3');assert.match(path,/page=2/);
 const missing=createVimeoConnectionAdapter({...config,redirectUri:config.redirectUri.replace('youtube','vimeo'),fetcher:async()=>new Response('',{status:404})});assert.equal((await missing.media(credentials,'/users/1','123')).status,'unavailable');
 const outage=createVimeoConnectionAdapter({...config,redirectUri:config.redirectUri.replace('youtube','vimeo'),fetcher:async()=>new Response('',{status:503})});await assert.rejects(outage.media(credentials,'/users/1','123'));
});
test('expiry removes provider defaults from projections without changing owner text or resource identity',()=>{
 const resource={id:'stable',title:'External video',creator:'',externalLibrary:true,lifecycle:'active',source:{provider:'youtube'},revision:1};const row={metadata:{title:'Provider title',creator:'Provider creator',eligible:true,status:'eligible'},expires_at:new Date(1000).toISOString()};
 assert.equal(externalMetadata(resource,cachedSource(row,999)).title,'Provider title');assert.equal(cachedSource(row,1000),null);
 const edited=editMediaResource(resource,1,{title:'Business title',creator:'Business attribution'});
 assert.equal(externalMetadata(edited,row.metadata).title,'Business title');assert.equal(externalMetadata(edited,null).title,'Business title');assert.equal(edited.id,'stable');assert.equal(resource.title,'External video');
});
test('existing category and collection filters compose with mixed source filtering',()=>{
 const rows=['youtube','vimeo','native'].map((sourceProvider,i)=>({id:String(i),title:'Practice',sourceProvider,categoryIds:['category'],collectionIds:['mixed']}));
 assert.equal(filterMedia(rows,{collection:'mixed'}).length,3);assert.deepEqual(filterMedia(rows,{category:'category',collection:'mixed',source:'vimeo'}).map(x=>x.sourceProvider),['vimeo']);
});
test('connection authority is checked before credential decryption or provider reads; errors stay fixed and safe',async()=>{
 let reads=0,opens=0,deny=true;const identity={userId:'u',tenantId:'t',businessId:'b'},secrets=createMediaConnectionSecrets('ab'.repeat(32));
 const row={...identity,provider:'youtube',status:'connected',accountId:'channel',revision:1,sealedCredentials:secrets.seal(credentials,{...identity,provider:'youtube',purpose:'credentials'})};
 const repository={async transaction(identity,provider,fn){if(deny)throw Error('denied');return (await fn(row)).value;}};
 const workflow=createMediaConnectionWorkflow({repository,secrets:{...secrets,open(...args){opens++;return secrets.open(...args);}},adapters:{youtube:{requestedScopes:credentials.scopes,async discover(){reads++;throw Error('token=private-token');}}}});
 await assert.rejects(workflow.libraryRead(identity,'youtube','discover',''));assert.equal(opens,0);assert.equal(reads,0);
 deny=false;await assert.rejects(workflow.libraryRead(identity,'youtube','discover',''),e=>e.message==='Source read unavailable: connection_verification_failed');assert.equal(reads,1);
});
test('HTTP external management requires a scoped verified principal and rejects forged metadata',async()=>{
 let calls=0;const base={service:{register:async()=>{calls++;}},readJson:async()=>({id:video.id,title:'forged'}),send(){}};
 const req={url:'/api/external-media/youtube/register',method:'POST',headers:{}};
 await assert.rejects(handleExternalMediaApi(req,{...base,principal:async()=>null}));
 await assert.rejects(handleExternalMediaApi(req,{...base,principal:async()=>({userId:'u',tenantId:'t',businessId:'b'})}));assert.equal(calls,0);
});
test('member and foreign business refresh/preview fail before provider access',async()=>{
 let calls=0;const pool={connect:async()=>({release(){},async query(sql){if(sql.includes('select m.role'))return {rows:[]};return {rows:[]};}})};
 const library=createExternalMediaLibrary(pool,{connections:{workflow:{libraryRead(){calls++;}}}}),identity={userId:'11111111-1111-4111-8111-111111111111',tenantId:'foreign',businessId:'foreign'};
 await assert.rejects(library.refresh(identity,'22222222-2222-4222-8222-222222222222',1),/Business media management/);
 await assert.rejects(library.preview(identity,'22222222-2222-4222-8222-222222222222'),/Business media management/);assert.equal(calls,0);
});
function libraryFixture(){
 const identity={userId:'11111111-1111-4111-8111-111111111111',tenantId:'test',businessId:'studio'};
 const state={staffRoleAssignments:[{...identity,role:'owner'}]},records={resource:null,placement:null,cache:null,audits:[],reads:0,offline:false};
 const c={release(){},async query(sql,args=[]){
  if(sql.includes('select m.role'))return {rows:[{role:'staff',state}]};
  if(sql.startsWith('select role,participant_ids'))return {rows:[{role:'staff',participant_ids:[]}]};
  if(sql.startsWith('select state from'))return {rows:[{state}]};
  if(sql.startsWith('select document from media_private.source_connections'))return {rows:[{document:{status:'connected',accountId:'channel',sealedCredentials:'sealed'}}]};
  if(sql.startsWith('select r.document as resource,e.*'))return {rows:records.cache?[{resource:records.resource,...records.cache}]:[]};
  if(sql.startsWith('select * from media_private.external_media_cache'))return {rows:records.cache?[records.cache]:[]};
  if(sql.startsWith('select document from media_private.resources'))return {rows:records.resource?[{document:records.resource}]:[]};
  if(sql.startsWith('select document from media_private.placements'))return {rows:records.placement?[{document:records.placement}]:[]};
  if(sql.startsWith('insert into media_private.resources'))records.resource=JSON.parse(args[5]);
  if(sql.startsWith('insert into media_private.placements'))records.placement=JSON.parse(args[5]);
  if(sql.startsWith('insert into media_private.external_media_cache'))records.cache={resource_id:args[0],tenant_id:args[1],business_id:args[2],provider:args[3],media_id:args[4],account_id:args[5],metadata:args[6],expires_at:args[7],revision:1};
  if(sql.startsWith('update media_private.external_media_cache'))Object.assign(records.cache,{metadata:args[1],expires_at:args[2],revision:records.cache.revision+1});
  if(sql.startsWith('insert into media_private.')&&sql.includes('_audit'))records.audits.push(sql);
  return {rows:[]};
 }};
 const library=createExternalMediaLibrary({connect:async()=>c},{connections:{workflow:{async libraryRead(){records.reads++;if(records.offline)throw Error('Source temporarily unavailable');return {accountId:'channel',data:providerItem('youtube',video,'channel')};}}}});
 return {identity,records,library};
}
test('registration reuses canonical resource and placement services, remains hidden and is idempotent',async()=>{
 const f=libraryFixture(),first=await f.library.register(f.identity,'youtube',video.id),second=await f.library.register(f.identity,'youtube',video.id);
 assert.equal(first.hidden,true);assert.equal(first.resourceId,second.resourceId);assert.equal(second.alreadyRegistered,true);assert.equal(f.records.placement.visible,false);assert.equal(f.records.resource.owner.businessId,'studio');assert.equal(f.records.resource.source.reference,video.id);
 assert.equal(f.records.resource.title,'External video');assert.equal(f.records.cache.metadata.title,'Source title');assert.equal(f.records.audits.length,2);
});
test('manual refresh preserves canonical edits and placement organization; transient failure and stale revision do not overwrite',async()=>{
 const f=libraryFixture();await f.library.register(f.identity,'youtube',video.id);
 f.records.resource=editMediaResource(f.records.resource,1,{title:'Owner title',creator:'Owner attribution'});Object.assign(f.records.placement,{visible:true,categoryIds:['category'],collectionIds:['mixed']});
 const before=structuredClone({resource:f.records.resource,placement:f.records.placement});
 await f.library.refresh(f.identity,f.records.resource.id,1);assert.equal(f.records.cache.revision,2);assert.deepEqual({resource:f.records.resource,placement:f.records.placement},before);
 const cached=structuredClone(f.records.cache),reads=f.records.reads;await assert.rejects(f.library.refresh(f.identity,f.records.resource.id,1),/Source changed/);assert.equal(f.records.reads,reads);
 f.records.offline=true;await assert.rejects(f.library.refresh(f.identity,f.records.resource.id,2),/temporarily/);assert.deepEqual(f.records.cache,cached);assert.deepEqual({resource:f.records.resource,placement:f.records.placement},before);
});
test('external viewer uses the canonical denial before exposing metadata or embed identity',async()=>{
 const resource={id:'resource',lifecycle:'active',title:'External video',source:{provider:'youtube',reference:video.id}};
 const placement={id:'placement',resourceId:'resource',context:{kind:'business',tenantId:'test',businessId:'studio'},visible:true,authorized:true,policy:{kind:'memberships',productIds:['member']}};
 const cache={metadata:providerItem('youtube',video,'channel'),expires_at:'2099-01-01T00:00:00Z'};
 const pool={connect:async()=>({release(){},query:async sql=>({rows:sql.includes('external_viewer_material')?[{material:{resource,placement,cache}}]:[]})})};
 const library=createExternalMediaLibrary(pool);
 let result=await library.resolve(null,'placement');assert.equal(result.decision.allowed,false);assert.equal(result.metadata,undefined);await assert.rejects(library.resolve(null,'placement',true));
 placement.policy={kind:'public'};result=await library.resolve(null,'placement');assert.equal(result.decision.allowed,true);assert.equal((await library.resolve(null,'placement',true)).provider,'youtube');
 cache.expires_at='2000-01-01T00:00:00Z';result=await library.resolve(null,'placement');assert.equal(result.decision.reason,'resource_unavailable');assert.equal(result.metadata.title,'External video');await assert.rejects(library.resolve(null,'placement',true));
 placement.policy={kind:'pay_on_demand'};assert.equal((await library.resolve(null,'placement')).metadata,undefined);
});
