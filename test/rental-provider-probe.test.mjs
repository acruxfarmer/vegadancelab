import test from 'node:test';
import assert from 'node:assert/strict';
import {probeRentalProvider} from '../scripts/vod-rental-provider-probe.mjs';
const binding={provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/fixture.mp4',playbackRef:'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore1/acruxanalog/fixture.mp4/playlist.m3u8'};
function fixture(leaky=false){let clock=Date.now(),n=0;const tickets=new Map(),events=[];const fetcher=async(raw,options={})=>{const url=new URL(raw);if(url.hostname==='api.scaleengine.net'){
 if(options.method==='PUT'){const b=JSON.parse(options.body);assert.notEqual(b.video,'*');const key='private-key-'+(++n),t={key,pass:'private-password',expire:Date.parse(b.expire_date.replace(' ','T')+'Z'),active:true};tickets.set(key,t);return Response.json({data:t});}
 if(options.method==='DELETE'){const t=tickets.get(url.pathname.split('/').at(-1));if(t)t.active=false;return new Response(null,{status:204});}
 if(url.pathname.includes('sevu_attempt'))return Response.json({data:[{success:true,key:'private-key',ip:'private-ip'}]});throw Error('Unexpected API');
 }
 assert.equal(url.hostname,'acruxanalog-vod.secdn.net');const t=tickets.get(url.searchParams.get('key')),valid=t&&t.active&&clock<t.expire;
 if(!valid&&!(leaky&&url.pathname.endsWith('seg.ts')))return new Response(null,{status:403});
 if(url.pathname.endsWith('playlist.m3u8'))return new Response('#EXTM3U\nchild.m3u8\n');if(url.pathname.endsWith('child.m3u8'))return new Response('#EXTM3U\nseg.ts\n');const bytes=Buffer.alloc(376);bytes[0]=bytes[188]=0x47;return new Response(bytes);
 };return {fetcher,events,tickets,args:{binding,cdnId:'123',apiSecret:'private-secret',now:()=>clock,sleep:async ms=>{clock+=ms;},observe:async e=>events.push(e)}};}
test('provider verification distinguishes HTTP boundaries from playback and cleans every ticket',async()=>{const f=fixture(),r=await probeRentalProvider(f.args,f.fetcher);assert.equal(r.materialLimitation,false);assert.equal(r.checks.expiration.existingSegmentDenied,true);assert.equal(r.checks.revocation.existingSegmentDenied,true);assert.equal(r.checks.attemptLog.decodedPlaybackProven,false);assert.ok([...f.tickets.values()].every(t=>!t.active));assert.equal(f.tickets.size,2);assert.doesNotMatch(JSON.stringify({r,events:f.events}),/private-key|private-password|private-secret|private-ip/);});
test('continued segment delivery after revoke/expiry is reported as material limitation',async()=>{const f=fixture(true),r=await probeRentalProvider(f.args,f.fetcher);assert.equal(r.materialLimitation,true);assert.equal(r.checks.revocation.freshMediaReturned,true);assert.equal(r.checks.expiration.freshMediaReturned,true);assert.equal(r.runtimeRentalDeliveryEnabled,false);});
