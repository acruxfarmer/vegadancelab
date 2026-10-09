import test from 'node:test';
import assert from 'node:assert/strict';
import {createScaleEngineDelivery} from '../src/runtime/providers/scaleengine-delivery.mjs';
const binding={provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/a.mp4',playbackRef:'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/a.mp4/playlist.m3u8'};
const ticket={key:'private-ticket',attemptId:'attempt',issuedAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-01T00:02:00Z'};
const row={id:1,key:ticket.key,app:'acruxanalog-vod',video:'sestore99/acruxanalog/a.mp4',success:true,datetime:'2026-01-01 00:00:01',pass:'private-pass',ip:'private-address'};
const adapter=(data)=>createScaleEngineDelivery({environment:'development',cdnId:'1',apiSecret:'test'},async(url,options)=>{assert.ok(url.endsWith('/sevu_attempt/private-ticket'));assert.equal(options.redirect,'error');return Response.json({data});});
test('provider observation requires exact ticket, asset, application, attempt and issuance interval',async()=>{
 const a=adapter([row]),e=await a.observePlayback(ticket,'attempt',binding);
 assert.equal(e.kind,'provider_authorization_plus_player_ack');assert.match(e.reference,/^sevu-attempt-sha256:[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(e).includes('private-pass'),false);assert.equal(JSON.stringify(e).includes('private-address'),false);
 assert.equal(a.rentalCapabilities.rentalAccessVerified,false);
 assert.equal(await a.observePlayback(ticket,'other',binding),null);
 for(const change of [{key:'other'},{video:'other.mp4'},{app:'other'},{success:false},{datetime:'2025-12-31 23:59:59'},{datetime:'2026-01-01 00:02:01'}])assert.equal(await adapter([{...row,...change}]).observePlayback(ticket,'attempt',binding),null);
});
test('empty evidence and browser-only failures stay unresolved',async()=>{
 const a=adapter([]);assert.equal(await a.observePlayback(ticket,'attempt',binding),null);assert.equal(await a.observeStartupFailure([ticket],'attempt'),null);
});
