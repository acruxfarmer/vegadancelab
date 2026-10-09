import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyHostedDelivery} from '../scripts/verify-l6-s8b-hosted-delivery.mjs';
const playback=name=>'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/'+name+'/playlist.m3u8';
function fixture(bStatus=403){
 const events=[],calls=[];
 const run=()=>verifyHostedDelivery({cdnId:'123',apiSecret:'secret',placementId:'p',binding:{provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/a.mp4',playbackRef:playback('a.mp4')},observe:async e=>events.push(e)},async(raw,o)=>{
  const u=new URL(raw);calls.push({u,o});assert.equal(o.redirect,'error');
  if(u.pathname==='/api/config')return Response.json({environment:'development',squareEnabled:false,externalEffects:'disabled',paymentMode:'disabled'});
  if(u.hostname==='acruxanalog-sestore.secdn.net')return Response.json({data:{name:'1.mp4',path:'1.mp4',type:'file',metadata:{invalid:0,deleted:0,duration:3},vod_url:playback('1.mp4')}});
  if(u.pathname==='/api/media/placements/p')return Response.json({decision:{allowed:true,reason:'public_access'}});
  if(u.pathname==='/api/media/placements/p/play')return Response.json({kind:'hls',inheritQuery:true,url:playback('a.mp4')+'?key=returned-key&pass=returned-pass',expiresAt:new Date(Date.now()+120000).toISOString()});
  if(o.method==='DELETE')return new Response(null,{status:200});
  assert.equal(o.headers,undefined);assert.equal(u.searchParams.get('pass'),'returned-pass');
  if(u.pathname.includes('/1.mp4/'))return new Response(null,{status:bStatus});
  if(u.pathname.endsWith('playlist.m3u8'))return new Response('#EXTM3U\nchunk.m3u8?key=returned-key&pass=returned-pass');
  if(u.pathname.endsWith('chunk.m3u8'))return new Response('#EXTM3U\nsegment.ts?key=returned-key&pass=returned-pass');
  const b=Buffer.alloc(376);b[0]=b[188]=0x47;return new Response(b);
 });return {run,events,calls};
}
test('hosted proof obtains exactly one ordinary grant and proves media plus same-ticket denial',async()=>{
 const f=fixture();assert.equal((await f.run()).assetBSameTicketDenied,true);
 assert.equal(f.calls.filter(c=>c.u.pathname==='/api/media/placements/p/play').length,1);
 assert.equal(f.calls.some(c=>c.o.method==='PUT'),false);assert.equal(f.events.at(-1).ticketRemoved,true);
 for(const s of ['returned-key','returned-pass','secret'])assert.equal(JSON.stringify(f.events).includes(s),false);
});
test('hosted isolation failure stops and deletes the same ordinary ticket',async()=>{
 const f=fixture(200);await assert.rejects(f.run(),e=>e.safeCategory==='isolation-failed');assert.equal(f.events.at(-1).ticketRemoved,true);
});
