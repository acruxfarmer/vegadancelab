import { ApplicationError } from '../application.mjs';
import {revokeSession} from './sign-out.mjs';

const origin='https://cjdoczrxcjynjhgpgqop.supabase.co';
export async function readJson(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw new ApplicationError('JSON required',415);
 let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw new ApplicationError('Request too large',413);chunks.push(chunk);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}catch{throw new ApplicationError('Invalid JSON');}
}
export function createApplicationApi(env,store,fetcher=fetch){
 const key=env.SUPABASE_PUBLISHABLE_KEY;
 const configured=()=>{if(!key||env.SUPABASE_URL!==origin)throw new ApplicationError('Application authentication is not configured',503);};
 async function principal(req){
  configured();const token=req.headers.authorization;
  if(typeof token!=='string'||!/^Bearer [A-Za-z0-9._-]+$/.test(token)||token.length>8192)throw new ApplicationError('Sign in to continue',401);
  const response=await fetcher(`${origin}/auth/v1/user`,{headers:{apikey:key,Authorization:token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new ApplicationError(response.status>=500?'Authentication unavailable':'Session expired or invalid',response.status>=500?503:401);
  const user=await response.json();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id||''))throw new ApplicationError('Invalid session',401);return user.id;
 }
 return async(req,res)=>{
  const url=new URL(req.url,'http://vega.local');if(!url.pathname.startsWith('/api/'))return false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(url.pathname==='/api/config'&&req.method==='GET'){send(200,{environment:'development',squareEnabled:false,externalEffects:'disabled',authenticationConfigured:!!key,applicationConfigured:!!store});return true;}
   if(['/api/auth/sign-in','/api/auth/refresh'].includes(url.pathname)&&req.method==='POST'){
    configured();const body=await readJson(req);
    const refreshing=url.pathname==='/api/auth/refresh';
    if(refreshing){if(typeof body.refreshToken!=='string'||!body.refreshToken.length||body.refreshToken.length>8192)throw new ApplicationError('Session expired or invalid',401);}
    else if(typeof body.email!=='string'||body.email.length>254||typeof body.password!=='string'||body.password.length>1024)throw new ApplicationError('Email and password required');
    const response=await fetcher(`${origin}/auth/v1/token?grant_type=${refreshing?'refresh_token':'password'}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(refreshing?{refresh_token:body.refreshToken}:{email:body.email,password:body.password}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new ApplicationError(refreshing?'Session expired or invalid':'Unable to sign in with these details',response.status>=500?503:401);
    const session=await response.json();
    if(typeof session.access_token!=='string'||typeof session.refresh_token!=='string'||!Number.isFinite(session.expires_in)||session.expires_in<=60)throw new ApplicationError('Authentication unavailable',503);
    send(200,{accessToken:session.access_token,access_token:session.access_token,refreshToken:session.refresh_token,expiresIn:session.expires_in});return true;
   }
   if(url.pathname==='/api/auth/sign-out'&&req.method==='POST'){
    configured();const body=await readJson(req);
    await revokeSession({origin,key,authorization:req.headers.authorization,refreshToken:body.refreshToken,fetcher});
    send(200,{signedOut:true});return true;
   }
   const userId=await principal(req);
   if(!store)throw new ApplicationError('Application database handoff is pending',503);
   if(url.pathname==='/api/app'&&req.method==='GET'){send(200,await store.read(userId));return true;}
   if(req.method!=='POST')throw new ApplicationError('Method not allowed',405);
   const body=await readJson(req),routes={'/api/entitlements/products':'entitlement-product','/api/entitlements/issue':'issue-entitlement','/api/credits/issue':'issue-credit','/api/classes/cancel':'cancel-class','/api/classes/policy':'class-policy','/api/reservations':'reserve','/api/classes':'class','/api/participants':'participant','/api/preferences':'preferences','/api/notifications':'notification'};
   if(url.pathname==='/api/classes/edit/review'){send(200,await store.reviewClassEdit(userId,body));return true;}
   if(url.pathname==='/api/classes/duplicate/review'){send(200,await store.reviewClassDuplicate(userId,body));return true;}
   routes['/api/classes/duplicate']='duplicate-class';
   let action=url.pathname==='/api/classes/edit'?'edit-class':routes[url.pathname],id;
   const match=url.pathname.match(/^\/api\/reservations\/([A-Za-z0-9-]{1,128})\/(cancel|correct-cancellation|attendance|promote)$/);
   if(match){id=match[1];action=match[2];}
   if(!action)throw new ApplicationError('Operation unavailable',404);
   send(200,await store.command(userId,{action,id,body}));
  }catch(error){send(error instanceof ApplicationError?error.status:503,{error:error instanceof ApplicationError?error.message:'Application temporarily unavailable'});}
  return true;
 };
}
