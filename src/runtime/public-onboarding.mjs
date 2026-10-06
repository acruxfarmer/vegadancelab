import {ApplicationError} from '../application.mjs';
import {buildRecoveryReceipt} from '../recovery-receipt.mjs';

export async function onboardPublicMember(pool,userId,body,publicKey,verifiedEmail){
 if(typeof verifiedEmail!=='string'||!verifiedEmail.length||verifiedEmail.length>254)throw new ApplicationError('Verified email required',403);
 if(Object.keys(body).some(k=>!['studio','displayName'].includes(k))||typeof body.studio!=='string'||! /^[a-z0-9][a-z0-9-]{0,79}$/.test(body.studio)||typeof body.displayName!=='string'||!body.displayName.trim()||body.displayName.length>120||/[\u0000-\u001f\u007f]/.test(body.displayName))throw new ApplicationError('Studio and your name are required',400);
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[userId]);
  const {rows}=await c.query('select vega_private.onboard_public_member($1,$2,$3) as result',[body.studio,body.displayName,verifiedEmail]);
  const r=rows[0]?.result;
  if(!r)throw new ApplicationError('Account setup unavailable',503);
  const result={status:r.status};
  if(['ready','existing_staff'].includes(r.status)){
   Object.assign(result,{tenantId:r.tenantId,businessId:r.businessId,...(r.participantId?{participantId:r.participantId}:{})});
   const requestId='public-self-onboarding-v1';
   if(r.created){
    const authority={userId,tenantId:r.tenantId,businessId:r.businessId,role:'member',participantIds:[r.participantId]};
    const receipt=buildRecoveryReceipt({before:r._before,after:r._after,revision:r._revision,authority,command:{action:'member-onboarding',body:{requestId}},result:{...result,membership:authority},occurredAt:new Date().toISOString(),publicKey});
    await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[r.tenantId,r.businessId,userId,requestId,'public-self-onboarding-v1',JSON.stringify(result)]);
    await c.query("insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,event_kind,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,'business',$6,$7,$8,$9)",[receipt.eventId,r.tenantId,r.businessId,userId,requestId,receipt.previousRevision,receipt.revision,receipt.payload,receipt.payloadDigest]);
   }
   const receipt=await c.query('select event_id,discovery_state from vega_private.recovery_outbox where tenant_id=$1 and business_id=$2 and actor_id=$3 and request_id=$4',[r.tenantId,r.businessId,userId,requestId]);
   if(receipt.rows[0])result.independentReceipt={operationId:receipt.rows[0].event_id,state:receipt.rows[0].discovery_state};
  }
  await c.query('commit');return result;
 }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
}
