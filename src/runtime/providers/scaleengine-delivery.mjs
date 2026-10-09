import {randomBytes,createHash} from 'node:crypto';
import {ApplicationError} from '../../application.mjs';
import {scaleEngineAssetScope} from './scaleengine-asset-scope.mjs';
import {requireRentalDelivery} from '../rental-playback.mjs';
export const scaleEngineDeliveryOrigin='https://acruxanalog-vod.secdn.net';
export function createScaleEngineDelivery({environment,cdnId,apiSecret},fetcher=fetch){
 const fail=()=>{throw new ApplicationError('Media delivery temporarily unavailable',503);};
 if(environment!=='development'||!/^\d+$/.test(cdnId)||typeof apiSecret!=='string'||!apiSecret||apiSecret.trim()!==apiSecret)fail();
 const auth='Basic '+Buffer.from(cdnId+':'+apiSecret,'utf8').toString('base64');
 // Existing streams follow provider behavior; revocation retains residual segment access.
 // Activation, recovery and hosted verification must pass before enabling rentals.
 const rentalCapabilities=Object.freeze({protectedHls:true,rentalAccessVerified:false,evidenceReference:null});
 return {rentalCapabilities,async observePlayback(ticket,attemptId,binding){
  const scope=scaleEngineAssetScope(binding);
  if(!ticket?.key||ticket.attemptId!==attemptId||!Number.isFinite(Date.parse(ticket.issuedAt)))return null;
  let response,body;try{
   response=await fetcher('https://api.scaleengine.net/v2/sevu_attempt/'+encodeURIComponent(ticket.key),{headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)return null;body=await response.json();
  }catch{return null;}
  if(body?.error||body?.errors&&(!Array.isArray(body.errors)||body.errors.length))return null;
  const records=Array.isArray(body?.data)?body.data:body?.data?[body.data]:[];
  const observed=records.find(row=>{
   const raw=row.datetime;
   const date=typeof raw==='string'?Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)?raw.replace(' ','T')+'Z':raw):NaN;
   return row.key===ticket.key&&row.app===scope.app&&row.video===scope.video&&[true,1,'1'].includes(row.success)&&Number.isFinite(date)&&date>=Math.floor(Date.parse(ticket.issuedAt)/1000)*1000&&date<=Date.now()&&date<Date.parse(ticket.expiresAt);
  });
  if(!observed)return null;
  // Corroborates the authenticated player's acknowledgement; does not prove decoding.
  return {kind:'provider_authorization_plus_player_ack',attemptId,ticketKey:ticket.key,reference:'sevu-attempt-sha256:'+createHash('sha256').update(JSON.stringify([observed.id,observed.datetime,ticket.key,scope.app,scope.video])).digest('hex')};
 },async observeStartupFailure(){
  // Absent/denied authorization logs do not prove that playback never occurred.
  // Unknown outcomes stay unresolved for audited service correction.
  return null;
 },async revoke(ticket){
  if(typeof ticket?.key!=='string'||!ticket.key)fail();
  let response;try{response=await fetcher('https://api.scaleengine.net/v2/sevu_token/'+encodeURIComponent(ticket.key),{method:'DELETE',headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{fail();}
  if(!response.ok&&response.status!==404)fail();return {revoked:true};
 },async authorize(binding,{rental}={}){
  if(rental)requireRentalDelivery(rentalCapabilities);
  const scope=scaleEngineAssetScope(binding),url=new URL(scope.playbackRef);
  const expiry=Math.min(Date.now()+120000,rental?Date.parse(rental.deadlineAt):Infinity);if(!Number.isFinite(expiry)||expiry<=Date.now())fail();
  const expiresAt=new Date(expiry).toISOString(),pass=randomBytes(24).toString('hex');
  let response;try{response=await fetcher('https://api.scaleengine.net/v2/sevu_token',{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({app:scope.app,video:scope.video,pass,ip:'auto',uses:5,active:true,expire_date:expiresAt.replace('T',' ').slice(0,19)}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{fail();}
  if(!response.ok){
   if(rental&&[401,403].includes(response.status)){const error=new ApplicationError('Playback ticket request denied',503);error.code='RENTAL_TICKET_REJECTED';throw error;}
   fail();
  }let result;try{result=await response.json();}catch{fail();}
  const ticket=result?.data;
  if(typeof ticket?.key==='string'&&ticket.key){
   // Provider expiry bounds token validity, not proven mid-stream cutoff.
   // Persisted rental tickets use reconciliation; this legacy cleanup is best effort.
   const timer=setTimeout(()=>{void fetcher('https://api.scaleengine.net/v2/sevu_token/'+encodeURIComponent(ticket.key),{method:'DELETE',headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(10000)}).catch(()=>{});},125000);timer.unref?.();
  }
  if(result?.error||(result?.errors&&(!Array.isArray(result.errors)||result.errors.length))||typeof ticket?.key!=='string'||!ticket.key||typeof ticket.pass!=='string'||!ticket.pass)fail();
  url.searchParams.set('key',ticket.key);url.searchParams.set('pass',ticket.pass);
  return {kind:'hls',url:url.href,expiresAt,inheritQuery:true,...(rental?{ticket:{key:ticket.key}}:{})};
 }};
}
