import {MediaConnectionError} from './external-media-vimeo.mjs';
const scope='https://www.googleapis.com/auth/youtube.readonly';
const fail=code=>{throw new MediaConnectionError(code);};
const valid=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\s\u0000-\u001f]/.test(value);
export function createYouTubeConnectionAdapter({clientId,clientSecret,redirectUri,fetcher=fetch,now=Date.now}){
 if(!valid(clientId)||!valid(clientSecret)||redirectUri!=='https://vega-development-web.onrender.com/api/media-connections/youtube/callback')fail('provider_not_configured');
 async function request(url,{accessToken,body,empty=false}={}){
  let response;
  try{response=await fetcher(url,{method:body?'POST':'GET',redirect:'error',headers:{...(accessToken?{Authorization:'Bearer '+accessToken}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:new URLSearchParams(body).toString()}:{}),signal:AbortSignal.timeout(10000)});}catch{fail('provider_unavailable');}
  let value;
  if(empty&&response.ok)return;
  try{
   const reader=response.body.getReader(),chunks=[];let count=0;
   while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>65536){await reader.cancel();fail('provider_response_invalid');}chunks.push(value);}
   value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{fail('provider_response_invalid');}
  if(!response.ok){
   if(response.status===401||value?.error==='invalid_grant')fail('reconnect_required');
   if(response.status===403)fail('permission_denied');
   if(response.status===429)fail('rate_limited');
   fail(response.status>=500?'provider_unavailable':'provider_request_rejected');
  }
  return value;
 }
 function credentials(result,previous){
  const scopes=typeof result.scope==='string'?result.scope.split(/\s+/):previous?.scopes;
  if(!valid(result.access_token)||String(result.token_type).toLowerCase()!=='bearer'||!Number.isFinite(result.expires_in)||result.expires_in<=0)fail('provider_response_invalid');
  if(!scopes||scopes.length!==1||scopes[0]!==scope)fail('scope_mismatch');
  const refreshToken=result.refresh_token??previous?.refreshToken;
  if(!valid(refreshToken))fail('reconnect_required');
  return {accessToken:result.access_token,refreshToken,scopes,expiresAt:new Date(now()+result.expires_in*1000).toISOString()};
 }
 return {
  provider:'youtube',requestedScopes:[scope],refreshSupported:true,
  authorizationUrl(state){
   if(!/^[a-f0-9]{64}$/.test(state))fail('authorization_state_invalid');
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope,state,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false'}))url.searchParams.set(key,value);
   return url.href;
  },
  async exchange(code){
   if(!valid(code))fail('authorization_code_invalid');
   const result=await request('https://oauth2.googleapis.com/token',{body:{client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code',code}});
   try{return credentials(result);}catch(error){if(valid(result.access_token))await request('https://oauth2.googleapis.com/revoke',{body:{token:result.access_token},empty:true}).catch(()=>{});throw error;}
  },
  async refresh(previous){
   if(!valid(previous.refreshToken)||JSON.stringify(previous.scopes)!==JSON.stringify([scope]))fail('reconnect_required');
   return credentials(await request('https://oauth2.googleapis.com/token',{body:{client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:previous.refreshToken}}),previous);
  },
  async verify(credentials){
   if(!valid(credentials.accessToken)||JSON.stringify(credentials.scopes)!==JSON.stringify([scope])||!Number.isFinite(Date.parse(credentials.expiresAt))||Date.parse(credentials.expiresAt)<=now())fail('reconnect_required');
   const channels=await request('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true&maxResults=2',{accessToken:credentials.accessToken});
   if(!Array.isArray(channels.items)||channels.items.length!==1||channels.nextPageToken)fail('provider_account_selection_required');
   const account=channels.items[0],uploads=account.contentDetails?.relatedPlaylists?.uploads;
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(account.id||'')||! /^[A-Za-z0-9_-]{1,128}$/.test(uploads||'')||typeof account.snippet?.title!=='string'||account.snippet.title.length>300)fail('provider_response_invalid');
   const list=await request('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=2&playlistId='+encodeURIComponent(uploads),{accessToken:credentials.accessToken});
   if(!Array.isArray(list.items)||list.items.length>2||list.items.some(item=>! /^[A-Za-z0-9_-]{1,128}$/.test(item.contentDetails?.videoId||'')))fail('provider_response_invalid');
   return {accountId:account.id,accountName:account.snippet.title,verifiedAt:new Date(now()).toISOString(),sampleCount:list.items.length,capabilities:['account.read','media.sample.read']};
  },
  async revoke(credentials){await request('https://oauth2.googleapis.com/revoke',{body:{token:credentials.refreshToken||credentials.accessToken},empty:true});}
 };
}
