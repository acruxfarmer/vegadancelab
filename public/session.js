// Per-tab persistence deliberately stores credentials only, never roles or app data.
export function createSession({storage,fetcher=fetch,now=Date.now,onPending=()=>{},onLost=()=>{},onReady=()=>{},schedule=setTimeout,cancel=clearTimeout}) {
 const key='vega.development.session.v1';
 let current=null,epoch=0,pending=null,timer=null;
 const valid=s=>s&&typeof s.accessToken==='string'&&s.accessToken.length>0&&s.accessToken.length<8192&&typeof s.refreshToken==='string'&&s.refreshToken.length>0&&s.refreshToken.length<8192&&Number.isFinite(s.expiresAt);
 function normalize(value){if(!Number.isFinite(value.expiresIn)||value.expiresIn<=60)throw new Error('Invalid session lifetime');return {accessToken:value.accessToken,refreshToken:value.refreshToken,expiresAt:now()+value.expiresIn*1000};}
 function stop(){if(timer!==null)cancel(timer);timer=null;}
 function clear(){epoch++;stop();current=null;pending=null;try{storage.removeItem(key);}catch{}onLost();}
 function arm(){stop();if(current)timer=schedule(()=>{refresh().then(()=>onReady()).catch(()=>{});},Math.max(1000,current.expiresAt-now()-60000));}
 function persist(value){if(!valid(value))throw new Error('Invalid authentication response');storage.setItem(key,JSON.stringify(value));current=value;arm();}
 function accept(value){epoch++;pending=null;try{persist(normalize(value));}catch(e){clear();throw e;}}
 function restore(){try{const s=JSON.parse(storage.getItem(key));if(valid(s)){current=s;return true;}}catch{}clear();return false;}
 async function refresh(){
  if(pending)return pending;
  if(!current){clear();throw new Error('Sign in to continue.');}
  const generation=epoch,refreshToken=current.refreshToken;
  onPending();stop();
  const operation=(async()=>{
   try{
    const response=await fetcher('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Your session ended. Please sign in again.');
    const value=await response.json();
    if(generation!==epoch)throw new Error('Session changed.');
    persist(normalize(value));
    return current.accessToken;
   }catch(e){if(generation===epoch)clear();throw e;}
   finally{if(generation===epoch)pending=null;}
  })();
  pending=operation;return operation;
 }
 async function access(){if(!current)throw new Error('Sign in to continue.');if(current.expiresAt-now()<60000)return refresh();return current.accessToken;}
 return {accept,restore,refresh,access,clear,generation:()=>epoch,active:()=>!!current};
}
