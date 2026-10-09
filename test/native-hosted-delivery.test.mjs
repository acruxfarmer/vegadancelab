import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeMediaDelivery} from '../src/runtime/native-media-delivery.mjs';
import {createScaleEngineDelivery} from '../src/runtime/providers/scaleengine-delivery.mjs';
import {scopedPlaybackUrl} from '../public/native-player.js';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {createMediaOwnerManagement} from '../src/runtime/media-owner-management.mjs';
const binding={id:'b',resourceId:'r',provider:'scaleengine',integrationRef:'development-media',state:'ready',revision:4,assetRef:'/file.mp4',playbackRef:'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/file.mp4/playlist.m3u8'};
function fixture(){
 const material={resource:{id:'r',lifecycle:'active',title:'Native',creator:'Owner'},binding:{...binding},placement:{resourceId:'r',authorized:true,visible:true,context:{kind:'business',tenantId:'t',businessId:'b'},policy:{kind:'public'}}};
 let calls=0;const queries=[];
 const pool={connect:async()=>({release(){},query:async(sql)=>{queries.push(sql);return {rows:sql.includes('native_viewer_material')?[{material}]:[]};}})};
 const store=createNativeMediaDelivery(pool,{adapters:{scaleengine:{authorize:async()=>{calls++;return {kind:'hls',url:'short-lived-secret'};}}}});
 return {material,queries,store,calls:()=>calls};
}
test('ready native ALL uses L6-S2; description creates no ticket and exposes no binding',async()=>{
 const f=fixture(),before=structuredClone(f.material);const description=await f.store.resolve(null,'p');assert.equal(description.decision.reason,'public_access');assert.equal(f.calls(),0);assert.equal(JSON.stringify(description).includes('playbackRef'),false);
 assert.equal((await f.store.resolve(null,'p',true)).kind,'hls');assert.equal(f.calls(),1);assert.deepEqual(f.material,before);assert.ok(f.queries.every(q=>!/^update|insert|delete/.test(q)));
});
test('non-ready, hidden, withdrawn and denied placements never create native tickets',async()=>{
 for(const state of ['pending','uploading','uploaded','indexed','processing','failed']){const f=fixture();f.material.binding.state=state;await assert.rejects(f.store.resolve(null,'p',true));assert.equal(f.calls(),0);}
 for(const field of ['visible','authorized']){const f=fixture();f.material.placement[field]=false;await assert.rejects(f.store.resolve(null,'p',true));assert.equal(f.calls(),0);}
 const f=fixture();f.material.placement.policy={kind:'pay_on_demand'};await assert.rejects(f.store.resolve(null,'p',true));assert.equal(f.calls(),0);
});
test('provider adapter returns only bounded HLS authorization with provider-returned password',async()=>{
 let payload;const a=createScaleEngineDelivery({environment:'development',cdnId:'123',apiSecret:'account-secret'},async(url,o)=>{payload=JSON.parse(o.body);return Response.json({data:{key:'returned-key',pass:'returned-pass'}});});
 const result=await a.authorize(binding),u=new URL(result.url);assert.equal(u.searchParams.get('pass'),'returned-pass');assert.notEqual(payload.pass,'returned-pass');assert.equal(payload.ip,'auto');assert.equal(payload.uses,5);assert.equal(payload.video,'*');assert.equal(u.searchParams.get('key'),'returned-key');assert.equal(JSON.stringify(result).includes('account-secret'),false);assert.deepEqual(Object.keys(result).sort(),['expiresAt','inheritQuery','kind','url']);
});
test('generic HLS query propagation cannot send ticket outside authorized asset directory',()=>{
 const grant={url:binding.playbackRef+'?key=short&pass=secret',inheritQuery:true};
 assert.ok(scopedPlaybackUrl('segment.ts',grant).endsWith('segment.ts?key=short&pass=secret'));
 for(const u of ['https://other.example/segment.ts','../other.mp4/chunk.ts'])assert.throws(()=>scopedPlaybackUrl(u,grant));
});

test('same HTTP placement route preserves legacy bytes and serves noncached native authorization',async()=>{
 const f=fixture();let legacy=false;
 const bytes=Buffer.from('legacy-mp4');
 const api=createApplicationApi({}, {mediaPlacementPlayback:(v,p)=>legacy?bytes:f.store.resolve(v,p,true)});
 async function request(){const req=Readable.from([]);Object.assign(req,{url:'/api/media/placements/22222222-2222-4222-8222-222222222222/play',method:'GET',headers:{}});let status,headers,body;await api(req,{writeHead:(s,h)=>{status=s;headers=h;},end:b=>body=b});return {status,headers,body};}
 const native=await request();assert.equal(native.status,200);assert.equal(native.headers['Content-Type'],'application/json');assert.equal(native.headers['Cache-Control'],'no-store');assert.equal(JSON.parse(native.body).kind,'hls');
 f.material.placement.authorized=false;assert.equal((await request()).status,403);assert.equal(f.calls(),1);
 legacy=true;const old=await request();assert.equal(old.headers['Content-Type'],'video/mp4');assert.deepEqual(old.body,bytes);
});

test('owner readiness reload reads persisted generic binding state without exposing provider binding',async()=>{
 const owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';let state='processing';
 const resource={id:'r',owner:{kind:'user',userId:owner},title:'Native',source:{kind:'managed_reference',provider:'native',reference:'canonical'},lifecycle:'active'};
 const manage=createMediaOwnerManagement({connect:async()=>({release(){},async query(sql){if(sql.startsWith('select document from media_private.resources'))return {rows:[{document:resource}]};if(sql.includes('from media_private.provider_bindings'))return {rows:[{state}]};return {rows:[]};}})});
 assert.deepEqual((await manage(owner)).items[0].delivery,{state:'processing'});state='ready';
 for(let n=0;n<2;n++){const result=await manage(owner);assert.deepEqual(result.items[0].delivery,{state:'ready'});assert.equal(JSON.stringify(result).includes('scaleengine'),false);assert.equal(JSON.stringify(result).includes('playbackRef'),false);}
});
