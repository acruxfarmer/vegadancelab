import {randomBytes} from 'node:crypto';
import {ApplicationError} from '../../application.mjs';
export const scaleEngineDeliveryOrigin='https://acruxanalog-vod.secdn.net';
export function createScaleEngineDelivery({environment,cdnId,apiSecret},fetcher=fetch){
 const fail=()=>{throw new ApplicationError('Media delivery temporarily unavailable',503);};
 if(environment!=='development'||!/^\d+$/.test(cdnId)||typeof apiSecret!=='string'||!apiSecret||apiSecret.trim()!==apiSecret)fail();
 const auth='Basic '+Buffer.from(cdnId+':'+apiSecret,'utf8').toString('base64');
 return {async authorize(binding){
  if(binding.provider!=='scaleengine'||binding.integrationRef!=='development-media'||binding.state!=='ready')fail();
  let url;try{url=new URL(binding.playbackRef);}catch{fail();}
  const name=binding.assetRef?.split('/').at(-1);
  if(!name||url.origin!==scaleEngineDeliveryOrigin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/acruxanalog-vod/play/')||!url.pathname.endsWith('/'+name+'/playlist.m3u8'))fail();
  const expiresAt=new Date(Date.now()+120000).toISOString(),pass=randomBytes(24).toString('hex');
  let response;try{response=await fetcher('https://api.scaleengine.net/v2/sevu_token',{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({app:'acruxanalog-vod',video:'*',pass,ip:'auto',uses:5,active:true,expire_date:expiresAt.replace('T',' ').slice(0,19)}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{fail();}
  if(!response.ok)fail();let result;try{result=await response.json();}catch{fail();}
  const ticket=result?.data;
  if(typeof ticket?.key==='string'&&ticket.key){
   // Expiration enforces the lifetime across restarts. Best-effort removal
   // also clears disposable provider state after the client has finished.
   const timer=setTimeout(()=>{void fetcher('https://api.scaleengine.net/v2/sevu_token/'+encodeURIComponent(ticket.key),{method:'DELETE',headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(10000)}).catch(()=>{});},125000);timer.unref?.();
  }
  if(result?.error||(result?.errors&&(!Array.isArray(result.errors)||result.errors.length))||typeof ticket?.key!=='string'||!ticket.key||typeof ticket.pass!=='string'||!ticket.pass)fail();
  url.searchParams.set('key',ticket.key);url.searchParams.set('pass',ticket.pass);
  return {kind:'hls',url:url.href,expiresAt,inheritQuery:true};
 }};
}
