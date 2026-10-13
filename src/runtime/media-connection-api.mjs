import {ApplicationError} from '../application.mjs';
import {callbackContext,mediaConnectionOrigin} from './media-connection-configuration.mjs';

export async function handleMediaConnectionApi(req,res,{service,principal,readJson,send}){
 const url=new URL(req.url,mediaConnectionOrigin),match=url.pathname.match(/^\/api\/media-connections\/(vimeo|youtube)(?:\/(begin|verify|disconnect|callback))?$/);
 if(!match)return false;
 if(!service)throw new ApplicationError('External media connections are not configured',503);
 const [,provider,action]=match,cookieName='vega_media_oauth_'+provider;
 const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/api/media-connections/${provider}/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
 if(action==='callback'){
  if(req.method!=='GET')throw new ApplicationError('Method not allowed',405);
  res.setHeader('Set-Cookie',cookie('',0));
  let succeeded=false;
  try{
   const entries=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));
   if(entries.length!==1)throw Error();
   const binding=service.secrets.open(entries[0].slice(cookieName.length+1),callbackContext);
   if(binding.provider!==provider||!Number.isFinite(binding.expiresAt)||binding.expiresAt<=Date.now())throw Error();
   // Google's callback includes informational metadata. Never use it to
   // establish identity or granted scopes: those come from server-side reads.
   const allowed=['code','state','error','error_description',...(provider==='youtube'?['scope','authuser','hd','prompt']:[])];
   if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1)||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1||url.searchParams.has('error'))throw Error();
   const result=await service.workflow.complete(binding.identity,provider,{state:url.searchParams.get('state'),browser:binding.browser,code:url.searchParams.get('code')});
   succeeded=result.status==='connected';
  }catch{} // Never return a provider response, authorization code or cookie.
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
