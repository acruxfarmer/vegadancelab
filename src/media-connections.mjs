import {createHash,randomBytes} from 'node:crypto';
import {ApplicationError} from './application.mjs';
import {resolveStaffAccess,hasStaffPermission} from './staff-permissions.mjs';

const fail=(message,status=403)=>{throw new ApplicationError(message,status);};
export const mediaConnectionDigest=value=>createHash('sha256').update(value).digest('hex');
export function requireMediaConnectionAuthority(state,authority,initialOwners=[]){
 // Existing owner/manager media-management authority; no new roles.
 if(!authority||authority.role!=='staff'||!hasStaffPermission(resolveStaffAccess(state,authority,{initialOwners}),authority,'customers.manage'))fail('Media management permission required');
}
export function connectionScope(row,authority){
 if(!row||row.tenantId!==authority.tenantId||row.businessId!==authority.businessId)fail('Connection unavailable');
}
export function connectionRevision(row,expected){
 if(!Number.isSafeInteger(expected)||expected!==row.revision)fail('Connection changed. Refresh before continuing.',409);
}
export function beginMediaAuthorization(row,authority,expected,now=Date.now()){
 connectionScope(row,authority);connectionRevision(row,expected);
 if(row.status!=='disconnected')fail('Disconnect the existing connection before authorizing an account.',409);
 const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex');
 return {state,browser,next:{...row,revision:row.revision+1,status:'authorizing',pending:{actorId:authority.userId,stateHash:mediaConnectionDigest(state),browserHash:mediaConnectionDigest(browser),expiresAt:new Date(now+600000).toISOString()},lastError:null}};
}
export function consumeMediaAuthorization(row,authority,{state,browser},now=Date.now()){
 connectionScope(row,authority);
 const pending=row.pending;
 if(row.status!=='authorizing'||!pending||pending.actorId!==authority.userId||!Number.isFinite(Date.parse(pending.expiresAt))||Date.parse(pending.expiresAt)<=now||! /^[a-f0-9]{64}$/.test(state||'')||! /^[a-f0-9]{64}$/.test(browser||'')||mediaConnectionDigest(state)!==pending.stateHash||mediaConnectionDigest(browser)!==pending.browserHash)fail('Authorization expired or does not match this session.',403);
 return {...row,revision:row.revision+1,status:'verifying',pending:null};
}
export function completeMediaAuthorization(row,authority,expected,{sealedCredentials,proof,scopes,expiresAt}){
 connectionScope(row,authority);connectionRevision(row,expected);
 if(row.status!=='verifying')fail('Authorization is no longer active.',409);
 return {...row,revision:row.revision+1,status:'connected',sealedCredentials,accountId:proof.accountId,accountName:proof.accountName,scopes:[...scopes],capabilities:[...proof.capabilities],expiresAt,verifiedAt:proof.verifiedAt,sampleCount:proof.sampleCount,lastError:null};
}
export function disconnectMediaConnection(row,authority,expected){
 connectionScope(row,authority);connectionRevision(row,expected);
 // Must commit this tombstone before attempting remote revocation. A failed
 // provider call cannot leave the connection usable through Acrux.
 return {...row,revision:row.revision+1,status:'disconnected',sealedCredentials:null,pending:null,scopes:[],capabilities:[],expiresAt:null,revocation:'pending',lastError:null};
}
export function mediaConnectionView(row,now=Date.now()){
 const expired=row.expiresAt&&(!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=now);
 return {provider:row.provider,revision:row.revision,status:row.status==='connected'&&expired?'reconnect_required':row.status,accountId:row.accountId??null,accountName:row.accountName??null,scopes:row.scopes||[],capabilities:row.capabilities||[],expiresAt:row.expiresAt??null,verifiedAt:row.verifiedAt??null,sampleCount:row.sampleCount??null,revocation:row.revocation??null,lastError:row.lastError??null};
}
