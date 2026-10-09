import {randomUUID,createHash} from 'node:crypto';
import {ApplicationError} from '../application.mjs';

const fail=(message,status=409)=>{throw new ApplicationError(message,status);};
const time=value=>{const n=Date.parse(value);if(!Number.isFinite(n))fail('Invalid server playback time');return n;};
const iso=n=>new Date(n).toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const sessions=state=>(state.rentalPlaybackSessions??=[]);
const tickets=state=>(state.rentalPlaybackTickets??=[]);
const validateDevice=value=>{if(typeof value!=='string'||!/^[-a-zA-Z0-9]{32,128}$/.test(value))fail('Playback device identity required',400);return hash(value);};
const entitlementCheck=e=>{if(!e?.rental||e.state!=='active')fail('Rental access unavailable',403);};

// These mutations run only within the existing serialized application command.
// Inputs named evidence/capabilities are trusted server dependencies, never HTTP data.
export function requireRentalDelivery(capabilities){
 if(!capabilities?.protectedHls||!capabilities?.rentalAccessVerified||!capabilities?.evidenceReference)fail('Rental playback is unavailable pending protected delivery verification',503);
}
// Every fresh authorization, including reuse of a persisted ticket, checks the
// current entitlement. Old session deadlines never grant additional eligibility.
export function requireRentalAccess(e,at){
 entitlementCheck(e);const r=e.rental,now=time(at);
 if(!r.availableAt||now<time(r.availableAt))fail('Rental is not yet available',403);
 if(r.activation?.confirmedAt){if(!r.expiresAt||now>=time(r.expiresAt))fail('Rental expired',403);}
 else if(!r.startBy||now>=time(r.startBy))fail('Rental activation allowance expired',403);
}
export function rentalAuthorizationDeadline(e,session){
 const r=e.rental;
 return r.activation?.confirmedAt?r.expiresAt:iso(Math.min(time(r.startBy),time(session.createdAt)+Math.max(0,r.policy.startupRecoveryMinutes*60000-(r.recoveryUsedMs||0))));
}
export function reserveRentalPlayback(state,e,{actorId,deviceId,sessionId,at,binding,capabilities,id=randomUUID}){
 entitlementCheck(e);if(e.principalId!==actorId)fail('Rental access unavailable',403);
 requireRentalDelivery(capabilities);
 requireRentalAccess(e,at);
 const now=time(at),deviceHash=validateDevice(deviceId),r=e.rental;
 if(!r.activation?.confirmedAt&&(r.recoveryUsedMs||0)>=r.policy.startupRecoveryMinutes*60000)fail('Startup recovery budget exhausted',403);
 if(binding?.state!=='ready'||!binding.assetRef)fail('Protected video is unavailable',503);
 const existing=sessionId?sessions(state).find(s=>s.id===sessionId&&s.entitlementId===e.id):sessions(state).findLast(s=>s.entitlementId===e.id&&s.actorId===actorId&&s.deviceHash===deviceHash&&['starting','active'].includes(s.state));
 if(existing){
  if(existing.actorId!==actorId||existing.deviceHash!==deviceHash)fail('Continue this viewing on its original device',403);
  if(existing.state==='revoked'||existing.state==='ended'||existing.bindingId!==binding.id||existing.assetRef!==binding.assetRef||existing.assetRevision!==binding.revision)fail('Playback session is no longer available',403);
  if(now>=time(rentalAuthorizationDeadline(e,existing)))fail('Startup recovery budget exhausted',403);
  return existing;
 }
 if(sessionId)fail('Playback session unavailable',403);
 if(r.activation&&!r.activation.confirmedAt&&r.activation.state!=='recovered'){
  const pending=sessions(state).find(s=>s.id===r.activation.sessionId);
  if(pending?.deviceHash===deviceHash&&pending.actorId===actorId&&pending.state==='starting')return pending;
  fail('Initial playback is being reconciled');
 }
 if(r.activation?.confirmedAt&&!r.policy.replayAllowed&&sessions(state).some(s=>s.entitlementId===e.id&&s.startedAt))fail('Replay is not included in this rental',403);
 const session={id:id(),entitlementId:e.id,actorId,deviceHash,bindingId:binding.id,assetRef:binding.assetRef,assetRevision:binding.revision,attemptId:id(),createdAt:at,startedAt:null,state:'starting'};
 sessions(state).push(session);
 if(!r.activation)r.activation={id:id(),attemptId:session.attemptId,sessionId:session.id,reservedAt:at,confirmedAt:null,evidence:null,attempts:[]};
 else if(!r.activation.confirmedAt){Object.assign(r.activation,{attemptId:session.attemptId,sessionId:session.id,reservedAt:at,state:'starting'});}
 if(!r.activation.confirmedAt)(r.activation.attempts??=[]).push({attemptId:session.attemptId,sessionId:session.id,reservedAt:at});
 return session;
}
export function recordRentalTicket(state,session,{provider,key,expiresAt,at}){
 if(session.state==='revoked'||session.state==='ended'||!provider||!key||time(expiresAt)<=time(at))fail('Invalid playback ticket');
 const existing=tickets(state).find(t=>t.provider===provider&&t.key===key);if(existing)return existing;
 const ticket={provider,key,sessionId:session.id,entitlementId:session.entitlementId,attemptId:session.attemptId,issuedAt:at,expiresAt,state:'active'};tickets(state).push(ticket);return ticket;
}
export function confirmRentalPlayback(state,e,session,{at,evidence,playerAcknowledged=false}){
 entitlementCheck(e);
 if(session.entitlementId!==e.id||!sessions(state).includes(session)||session.state==='revoked'||session.state==='ended')fail('Playback session unavailable',403);
 if(session.startedAt)return session;
 // Paired provider authorization and authenticated player acknowledgement are
 // practical activation evidence, not proof of a decoded frame or DRM attestation.
 if(!playerAcknowledged||evidence?.kind!=='provider_authorization_plus_player_ack'||evidence.attemptId!==session.attemptId||!evidence.reference||!tickets(state).some(t=>t.sessionId===session.id&&t.key===evidence.ticketKey&&t.state==='active'&&time(t.expiresAt)>time(at)))fail('Playback start is not yet confirmed');
 const r=e.rental,now=time(at);
 if(!r.activation?.confirmedAt&&now-time(session.createdAt)+(r.recoveryUsedMs||0)>=r.policy.startupRecoveryMinutes*60000)fail('Startup recovery budget exhausted');
 if(!r.activation?.confirmedAt){
  if(r.activation?.sessionId!==session.id||!r.availableAt||now<time(r.availableAt)||r.startBy&&now>=time(r.startBy))fail('Rental activation allowance expired',403);
  r.activation.confirmedAt=at;r.activation.evidence={kind:evidence.kind,reference:evidence.reference};
  r.expiresAt=iso(now+r.policy.viewingHours*3600000);
 }else if(now>=time(r.expiresAt))fail('New playback cannot begin after expiration',403);
 session.startedAt=at;session.state='active';
 return session;
}
export function recoverRentalStartup(state,e,session,{at,evidence}){
 entitlementCheck(e);const r=e.rental;
 if(session.recovery==='confirmed_failure')return {recovered:true};
 if(session.recovery==='exhausted')return {recovered:false,reason:'startup_recovery_exhausted'};
 if(session.entitlementId!==e.id||session.startedAt||r.activation?.sessionId!==session.id||r.activation.confirmedAt)fail('Startup recovery unavailable');
 if(evidence?.kind!=='confirmed_startup_failure'||evidence.attemptId!==session.attemptId||!evidence.reference)fail('Startup outcome requires reconciliation');
 if(tickets(state).some(t=>t.sessionId===session.id&&t.state!=='revoked'))fail('Outstanding tickets require confirmed revocation');
 const used=(r.recoveryUsedMs||0)+Math.max(0,time(at)-time(session.createdAt));
 r.recoveryUsedMs=used;session.state='ended';session.endedAt=at;
 if(used>=r.policy.startupRecoveryMinutes*60000){session.recovery='exhausted';return {recovered:false,reason:'startup_recovery_exhausted'};}
 r.activation.state='recovered';session.recovery='confirmed_failure';return {recovered:true};
}
export function endRentalSession(state,session,{at}){if(!sessions(state).includes(session))fail('Playback session unavailable');session.state='ended';session.endedAt=at;return session;}
export function revokeRentalSessions(state,entitlementId,{at}){
 for(const s of sessions(state).filter(s=>s.entitlementId===entitlementId)){s.state='revoked';s.revokedAt=at;}
 const pending=tickets(state).filter(t=>t.entitlementId===entitlementId&&t.state!=='revoked');for(const t of pending)t.state='revocation_pending';return pending;
}
export function markRentalTicketRevoked(state,{provider,key,at}){const t=tickets(state).find(t=>t.provider===provider&&t.key===key);if(!t)fail('Playback ticket unavailable');t.state='revoked';t.revokedAt=at;delete t.source;return t;}
export function rentalSessionProjection(e,session,at){return {sessionId:session.id,attemptId:session.attemptId,status:session.state==='active'&&time(at)>=time(e.rental.expiresAt)?'expired':session.state,expiresAt:e.rental.expiresAt,replayAllowed:e.rental.policy.replayAllowed};}
