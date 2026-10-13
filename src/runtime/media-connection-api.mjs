import {ApplicationError} from '../application.mjs';
import {callbackContext,mediaConnectionOrigin} from './media-connection-configuration.mjs';

export async function handleMediaConnectionApi(req,res,{service,principal,readJson,send,observeCallback=event=>console.warn(JSON.stringify(event))}){
 const url=new URL(req.url,mediaConnectionOrigin),match=url.pathname.match(/^\/api\/media-connections\/(vimeo|youtube)(?:\/(begin|verify|disconnect|callback))?$/);
 if(!match)return false;
 if(!service)throw new ApplicationError('External media connections are not configured',503);
 const [,provider,action]=match,cookieName='vega_media_oauth_'+provider;
 const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/api/media-connections/${provider}/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
 if(action==='callback'){
  if(req.method!=='GET')throw new ApplicationError('Method not allowed',405);
  res.setHeader('Set-Cookie',cookie('',0));
  let succeeded=false,stage='binding_cookie_missing';
  try{
   const entries=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));
   if(entries.length!==1){stage=entries.length?'binding_cookie_duplicate':'binding_cookie_missing';throw Error();}
   stage='binding_decryption';
   const binding=service.secrets.open(entries[0].slice(cookieName.length+1),callbackContext);
   stage='binding_provider';
   if(binding.provider!==provider)throw Error();
   stage='binding_expiry';
   if(!Number.isFinite(binding.expiresAt)||binding.expiresAt<=Date.now())throw Error();
   // Google's callback includes informational metadata. Never use it to
   // establish identity or granted scopes: those come from server-side reads.
   const allowed=['code','state','error','error_description',...(provider==='youtube'?['scope','authuser','hd','prompt']:[])];
   stage='callback_unknown_parameter';
   if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))throw Error();
   stage='callback_duplicate_parameter';
   if([...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))throw Error();
   stage='provider_error_returned';
   if(url.searchParams.has('error'))throw Error();
   stage='callback_code_or_state_missing';
   if(url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1)throw Error();
   stage='authorization_consumption';
   const result=await service.workflow.complete(binding.identity,provider,{state:url.searchParams.get('state'),browser:binding.browser,code:url.searchParams.get('code')});
   succeeded=result.status==='connected';
   stage='connection_verification';
  }catch{} // Never return a provider response, authorization code or cookie.
  // Fixed labels only: never log request data, identity, query names/values,
  // cookies, encrypted bindings, or exceptions. Preserve Vimeo's existing path.
  if(provider==='youtube'&&!succeeded){try{observeCallback({event:'youtube_oauth_callback_incomplete',stage});}catch{}}
  res.writeHead(303,{Location:'/media-connections.html#'+(succeeded?'connected':'authorization-incomplete'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;
 }
 if(url.search||!['GET','POST'].includes(req.method)||(!action&&req.method!=='GET')||(action&&req.method!=='POST'))throw new ApplicationError('Invalid connection request',400);
 const identity=await principal(req);
 if(!identity||typeof identity!=='object')throw new ApplicationError('Choose an authorized business',403);
 if(!action){send(200,await service.workflow.status(identity,provider));return true;}
 if(req.headers.origin!==mediaConnectionOrigin)throw new ApplicationError('Invalid request origin',403);
 const input=await readJson(req);
 if(Object.keys(input).some(key=>key!=='expectedRevision')||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw new ApplicationError('Refresh the connection before continuing',400);
 if(action==='begin'){
  const started=await service.workflow.begin(identity,provider,input.expectedRevision);
  const binding=service.secrets.seal({identity,provider,browser:started.browser,expiresAt:Date.now()+600000},callbackContext);
  res.setHeader('Set-Cookie',cookie(binding,600));send(200,{authorizationUrl:started.authorizationUrl});
 }else send(200,await service.workflow[action](identity,provider,input.expectedRevision));
 return true;
}
