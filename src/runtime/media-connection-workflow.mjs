import {ApplicationError} from '../application.mjs';
import {beginMediaAuthorization,consumeMediaAuthorization,completeMediaAuthorization,disconnectMediaConnection,mediaConnectionView,connectionRevision} from '../media-connections.mjs';

const safeCodes=new Set(['reconnect_required','permission_denied','rate_limited','provider_unavailable','provider_request_rejected','provider_response_invalid','provider_account_selection_required','scope_mismatch','credential_unavailable']);
const safeError=error=>safeCodes.has(error?.code)?error.code:'connection_verification_failed';
export function createMediaConnectionWorkflow({repository,secrets,adapters,now=Date.now}){
 const adapter=provider=>{if(!Object.hasOwn(adapters,provider))throw new ApplicationError('Provider connection is not configured',503);return adapters[provider];};
 const context=(identity,provider)=>({...identity,provider,purpose:'credentials'});
 const update=(identity,provider,fn)=>repository.transaction(identity,provider,fn);
 async function usableCredentials(row,current,identity,provider){
  let credentials=secrets.open(row.sealedCredentials,context(identity,provider)),renewed;
  if(current.refresh&&Number.isFinite(Date.parse(credentials.expiresAt))&&Date.parse(credentials.expiresAt)<=now()+60000){credentials=await current.refresh(credentials);renewed=secrets.seal(credentials,context(identity,provider));}
  return {credentials,renewed};
 }
 async function failure(identity,provider,revision,error){
  return update(identity,provider,row=>{
   connectionRevision(row,revision);
   const next={...row,revision:row.revision+1,status:error?.code==='reconnect_required'?'reconnect_required':'unavailable',lastError:safeError(error)};
   return {next,action:'connection_failed',value:mediaConnectionView(next,now())};
  });
 }
 return {
  async libraryRead(identity,provider,operation,value){
   if(!['discover','media'].includes(operation))throw new ApplicationError('Unsupported source read',400);
   const current=adapter(provider);
   const result=await update(identity,provider,async row=>{
    if(!['connected','unavailable'].includes(row.status)||!row.sealedCredentials||!row.accountId)throw new ApplicationError('Connection needs attention',409);
    let renewed,credentials;
    try{
     ({credentials,renewed}=await usableCredentials(row,current,identity,provider));
     if(JSON.stringify(credentials.scopes)!==JSON.stringify(current.requestedScopes))throw Object.assign(Error(),{code:'scope_mismatch'});
     if(credentials.expiresAt&&(!Number.isFinite(Date.parse(credentials.expiresAt))||Date.parse(credentials.expiresAt)<=now()))throw Object.assign(Error(),{code:'reconnect_required'});
     const data=await current[operation](credentials,row.accountId,value);
     return {...(renewed?{next:{...row,sealedCredentials:renewed,expiresAt:credentials.expiresAt,revision:row.revision+1},action:'credentials_saved'}:{}),value:{data,accountId:row.accountId}};
    }catch(error){
     return {...(renewed?{next:{...row,sealedCredentials:renewed,expiresAt:credentials.expiresAt,revision:row.revision+1},action:'credentials_saved'}:{}),value:{error:safeError(error)}};
    }
   });
   if(result.error)throw new ApplicationError('Source read unavailable: '+result.error,503);
   return result;
  },
  status:(identity,provider)=>update(identity,provider,row=>({value:{...mediaConnectionView(row,now()),configured:Object.hasOwn(adapters,provider)}})),
  async begin(identity,provider,expectedRevision){
   const current=adapter(provider);
   return update(identity,provider,(row,authority)=>{
    const result=beginMediaAuthorization(row,authority,expectedRevision,now());
    return {next:result.next,action:'authorization_started',value:{authorizationUrl:current.authorizationUrl(result.state),state:result.state,browser:result.browser,revision:result.next.revision}};
   });
  },
  async complete(identity,provider,{state,browser,code}){
   const current=adapter(provider);
   const claimed=await update(identity,provider,(row,authority)=>{const next=consumeMediaAuthorization(row,authority,{state,browser},now());return {next,action:'authorization_consumed',value:next};});
   let revision=claimed.revision,credentials;
   try{
    credentials=await current.exchange(code);
    const sealedCredentials=secrets.seal(credentials,context(identity,provider));
    const stored=await update(identity,provider,row=>{
     connectionRevision(row,revision);
     if(row.status!=='verifying')throw new ApplicationError('Authorization is no longer active',409);
     const next={...row,revision:row.revision+1,sealedCredentials};
     return {next,action:'credentials_saved',value:next};
    });
    revision=stored.revision;
    const proof=await current.verify(credentials);
    return await update(identity,provider,(row,authority)=>{
     const next=completeMediaAuthorization(row,authority,revision,{sealedCredentials,proof,scopes:credentials.scopes,expiresAt:credentials.expiresAt});
     return {next,action:'connection_verified',value:mediaConnectionView(next,now())};
    });
   }catch(error){
    // A concurrent disconnect must never be overwritten by late provider work.
    try{return await failure(identity,provider,revision,error);}catch{
     if(credentials&&current.revoke)await current.revoke(credentials).catch(()=>{});
     throw new ApplicationError('Connection changed during authorization. Refresh its status; provider cleanup may require account review.',409);
    }
   }
  },
  async verify(identity,provider,expectedRevision){
   const current=adapter(provider);
   // Serialize the bounded read against disconnect and re-check live permission
   // inside the repository transaction. Return only identity/count evidence.
   return update(identity,provider,async row=>{
    connectionRevision(row,expectedRevision);
    if(!['connected','unavailable'].includes(row.status)||!row.sealedCredentials)throw new ApplicationError('Reconnect this account before checking access',409);
    let renewed;
    try{
     let credentials;({credentials,renewed}=await usableCredentials(row,current,identity,provider));
     const proof=await current.verify(credentials);
     if(row.accountId&&proof.accountId!==row.accountId)throw new ApplicationError('Provider account changed',409);
     const next={...row,...(renewed?{sealedCredentials:renewed}:{}),revision:row.revision+1,status:'connected',...proof,scopes:credentials.scopes,expiresAt:credentials.expiresAt,lastError:null};
     return {next,action:'connection_verified',value:mediaConnectionView(next,now())};
    }catch(error){const next={...row,...(renewed?{sealedCredentials:renewed}:{}),revision:row.revision+1,status:error?.code==='reconnect_required'?'reconnect_required':'unavailable',lastError:safeError(error)};return {next,action:'connection_failed',value:mediaConnectionView(next,now())};}
   });
  },
  async disconnect(identity,provider,expectedRevision){
   const captured=await update(identity,provider,(row,authority)=>{
    const next=disconnectMediaConnection(row,authority,expectedRevision);
    return {next,action:'disconnected',value:{revision:next.revision,sealedCredentials:row.sealedCredentials}};
   });
   let revocation='not_required';
   if(captured.sealedCredentials){
    revocation='unconfirmed';
    try{const current=adapter(provider);if(current.revoke){await current.revoke(secrets.open(captured.sealedCredentials,context(identity,provider)));revocation='confirmed';}else revocation='provider_manual_action_required';}catch{}
   }
   return update(identity,provider,row=>{
    if(row.revision!==captured.revision)return {value:mediaConnectionView(row,now())};
    const next={...row,revision:row.revision+1,revocation};return {next,action:'revocation_recorded',value:mediaConnectionView(next,now())};
   });
  }
 };
}
