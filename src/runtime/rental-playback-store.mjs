import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../application.mjs';
import {buildRecoveryReceipt,canonical,digest} from '../recovery-receipt.mjs';
import {hasEntitlementProvenance} from '../fulfillment.mjs';
import {createRentalTerms} from '../rental-policy.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
import {mediaAccessTarget} from '../media-commerce.mjs';

// Reuses the business aggregate lock and encrypted recovery outbox. Playback
// tickets remain server-only; ordinary responses contain projections only.
export function createRentalPlaybackStore(pool,{receiptPublicKey=process.env.RECEIPT_PUBLIC_KEY,now=()=>new Date().toISOString()}={}){
 async function persist(c,row,state,authority,operation,placementId,at){
  if(canonical(state)===canonical(row.state))return;
  if(!receiptPublicKey)throw new ApplicationError('Independent recovery capture unavailable',503);
  const command={action:'rental-playback-'+operation,body:{requestId:randomUUID(),placementId}},receipt=buildRecoveryReceipt({before:row.state,after:state,revision:row.revision,authority,command,result:{operation,placementId},occurredAt:at,publicKey:receiptPublicKey});
  await c.query('update vega_private.app_state set state=$1,revision=revision+1,updated_at=now() where tenant_id=$2 and business_id=$3',[JSON.stringify(state),authority.tenantId,authority.businessId]);
  await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[authority.tenantId,authority.businessId,authority.userId,command.body.requestId,digest(canonical(command)),JSON.stringify({operation,placementId})]);
  await c.query('insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[receipt.eventId,authority.tenantId,authority.businessId,authority.userId,command.body.requestId,receipt.previousRevision,receipt.revision,receipt.payload,receipt.payloadDigest]);
 }
 return {
  // Internal server reconciliation after an already authorized staff command.
  // No device token is needed to revoke access; scope is rechecked in storage.
  async reconcile(actorId,context,confirmed){
   const c=await pool.connect();try{
    await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[actorId]);
    const members=(await c.query("select role,participant_ids from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3",[actorId,context.tenantId,context.businessId])).rows;
    if(members.length!==1||members[0].role!=='staff')throw new ApplicationError('Staff reconciliation access required',403);
    const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',[context.tenantId,context.businessId])).rows[0];
    if(!row)throw new ApplicationError('Rental state unavailable',403);
    const state=structuredClone(row.state),at=now();
    const pending=(state.rentalPlaybackTickets||[]).filter(t=>{
     if(t.state==='revoked')return false;
     const s=state.rentalPlaybackSessions?.find(s=>s.id===t.sessionId),e=state.accessEntitlements?.find(e=>e.id===t.entitlementId);
     const availability=state.mediaAvailability?.find(a=>a.placementId===e?.target?.id&&a.tenantId===context.tenantId&&a.businessId===context.businessId);
     return t.state==='revocation_pending'||!s||!e||e.state!=='active'||['ended','revoked'].includes(s.state)||['suspended','withdrawn'].includes(availability?.status);
    });
    for(const ticket of pending){ticket.state='revocation_pending';if(confirmed?.provider===ticket.provider&&confirmed?.key===ticket.key){ticket.state='revoked';ticket.revokedAt=at;delete ticket.source;}}
    await persist(c,row,state,{...context,userId:actorId,role:'staff'},confirmed?'ticket-revoked':'revoke',null,at);
    await c.query('commit');return pending.filter(t=>t.state!=='revoked');
   }catch(error){await c.query('rollback').catch(()=>{});throw error;}finally{c.release();}
  },async mutate(actorId,placementId,operation,input,work){
  if(!actorId)throw new ApplicationError('Sign in to continue',401);
  const c=await pool.connect();
  try{
   await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[actorId]);
   const material=(await c.query('select media_private.native_viewer_material($1) as material',[placementId])).rows[0]?.material;
   const p=material?.placement;if(!p||!p.authorized||!p.visible||p.policy?.kind!=='pay_on_demand'||material.resource?.lifecycle!=='active')throw new ApplicationError('Protected rental media unavailable',403);
   const members=(await c.query('select role,participant_ids from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[actorId,p.context.tenantId,p.context.businessId])).rows;
   if(members.length!==1)throw new ApplicationError('Rental access unavailable',403);
   const authority={userId:actorId,role:members[0].role,participantIds:members[0].participant_ids,...p.context};
   const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',[authority.tenantId,authority.businessId])).rows[0];
   if(!row)throw new ApplicationError('Rental access unavailable',403);
   const state=structuredClone(row.state),at=now();
   const availability=state.mediaAvailability?.find(x=>x.placementId===p.id&&x.tenantId===authority.tenantId&&x.businessId===authority.businessId);
   if(['suspended','withdrawn'].includes(availability?.status)&&!['ticket-revoked','revoke'].includes(operation))throw new ApplicationError(availability.status==='suspended'?'This video is temporarily suspended':'This video has been withdrawn',403);
   const session=input.sessionId&&state.rentalPlaybackSessions?.find(s=>s.id===input.sessionId&&s.actorId===actorId);
   const entitlements=(state.accessEntitlements||[]).filter(e=>e.principalId===actorId&&e.tenantId===authority.tenantId&&e.businessId===authority.businessId&&equal(e.target,mediaAccessTarget(p))&&e.rental&&hasEntitlementProvenance(state,e));
   const e=session?entitlements.find(e=>e.id===session.entitlementId):entitlements.find(e=>e.state==='active'&&(!e.rental.expiresAt||Date.parse(e.rental.expiresAt)>Date.parse(at)))||entitlements[0];
   if(!e||input.sessionId&&!session)throw new ApplicationError('Rental access unavailable',403);
   if(!e.rental.availableAt&&material.binding?.state==='ready'&&(availability?.availableAt||material.binding.readyAt)&&!['suspended','withdrawn'].includes(availability?.status)){
    const dates=[availability?.availableAt,material.binding.readyAt].filter(Boolean).map(Date.parse);
    const terms=createRentalTerms(e.rental.policy,{grantedAt:e.createdAt,availableAt:new Date(Math.max(...dates)).toISOString()});
    e.rental.availableAt=terms.availableAt;e.rental.startBy=terms.startBy;
   }
   const result=await work({state,entitlement:e,session,material,authority,at});
   const previous=row.state.accessEntitlements?.find(previous=>previous.id===e.id);
   // Playback participates in the same optimistic revision used by staff
   // corrections. Session-only/no-op requests do not invalidate staff forms.
   if(previous&&canonical(e)!==canonical(previous))e.revision=(previous.revision||1)+1;
   await persist(c,row,state,authority,operation,placementId,at);
   await c.query('commit');return result;
  }catch(error){await c.query('rollback').catch(()=>{});throw error;}finally{c.release();}
 }};
}
