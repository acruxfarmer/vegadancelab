// Development probe of the existing exact-asset SEVU adapter. Not an app feature flag.
import {createScaleEngineDelivery} from '../src/runtime/providers/scaleengine-delivery.mjs';
import {scaleEngineAssetScope} from '../src/runtime/providers/scaleengine-asset-scope.mjs';
import {resolveScaleEngineHlsReference} from '../src/runtime/providers/scaleengine-hls-reference.mjs';
const stop=category=>{const e=Error('Protected provider verification stopped');e.safeCategory=category;throw e;};
export async function probeRentalProvider({binding,cdnId,apiSecret,observe=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now},fetcher=fetch){
 const scope=scaleEngineAssetScope(binding),adapter=createScaleEngineDelivery({environment:'development',cdnId,apiSecret},fetcher),auth='Basic '+Buffer.from(cdnId+':'+apiSecret).toString('base64');
 const tickets=[];let issuanceAttempts=0;
 const result={runtimeRentalDeliveryEnabled:false,checks:{},limitations:['HTTP delivery observations do not prove decoded primary playback or physical device identity.','Already-buffered media cannot be recalled. Browser continuity, replay and grace still require hosted player verification.']};
 async function get(url){const r=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});const chunks=[];let n=0;for await(const chunk of r.body||[]){n+=chunk.length;if(n>2*1024*1024)stop('response-bound-exceeded');chunks.push(chunk);}return {status:r.status,bytes:Buffer.concat(chunks)};}
 const denied=x=>[401,403,404,410].includes(x.status);
 const media=x=>x.status===200&&((x.bytes.length>=376&&x.bytes[0]===0x47&&x.bytes[188]===0x47)||(x.bytes.length>12&&['ftyp','styp'].includes(x.bytes.toString('ascii',4,8))));
 async function chain(source){let url=new URL(source.url);for(let i=0;i<3;i++){
  resolveScaleEngineHlsReference(binding,url.href);const r=await get(url.href);if(r.status!==200)stop('protected-chain-request-denied');
  const text=r.bytes.toString('utf8');if(!text.trimStart().startsWith('#EXTM3U')){if(!media(r))stop('media-bytes-unrecognized');return {url:url.href,mediaBytes:r.bytes.length};}
  if(/#EXT-X-(KEY|MAP)/.test(text))stop('unsupported-playlist-format');const child=text.split(/\r?\n/).map(s=>s.trim()).find(s=>s&&!s.startsWith('#'));if(!child)stop('empty-playlist');resolveScaleEngineHlsReference(binding,child);url=resolveScaleEngineHlsReference(binding,new URL(child,url).href);const src=new URL(source.url);for(const key of ['key','pass'])url.searchParams.set(key,src.searchParams.get(key));
 }stop('playlist-depth-exceeded');}
 async function issue(){issuanceAttempts++;await observe({stage:'ticket-issuance',issuanceAttempts,cleanupPending:true});const source=await adapter.authorize(binding);const key=new URL(source.url).searchParams.get('key');if(!key)stop('missing-returned-ticket');tickets.push({key,source,removed:false});return tickets.at(-1);}
 async function attempts(t){const r=await get('https://api.scaleengine.net/v2/sevu_attempt/'+encodeURIComponent(t.key));return r;}
 try{
  const unsigned=await get(scope.playbackRef);result.checks.unsignedDenied=denied(unsigned);await observe({stage:'unsigned-baseline',httpStatus:unsigned.status});if(!result.checks.unsignedDenied)stop('unsigned-delivery-not-denied');
  const first=await issue(),one=await chain(first.source);result.checks.protectedMediaBytes=one.mediaBytes;await observe({stage:'protected-media-confirmed',mediaBytes:one.mediaBytes});
  const response=await fetcher('https://api.scaleengine.net/v2/sevu_attempt/'+encodeURIComponent(first.key),{headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(15000)});let records=[];if(response.ok){const body=await response.json();records=Array.isArray(body.data)?body.data:body.data?[body.data]:[];}else await response.body?.cancel();
  result.checks.attemptLog={httpStatus:response.status,records:records.length,authorizationAllowedObserved:records.some(x=>[true,1,'1'].includes(x.success)),decodedPlaybackProven:false};
  const renewal=await issue();const two=await chain(renewal.source);result.checks.separateTicketRenewalMediaBytes=two.mediaBytes;
  const reconnect=await get(renewal.source.url);result.checks.sameTicketReconnectManifest=reconnect.status===200&&reconnect.bytes.toString('utf8').trimStart().startsWith('#EXTM3U');
  await adapter.revoke(renewal);renewal.removed=true;await observe({stage:'targeted-ticket-revoked',waitingSeconds:6});await sleep(6000);
  const revokedManifest=await get(renewal.source.url),revokedSegment=await get(two.url);result.checks.revocation={manifestStatus:revokedManifest.status,existingSegmentStatus:revokedSegment.status,manifestDenied:denied(revokedManifest),existingSegmentDenied:denied(revokedSegment),freshMediaReturned:media(revokedSegment)};
  await observe({stage:'revocation-observed',...result.checks.revocation});
  const remaining=Date.parse(first.source.expiresAt)+3000-now();if(remaining>125000)stop('invalid-ticket-expiry');if(remaining>0){await observe({stage:'waiting-for-original-expiry',seconds:Math.ceil(remaining/1000)});await sleep(remaining);}
  const expiredManifest=await get(first.source.url),expiredSegment=await get(one.url);result.checks.expiration={manifestStatus:expiredManifest.status,existingSegmentStatus:expiredSegment.status,manifestDenied:denied(expiredManifest),existingSegmentDenied:denied(expiredSegment),freshMediaReturned:media(expiredSegment)};
  result.materialLimitation=result.checks.revocation.freshMediaReturned||result.checks.expiration.freshMediaReturned;
  result.status=result.materialLimitation?'provider-enforcement-limitation-observed':'http-boundary-probe-complete-hosted-proof-still-required';
  return result;
 }finally{
  let pending=issuanceAttempts-tickets.length;
  for(const t of tickets)if(!t.removed)try{await adapter.revoke(t);t.removed=true;}catch{pending++;}
  await observe({stage:'cleanup',ticketsIssued:tickets.length,cleanupPending:pending,secretValuesPersisted:false});if(pending)stop('ticket-cleanup-or-issuance-outcome-unconfirmed');
 }
}
