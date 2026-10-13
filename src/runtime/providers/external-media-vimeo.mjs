// S10: authorization and bounded connection proof only. No library ingestion.
export class MediaConnectionError extends Error {
 constructor(code){super(code);this.name='MediaConnectionError';this.code=code;}
}
const fail=code=>{throw new MediaConnectionError(code);};
const token=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\s\u0000-\u001f]/.test(value);
export function createVimeoConnectionAdapter({clientId,clientSecret,redirectUri,fetcher=fetch,now=Date.now}){
 if(!token(clientId)||!token(clientSecret)||redirectUri!=='https://vega-development-web.onrender.com/api/media-connections/vimeo/callback')fail('provider_not_configured');
 async function request(path,{accessToken,method='GET',body,basic=false}={}){
  if(!basic&&!token(accessToken))fail('reconnect_required');
  let response;
  try{response=await fetcher('https://api.vimeo.com'+path,{method,redirect:'error',headers:{Authorization:basic?'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'):'Bearer '+accessToken,Accept:'application/vnd.vimeo.*+json;version=3.4',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});}catch{fail('provider_unavailable');}
  if(!response.ok){
   // Never propagate provider bodies, URLs, token values or transport errors.
   if(response.status===401)fail('reconnect_required');
   if(response.status===403)fail('permission_denied');
   if(response.status===429)fail('rate_limited');
   fail(response.status>=500?'provider_unavailable':'provider_request_rejected');
  }
  if(response.status===204)return null;
  if(method==='DELETE')fail('provider_response_invalid');
  try{
   const reader=response.body.getReader();let length=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();fail('provider_response_invalid');}chunks.push(value);}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{fail('provider_response_invalid');}
 }
 return {
  provider:'vimeo',requestedScopes:['public'],refreshSupported:false,
  authorizationUrl(state){
   if(!/^[a-f0-9]{64}$/.test(state))fail('authorization_state_invalid');
   const url=new URL('https://api.vimeo.com/oauth/authorize');
   for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'public',state}))url.searchParams.set(key,value);
   return url.href;
  },
  async exchange(code){
   if(!token(code))fail('authorization_code_invalid');
   const result=await request('/oauth/access_token',{method:'POST',basic:true,body:{grant_type:'authorization_code',code,redirect_uri:redirectUri}});
   const scopes=typeof result.scope==='string'?result.scope.trim().split(/\s+/):[];
   if(!token(result.access_token)||String(result.token_type).toLowerCase()!=='bearer')fail('provider_response_invalid');
   // Do not silently accept broader authority from an existing provider grant.
   if(scopes.length!==1||scopes[0]!=='public'){
    await request('/tokens',{accessToken:result.access_token,method:'DELETE'}).catch(()=>{});
    fail('scope_mismatch');
   }
   if(result.expires_in!==undefined&&(!Number.isFinite(result.expires_in)||result.expires_in<=0))fail('provider_response_invalid');
   return {accessToken:result.access_token,scopes,expiresAt:result.expires_in===undefined?null:new Date(now()+result.expires_in*1000).toISOString()};
  },
  async verify(credentials){
   if(credentials.expiresAt&&(!Number.isFinite(Date.parse(credentials.expiresAt))||Date.parse(credentials.expiresAt)<=now()))fail('reconnect_required');
   if(JSON.stringify(credentials.scopes)!==JSON.stringify(['public']))fail('scope_mismatch');
   const account=await request('/me?fields=uri,name',{accessToken:credentials.accessToken});
   if(!/^\/users\/\d+$/.test(account.uri||'')||typeof account.name!=='string'||account.name.length>300)fail('provider_response_invalid');
   const list=await request('/me/videos?per_page=2&page=1&fields=uri',{accessToken:credentials.accessToken});
   if(!Array.isArray(list.data)||list.data.length>2||list.data.some(item=>!/^\/videos\/\d+$/.test(item.uri||'')))fail('provider_response_invalid');
   // Sample references deliberately never leave this adapter or get persisted.
   return {accountId:account.uri,accountName:account.name,verifiedAt:new Date(now()).toISOString(),sampleCount:list.data.length,capabilities:['account.read','media.sample.read']};
  },
  async revoke(credentials){
   try{await request('/tokens',{accessToken:credentials.accessToken,method:'DELETE'});}catch(error){if(error.code!=='reconnect_required')throw error;}
  }
 };
}
