import {ApplicationError} from '../application.mjs';

// This is a scope guard, NOT authentication: Supabase verifies the JWT itself.
// A session-less token must never reach logout, where it could widen the scope.
function hasSession(token){
 try{const id=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).session_id;return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')&&id!=='00000000-0000-0000-0000-000000000000';}catch{return false;}
}
export async function revokeSession({origin,key,authorization,refreshToken,fetcher}){
 const token=typeof authorization==='string'&&/^Bearer [A-Za-z0-9._-]+$/.test(authorization)&&authorization.length<=8192?authorization.slice(7):null;
 const logout=async access=>{
  if(!hasSession(access))throw new ApplicationError('Session expired or invalid',401);
  const response=await fetcher(`${origin}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(10000)});
  if(response.status===204)return 'revoked';
  if([401,403].includes(response.status)){
   const error=await response.json().catch(()=>({}));
   if(error.code==='session_not_found'||error.error_code==='session_not_found')return 'already_absent';
   return false;
  }
  throw new ApplicationError('Provider sign-out could not be confirmed',503);
 };
 const evidence=(access,outcome)=>{const claims=JSON.parse(Buffer.from(access.split('.')[1],'base64url'));return {userId:claims.sub,sessionId:claims.session_id,outcome};};
 if(token&&hasSession(token)){const outcome=await logout(token);if(outcome)return evidence(token,outcome);}
 // An expired access JWT cannot call logout. Exchange the associated refresh
 // credential only to revoke that provider session; never return/store the result.
 if(typeof refreshToken!=='string'||!refreshToken.length||refreshToken.length>8192)throw new ApplicationError('Session expired or invalid',401);
 const response=await fetcher(`${origin}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refreshToken}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new ApplicationError('Provider sign-out could not be confirmed',response.status>=500||response.status===429?503:401);
 const session=await response.json();
 if(typeof session.access_token!=='string')throw new ApplicationError('Provider sign-out could not be confirmed',401);
 const outcome=await logout(session.access_token);if(!outcome)throw new ApplicationError('Provider sign-out could not be confirmed',401);
 return evidence(session.access_token,outcome);
}
