import {randomBytes} from 'node:crypto';
import {scaleEngineAssetScope} from './scaleengine-asset-scope.mjs';
import {resolveScaleEngineHlsReference} from './scaleengine-hls-reference.mjs';
import {requireReadyMediaBinding} from '../../media-provider-binding.mjs';

const fail=category=>{const e=new Error('Bounded isolation proof stopped');e.safeCategory=category;throw e;};
// Explicit Development utility. No broad ticket, upload, binding mutation or payment.
export async function proveScaleEngineExactScope({environment,cdnId,apiSecret,resource,binding,otherFile,observe=async()=>{}},fetcher=fetch){
 if(environment!=='development'||!/^\d+$/.test(cdnId)||typeof apiSecret!=='string'||!apiSecret||apiSecret.trim()!==apiSecret)fail('development-configuration-required');
 requireReadyMediaBinding(resource,binding);
 const a=scaleEngineAssetScope(binding);
 if(!/^[A-Za-z0-9_.-]+\.mp4$/.test(otherFile)||otherFile===binding.assetRef.split('/').at(-1))fail('distinct-existing-file-required');
 const auth='Basic '+Buffer.from(cdnId+':'+apiSecret,'utf8').toString('base64');
 const api='https://api.scaleengine.net/v2/sevu_token';
 async function request(url,options={}){try{return await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('transport-failure-no-retry');}}
 async function json(r){
  if(!r.ok){await r.body?.cancel();fail('provider-metadata-http-failure');}
  const bytes=await boundedBytes(r);let b;try{b=JSON.parse(bytes.toString('utf8'));}catch{fail('provider-json-invalid');}
  if(b?.error||(b?.errors&&(!Array.isArray(b.errors)||b.errors.length))||!b?.data)fail('provider-response-unrecognized');return b.data;
 }
 async function boundedBytes(r){const chunks=[];let n=0;for await(const chunk of r.body){n+=chunk.length;if(n>2*1024*1024)fail('response-bound-exceeded');chunks.push(chunk);}return Buffer.concat(chunks);}
 async function inspect(name){
  const f=await json(await request('https://acruxanalog-sestore.secdn.net/v1/files/'+encodeURIComponent(name)+'?option:metadata=true',{headers:{Authorization:auth}}));
  if(f.name!==name||![name,'/'+name].includes(f.path)||!['','/','.'].includes(f.parent)||f.type!=='file'||!(Number(f.size)>0)||String(f.metadata?.deleted)!=='0'||String(f.metadata?.invalid)!=='0'||!(Number(f.metadata?.duration)>0))fail('existing-indexed-file-not-proven');
  return scaleEngineAssetScope({provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:f.path,playbackRef:f.vod_url});
 }
 const currentA=await inspect(binding.assetRef.split('/').at(-1));
 if(currentA.playbackRef!==a.playbackRef)fail('canonical-provider-mapping-changed');
 const b=await inspect(otherFile);
 if(a.video===b.video)fail('distinct-provider-assets-required');
 await observe({stage:'mapping-confirmed',assetAScope:a.video,assetBScope:b.video,existingIndexedAssets:true});
 const baseline=await request(b.playbackRef);await baseline.body?.cancel();
 await observe({stage:'asset-b-no-ticket',httpStatus:baseline.status});
 if(baseline.status!==403)fail('asset-b-protection-not-proven');
 let ticket,createAttempted=false;
 const expiresAt=new Date(Date.now()+120000).toISOString();
 const signed=raw=>{const u=new URL(raw);u.searchParams.set('key',ticket.key);u.searchParams.set('pass',ticket.pass);return u.href;};
 try{
  await observe({stage:'ticket-create',ticketAttempts:1,app:a.app,video:a.video,ip:'auto',uses:5,expiresAt,passwordSource:'provider-returned',cleanupPending:true});
  createAttempted=true;
  ticket=await json(await request(api,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({app:a.app,video:a.video,pass:randomBytes(24).toString('hex'),ip:'auto',uses:5,active:true,expire_date:expiresAt.replace('T',' ').slice(0,19)})}));
  const expiry=typeof ticket.expire_date==='string'?Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ticket.expire_date)?ticket.expire_date.replace(' ','T')+'Z':ticket.expire_date):NaN;
  if(typeof ticket.key!=='string'||!ticket.key.trim()||typeof ticket.pass!=='string'||!ticket.pass.trim()||ticket.app!==a.app||ticket.video!==a.video||![true,1,'1'].includes(ticket.active)||!(expiry>Date.now()))fail('returned-ticket-invariants-failed');
  const base=new URL(a.playbackRef);
  let u=base,media=false,playlists=0;
  for(let i=0;i<3;i++){
   try{resolveScaleEngineHlsReference(binding,u.href);}catch{fail('playlist-reference-outside-asset');}
   const r=await request(signed(u.href));await observe({stage:'asset-a-playback',request:i+1,httpStatus:r.status});
   if(r.status!==200){await r.body?.cancel();fail('asset-a-playback-failed');}
   const bytes=await boundedBytes(r),text=bytes.toString('utf8');
   if(text.trimStart().startsWith('#EXTM3U')){
    playlists++;await observe({stage:playlists===1?'asset-a-master-confirmed':'asset-a-child-playlist-confirmed',httpStatus:200});
    if(/#EXT-X-(KEY|MAP)/.test(text))fail('unsupported-playlist');
    const child=text.split(/\r?\n/).map(x=>x.trim()).find(x=>x&&!x.startsWith('#'));if(!child)fail('empty-playlist');
    // Check the literal child before URL normalization can erase traversal.
    try{resolveScaleEngineHlsReference(binding,child);u=resolveScaleEngineHlsReference(binding,new URL(child,u).href);}catch{fail('playlist-reference-outside-asset');}continue;
   }
   const ts=bytes.length>=376&&bytes[0]===0x47&&bytes[188]===0x47;
   const mp4=bytes.length>12&&['ftyp','styp'].includes(bytes.toString('ascii',4,8));
   if(!ts&&!mp4)fail('actual-media-bytes-not-proven');
   media=true;await observe({stage:'asset-a-media-confirmed',httpStatus:200,mediaBytes:bytes.length,mediaType:ts?'mpeg-ts':'mp4'});break;
  }
  if(!media||playlists!==2)fail('master-child-media-chain-not-proven');
  const denied=await request(signed(b.playbackRef));await denied.body?.cancel();
  await observe({stage:'asset-b-same-ticket',httpStatus:denied.status,sameReturnedTicket:true});
  if(denied.status!==403)fail('asset-b-isolation-failed');
  // Prove B's denial was not caused by expiration, IP drift or an exhausted ticket.
  const live=await request(signed(a.playbackRef));const bytes=await boundedBytes(live);
  const stillValid=live.status===200&&bytes.toString('utf8').trimStart().startsWith('#EXTM3U');
  await observe({stage:'asset-a-ticket-still-valid',httpStatus:live.status,manifestConfirmed:stillValid});
  if(!stillValid)fail('asset-b-denial-cause-ambiguous');
  return {assetAPlayback:true,masterPlaylistConfirmed:true,childPlaylistConfirmed:true,assetBDenied:true,sameTicket:true,stillValidAfterDenial:true};
 }finally{
  if(typeof ticket?.key==='string'&&ticket.key){
   try{const r=await request(api+'/'+encodeURIComponent(ticket.key),{method:'DELETE',headers:{Authorization:auth}});await r.body?.cancel();const removed=r.ok||r.status===404;await observe({stage:'ticket-cleanup',httpStatus:r.status,ticketRemoved:removed,cleanupPending:!removed});if(!removed)fail('ticket-cleanup-unconfirmed');}
   catch{await observe({stage:'ticket-cleanup',cleanupPending:true});fail('ticket-cleanup-unconfirmed');}
  }else if(createAttempted)await observe({stage:'ticket-cleanup',cleanupPending:true,shortExpirationRequested:true});
 }
}
