import test from 'node:test';
import assert from 'node:assert/strict';
import {createRentalTerms} from '../src/rental-policy.mjs';
import {reserveRentalPlayback,recordRentalTicket,confirmRentalPlayback,recoverRentalStartup,endRentalSession,revokeRentalSessions,markRentalTicketRevoked} from '../src/runtime/rental-playback.mjs';
import {createScaleEngineDelivery} from '../src/runtime/providers/scaleengine-delivery.mjs';
import {transitionMediaProviderBinding} from '../src/media-provider-binding.mjs';
import {applyRentalAvailability,rentalViewerProjection} from '../src/media-viewer-access.mjs';
const at='2026-10-09T12:00:00.000Z',deviceId='a'.repeat(48),later=ms=>new Date(Date.parse(at)+ms).toISOString();
const capabilities={protectedHls:true,rentalAccessVerified:true,evidenceReference:'synthetic-test-only'};
function fixture(policy={}){
 const e={id:'e',principalId:'viewer',state:'active',rental:createRentalTerms({viewingHours:1,...policy},{grantedAt:at,availableAt:at})},state={},binding={id:'binding',state:'ready',assetRef:'/asset.mp4',revision:3,durationSeconds:7200,durationAssetRef:'/asset.mp4'};let i=0;
 const options={actorId:'viewer',deviceId,at,binding,capabilities,id:()=>`id-${++i}`};
 return {e,state,binding,options};
}
function begin(f){const s=reserveRentalPlayback(f.state,f.e,f.options);recordRentalTicket(f.state,s,{provider:'fake',key:'key',expiresAt:later(120000),at});return s;}
function confirm(f,s,when=at){return confirmRentalPlayback(f.state,f.e,s,{at:when,playerAcknowledged:true,evidence:{kind:'provider_authorization_plus_player_ack',attemptId:s.attemptId,ticketKey:'key',reference:'server-test-observation'}});}
test('one pending activation across requests; other device cannot mint parallel window',()=>{
 const f=fixture(),s=begin(f),id=f.e.rental.activation.id;
 assert.equal(reserveRentalPlayback(f.state,f.e,f.options),s);assert.equal(f.state.rentalPlaybackSessions.length,1);assert.equal(f.e.rental.activation.id,id);
 assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,deviceId:'b'.repeat(48)}),/reconciled/);
 assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,actorId:'other'}),/unavailable/);
});
test('ticket issuance and browser playing alone do not activate',()=>{
 const f=fixture(),s=begin(f);
 assert.equal(f.e.rental.expiresAt,null);
 for(const evidence of [undefined,{kind:'ticket_issued'},{kind:'provider_permission_granted',attemptId:s.attemptId,reference:'x',ticketKey:'key'}])assert.throws(()=>confirmRentalPlayback(f.state,f.e,s,{at,playerAcknowledged:true,evidence}),/not yet confirmed/);
 assert.equal(f.e.rental.activation.confirmedAt,null);confirm(f,s);assert.equal(f.e.rental.expiresAt,later(3600000));
 confirm(f,s,later(2000));assert.equal(f.e.rental.expiresAt,later(3600000));
});
test('expiration denies fresh authorization for new and persisted sessions',()=>{
 const f=fixture(),s=begin(f);confirm(f,s);assert.equal(s.deadlineAt,undefined);
 const restored=JSON.parse(JSON.stringify(f.state));restored.rentalPlaybackSessions[0].deadlineAt=later(7800000);
 for(const input of [{},{sessionId:s.id},{deviceId:'b'.repeat(48)}])assert.throws(()=>reserveRentalPlayback(restored,f.e,{...f.options,...input,at:later(3600000)}),/expired/);
 assert.equal(f.e.rental.expiresAt,later(3600000));
 assert.equal(reserveRentalPlayback(restored,f.e,{...f.options,sessionId:s.id,at:later(3599999)}).id,s.id);
});

