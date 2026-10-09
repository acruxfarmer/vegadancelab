import {scopedPlaybackUrl} from '../public/native-player.js';
import {scaleEngineAssetScope} from '../src/runtime/providers/scaleengine-asset-scope.mjs';
import {resolveScaleEngineHlsReference} from '../src/runtime/providers/scaleengine-hls-reference.mjs';
const fail=category=>{const e=new Error('Hosted proof stopped');e.safeCategory=category;throw e;};
export async function verifyHostedDelivery({cdnId,apiSecret,binding,placementId,observe},fetcher=fetch){
 if(!/^\d+$/.test(cdnId)||!apiSecret||apiSecret.trim()!==apiSecret)fail('private-configuration');
 const a=scaleEngineAssetScope(binding),auth='Basic '+Buffer.from(cdnId+':'+apiSecret).toString('base64');
 const host='https://vega-development-web.onrender.com';let key;
 async function request(url,o={}){try{return await fetcher(url,{...o,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('transport-failed-no-retry');}}
 async function bytes(r){let size=0;const chunks=[];for await(const b of r.body){size+=b.length;if(size>2*1024*1024)fail('response-limit');chunks.push(b);}return Buffer.concat(chunks);}
 async function json(r){if(!r.ok){await r.body?.cancel();fail('http-failure');}try{return JSON.parse((await bytes(r)).toString());}catch{fail('json-invalid');}}
 const config=await json(await request(host+'/api/config'));
 if(config.environment!=='development'||config.squareEnabled!==false||config.externalEffects!=='disabled'||config.paymentMode!=='disabled')fail('development-safety');
 const fileResult=await json(await request('https://acruxanalog-sestore.secdn.net/v1/files/1.mp4?option:metadata=true',{headers:{Authorization:auth}}));
 const file=fileResult.data;
 if(fileResult.error||fileResult.errors?.length||file?.name!=='1.mp4'||!['1.mp4','/1.mp4'].includes(file.path)||file.type!=='file'||String(file.metadata?.invalid)!=='0'||String(file.metadata?.deleted)!=='0'||!(Number(file.metadata?.duration)>0))fail('asset-b-not-indexed');
 const b=scaleEngineAssetScope({...binding,assetRef:file.path,playbackRef:file.vod_url});if(b.video===a.video)fail('distinct-assets-required');
 const description=await json(await request(host+'/api/media/placements/'+placementId));
 if(description?.decision?.allowed!==true||description.decision.reason!=='public_access')fail('l6s2-denied');
 await observe({stage:'hosted-l6s2',allowed:true,reason:'public_access'});
 try{
  await observe({stage:'ordinary-play-request',ticketAttempts:1,cleanupPending:true});
  const grant=await json(await request(host+'/api/media/placements/'+placementId+'/play'));
  let u;try{u=new URL(grant.url);}catch{fail('grant-invalid');}
  key=u.searchParams.get('key');const pass=u.searchParams.get('pass');
  if(grant.kind!=='hls'||grant.inheritQuery!==true||!(Date.parse(grant.expiresAt)>Date.now())||!key||!pass||u.origin+u.pathname!==a.playbackRef||[...u.searchParams.keys()].sort().join(',')!=='key,pass')fail('grant-mapping-invalid');
  await observe({stage:'ordinary-grant',exactBindingMapping:true,credentialSource:'hosted-ordinary-adapter'});
  let playlists=0,media=false;
  for(let i=0;i<3;i++){
   resolveScaleEngineHlsReference(binding,u.href);
   const r=await request(scopedPlaybackUrl(u.href,grant));await observe({stage:'asset-a-playback',request:i+1,httpStatus:r.status});
   if(r.status!==200){await r.body?.cancel();fail('asset-a-playback-failed');}
   const data=await bytes(r),text=data.toString();
   if(text.trimStart().startsWith('#EXTM3U')){
    playlists++;await observe({stage:playlists===1?'master-confirmed':'child-confirmed',httpStatus:200});
    if(/#EXT-X-(KEY|MAP)/.test(text))fail('unsupported-playlist');
    const child=text.split(/\r?\n/).map(s=>s.trim()).find(s=>s&&!s.startsWith('#'));if(!child)fail('empty-playlist');
    resolveScaleEngineHlsReference(binding,child);u=new URL(scopedPlaybackUrl(new URL(child,u).href,grant));continue;
   }
   const ts=data.length>=376&&data[0]===0x47&&data[188]===0x47;
   if(!ts)fail('media-bytes-not-recognized');media=true;await observe({stage:'media-confirmed',httpStatus:200,mediaBytes:data.length,mediaType:'mpeg-ts'});break;
  }
  if(!media||playlists!==2)fail('master-child-media-not-proven');
  // Deliberate server-side negative control, outside the player's allowlist.
  const negative=new URL(b.playbackRef);negative.searchParams.set('key',key);negative.searchParams.set('pass',pass);
  const denied=await request(negative.href);await denied.body?.cancel();await observe({stage:'asset-b-same-ticket',httpStatus:denied.status});if(denied.status!==403)fail('isolation-failed');
  const still=await request(grant.url);const valid=still.status===200&&(await bytes(still)).toString().trimStart().startsWith('#EXTM3U');
  await observe({stage:'asset-a-still-valid',httpStatus:still.status,manifestConfirmed:valid});if(!valid)fail('denial-cause-ambiguous');
  return {hostedOrdinaryPath:true,l6s2:'public_access',master:true,child:true,media:true,assetBSameTicketDenied:true};
 }finally{
  if(key){try{const r=await request('https://api.scaleengine.net/v2/sevu_token/'+encodeURIComponent(key),{method:'DELETE',headers:{Authorization:auth}});await r.body?.cancel();const removed=r.ok||r.status===404;await observe({stage:'ticket-cleanup',httpStatus:r.status,ticketRemoved:removed,cleanupPending:!removed});if(!removed)fail('ticket-cleanup-failed');}catch{await observe({stage:'ticket-cleanup',cleanupPending:true});fail('ticket-cleanup-failed');}}
 }
}
