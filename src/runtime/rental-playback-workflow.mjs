import {ApplicationError} from '../application.mjs';
import {reserveRentalPlayback,recordRentalTicket,confirmRentalPlayback,recoverRentalStartup,endRentalSession,markRentalTicketRevoked,rentalSessionProjection,requireRentalDelivery,requireRentalAccess,rentalAuthorizationDeadline} from './rental-playback.mjs';
import {createHash} from 'node:crypto';

const fail=message=>{throw new ApplicationError(message,409);};
const deviceHash=device=>createHash('sha256').update(device||'').digest('hex');
// deviceId comes from the server's authenticated HttpOnly device cookie. Provider
// observations are fetched here, never accepted from the request body.
export function createRentalPlaybackWorkflow({store,adapters}){
 const scopeFor=(actorId,entitlement,material)=>({businessOwned:material.resource.owner?.kind==='business'&&material.resource.owner.tenantId===entitlement.tenantId&&material.resource.owner.businessId===entitlement.businessId&&material.placement.context?.tenantId===entitlement.tenantId&&material.placement.context?.businessId===entitlement.businessId,actorId,entitlementId:entitlement.id,tenantId:entitlement.tenantId,businessId:entitlement.businessId,placementId:material.placement.id,resourceId:material.resource.id,bindingId:material.binding.id});
 const adapterFor=(material,scope)=>{const adapter=adapters[material.binding.provider],capabilities=adapter?.rentalCapabilitiesFor?.(scope)||adapter?.rentalCapabilities;requireRentalDelivery(capabilities);return {adapter,capabilities};};
 const check=(session,deviceId,input)=>{if(!session||session.deviceHash!==deviceHash(deviceId)||input.attemptId&&input.attemptId!==session.attemptId)fail('Playback session unavailable on this device');};
 return {
  async reconcilePending(actorId,context){
   const pending=await store.reconcile(actorId,context),failures=[];
   for(const ticket of pending){try{const adapter=adapters[ticket.provider];if(!adapter?.revoke)throw Error('Revocation unavailable');await adapter.revoke(ticket);await store.reconcile(actorId,context,{provider:ticket.provider,key:ticket.key});}catch{failures.push(ticket.sessionId);}}
   return {pending:failures.length,revoked:pending.length-failures.length};
  },
  async start(actorId,placementId,{sessionId,deviceId}){
   const reserved=await store.mutate(actorId,placementId,'reserve',{sessionId},({state,entitlement,material,at})=>{
    const verificationScope=scopeFor(actorId,entitlement,material),{adapter,capabilities}=adapterFor(material,verificationScope),session=reserveRentalPlayback(state,entitlement,{actorId,deviceId,sessionId,at,binding:material.binding,capabilities});
    const prior=(state.rentalPlaybackTickets||[]).find(t=>t.sessionId===session.id&&t.state==='active'&&Date.parse(t.expiresAt)>Date.parse(at)+5000);
    if(prior?.source)return {source:prior.source,rental:rentalSessionProjection(entitlement,session,at)};
    if(session.ticketIssuance==='unknown')fail('Playback ticket outcome requires reconciliation');
    // A durable reservation prevents a concurrent or restarted process issuing
    // another ticket after an uncertain provider response.
    session.ticketIssuance='unknown';
    if(capabilities.expiresAt)session.verificationReference=capabilities.evidenceReference;
    return {verificationScope,binding:material.binding,sessionId:session.id,attemptId:session.attemptId,deadlineAt:rentalAuthorizationDeadline(entitlement,session)};
   });
   if(reserved.source)return reserved;
   const {adapter}=adapterFor({binding:reserved.binding},reserved.verificationScope);
   let issued;
   try{issued=await adapter.authorize(reserved.binding,{rental:{verificationScope:reserved.verificationScope,sessionId:reserved.sessionId,attemptId:reserved.attemptId,deadlineAt:reserved.deadlineAt}});}
   catch(error){
    if(error.code!=='RENTAL_TICKET_REJECTED')throw error;
    return store.mutate(actorId,placementId,'issuance-rejected',{sessionId:reserved.sessionId},({state,entitlement,session,at})=>{
     check(session,deviceId,reserved);
     session.ticketIssuance='rejected';
     const result=recoverRentalStartup(state,entitlement,session,{at,evidence:{kind:'confirmed_startup_failure',attemptId:session.attemptId,reference:'provider-ticket-request-denied'}});
     return {...result,rental:rentalSessionProjection(entitlement,session,at)};
    });
   }
   try{return await store.mutate(actorId,placementId,'ticket',{sessionId:reserved.sessionId},({state,entitlement,session,material,at})=>{
    check(session,deviceId,reserved);
    requireRentalAccess(entitlement,at);
    adapterFor(material,scopeFor(actorId,entitlement,material));
    if(!['starting','active'].includes(session.state)||session.bindingId!==material.binding.id||session.assetRef!==material.binding.assetRef||session.assetRevision!==material.binding.revision)fail('Rental access revoked or changed');
    if(issued.kind!=='hls'||!issued.ticket?.key||Date.parse(issued.expiresAt)>Math.min(Date.parse(reserved.deadlineAt),Date.parse(rentalAuthorizationDeadline(entitlement,session))))fail('Provider returned an invalid rental ticket');
    const {ticket,...source}=issued;
    const stored=recordRentalTicket(state,session,{provider:reserved.binding.provider,key:ticket.key,expiresAt:issued.expiresAt,at});stored.source=source;
    session.ticketIssuance='confirmed';return {source,rental:rentalSessionProjection(entitlement,session,at)};
   });}catch(error){await adapter.revoke(issued.ticket).catch(()=>{});throw error;}
  },
  async confirm(actorId,placementId,input){
   const prepared=await store.mutate(actorId,placementId,'observe',input,({state,entitlement,session,material,at})=>{
    check(session,input.deviceId,input);adapterFor(material,scopeFor(actorId,entitlement,material));
    if(entitlement.state!=='active'||!['starting','active'].includes(session.state)||session.bindingId!==material.binding.id||session.assetRef!==material.binding.assetRef||session.assetRevision!==material.binding.revision)fail('Playback session unavailable');
    if(session.startedAt)return {rental:rentalSessionProjection(entitlement,session,at)};
    const ticket=(state.rentalPlaybackTickets||[]).findLast(t=>t.sessionId===session.id&&t.state==='active'&&Date.parse(t.expiresAt)>Date.parse(at));
    if(!ticket)fail('Playback ticket unavailable');return {verificationScope:scopeFor(actorId,entitlement,material),binding:material.binding,ticket,attemptId:session.attemptId};
   });
   if(prepared.rental)return prepared;
   const {adapter}=adapterFor({binding:prepared.binding},prepared.verificationScope);
   const evidence=await adapter.observePlayback?.(prepared.ticket,prepared.attemptId,prepared.binding);
   if(evidence?.kind!=='provider_authorization_plus_player_ack')return {pending:true,message:'Playback start is being reconciled.'};
   return store.mutate(actorId,placementId,'confirm',input,({state,entitlement,session,material,at})=>{check(session,input.deviceId,input);adapterFor(material,scopeFor(actorId,entitlement,material));if(session.bindingId!==material.binding.id||session.assetRef!==material.binding.assetRef||session.assetRevision!==material.binding.revision)fail('Playback asset changed');confirmRentalPlayback(state,entitlement,session,{at,evidence,playerAcknowledged:true});return {rental:rentalSessionProjection(entitlement,session,at)};});
  },
  async finish(actorId,placementId,input){
   const result=await store.mutate(actorId,placementId,'finish',input,({state,entitlement,session,at})=>{check(session,input.deviceId,input);endRentalSession(state,session,{at});for(const ticket of state.rentalPlaybackTickets||[])if(ticket.sessionId===session.id&&ticket.state!=='revoked')ticket.state='revocation_pending';return {rental:rentalSessionProjection(entitlement,session,at)};});
   try{await this.revokePending(actorId,placementId,input);}catch{ /* Durable pending tickets are reconciled on retry. */ }
   return result;
  },
  async recover(actorId,placementId,input){
   const prepared=await store.mutate(actorId,placementId,'recovery-observe',input,({state,entitlement,session,material})=>{check(session,input.deviceId,input);adapterFor(material,scopeFor(actorId,entitlement,material));return {verificationScope:scopeFor(actorId,entitlement,material),binding:material.binding,attemptId:session.attemptId,tickets:(state.rentalPlaybackTickets||[]).filter(t=>t.sessionId===session.id&&t.state!=='revoked')};});
   const {adapter}=adapterFor({binding:prepared.binding},prepared.verificationScope);
   const evidence=await adapter.observeStartupFailure?.(prepared.tickets,prepared.attemptId);
   if(evidence?.kind!=='confirmed_startup_failure')return {recovered:false,reason:'startup_outcome_unresolved'};
   for(const ticket of prepared.tickets){await adapter.revoke(ticket);await store.mutate(actorId,placementId,'ticket-revoked',input,({state,at})=>{markRentalTicketRevoked(state,{provider:ticket.provider,key:ticket.key,at});return {revoked:true};});}
   return store.mutate(actorId,placementId,'recover',input,({state,entitlement,session,at})=>{check(session,input.deviceId,input);return recoverRentalStartup(state,entitlement,session,{at,evidence});});
  },
  async revokePending(actorId,placementId,input){
   const pending=await store.mutate(actorId,placementId,'revoke',input,({state,session})=>{check(session,input.deviceId,input);return (state.rentalPlaybackTickets||[]).filter(t=>t.sessionId===session.id&&(t.state==='revocation_pending'||session.state==='revoked'&&t.state!=='revoked'));});
   for(const ticket of pending){const adapter=adapters[ticket.provider];if(!adapter?.revoke)continue;await adapter.revoke(ticket);await store.mutate(actorId,placementId,'ticket-revoked',input,({state,at})=>{markRentalTicketRevoked(state,{provider:ticket.provider,key:ticket.key,at});return {revoked:true};});}
   return {revoked:pending.length};
  }
 };
}