test('active-window replay restriction, ended session and revocation enforced',()=>{
 const f=fixture({replayAllowed:false});f.binding.durationSeconds=20000;const s=begin(f);confirm(f,s);
 assert.equal(s.deadlineAt,undefined);
 assert.equal(reserveRentalPlayback(f.state,f.e,f.options),s);
 assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,deviceId:'b'.repeat(48)}),/Replay/);
 const pending=revokeRentalSessions(f.state,f.e.id,{at:later(1000)});assert.equal(pending[0].state,'revocation_pending');
 assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,sessionId:s.id}),/no longer available/);
 const g=fixture(),gs=begin(g);confirm(g,gs);endRentalSession(g.state,gs,{at:later(1000)});assert.throws(()=>reserveRentalPlayback(g.state,g.e,{...g.options,sessionId:gs.id}),/no longer available/);
});
test('recovery requires server failure and confirmed revocation, retains activation history and budget',()=>{
 const f=fixture(),s=begin(f),activationId=f.e.rental.activation.id;
 const input={at:later(120000),evidence:{kind:'confirmed_startup_failure',attemptId:s.attemptId,reference:'server-observed-failure'}};
 assert.throws(()=>recoverRentalStartup(f.state,f.e,s,{...input,evidence:{kind:'client_error'}}),/reconciliation/);
 assert.throws(()=>recoverRentalStartup(f.state,f.e,s,input),/confirmed revocation/);
 markRentalTicketRevoked(f.state,{provider:'fake',key:'key',at:later(110000)});
 assert.deepEqual(recoverRentalStartup(f.state,f.e,s,input),{recovered:true});
 const s2=reserveRentalPlayback(f.state,f.e,{...f.options,at:later(120000)});assert.notEqual(s.id,s2.id);assert.equal(f.e.rental.activation.id,activationId);assert.equal(f.e.rental.activation.attempts.length,2);
 assert.equal(f.e.rental.recoveryUsedMs,120000);
 assert.deepEqual(recoverRentalStartup(f.state,f.e,s2,{at:later(600000),evidence:{kind:'confirmed_startup_failure',attemptId:s2.attemptId,reference:'server-failure'}}),{recovered:false,reason:'startup_recovery_exhausted'});
 assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,at:later(600001)}),/exhausted/);
});
test('ready asset and delivery capability required; ScaleEngine does not advertise unproven enforcement',async()=>{
 const f=fixture();assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,binding:{...f.binding,state:'processing'}}),/unavailable/);
 const adapter=createScaleEngineDelivery({environment:'development',cdnId:'1',apiSecret:'test'},()=>{throw Error('No external request permitted');});
 assert.throws(()=>reserveRentalPlayback(f.state,f.e,{...f.options,capabilities:adapter.rentalCapabilities}),/verification/);
 await assert.rejects(adapter.authorize(f.binding,{rental:{deadlineAt:later(1000)}}),/verification/);
});
test('readiness retains exact asset duration, and release allowance uses persisted actual availability',()=>{
 const ready=transitionMediaProviderBinding({id:'b',state:'processing',revision:3,assetRef:'file.mp4'},3,'ready',{playbackRef:'protected',durationSeconds:123.4,readyAt:at});
 assert.equal(ready.durationAssetRef,'file.mp4');assert.equal(ready.durationSeconds,123.4);assert.equal(ready.readyAt,at);
 assert.throws(()=>transitionMediaProviderBinding({state:'processing',revision:3},3,'ready',{assetRef:'x',playbackRef:'x',durationSeconds:-1}),/duration/);
 const context={tenantId:'t',businessId:'b'},p={id:'p',context},e={id:'e',state:'active',principalId:'viewer',...context,createdAt:later(-86400000),target:{kind:'media_placement',id:'p',...context},rental:createRentalTerms({},{grantedAt:later(-86400000)}),corrections:[{operation:'extend',at,reason:'Internal staff detail'}]};
 const state={accessEntitlements:[e]};applyRentalAvailability(state,p,ready);assert.equal(e.rental.availableAt,at);assert.equal(e.rental.startBy,later(30*86400000));
 const projection=rentalViewerProjection({state,placement:p,viewerId:'viewer',authority:{userId:'viewer',...context},at});assert.equal(projection.entitlementId,'e');assert.equal(projection.status,'ready_to_start');assert.equal(JSON.stringify(projection).includes('Internal staff'),false);
 assert.equal(rentalViewerProjection({state,placement:p,viewerId:'other',authority:{userId:'other',...context},at}),null);
});
