import {randomUUID} from 'node:crypto';
import {bookingEmailIntents,bookingEmailMessage,emailStateLabel} from '../booking-email.mjs';
import {createResendBookingAdapter} from './providers/resend-booking.mjs';

export async function enqueueBookingEmails(client,before,after,authority,command){
 for(const intent of bookingEmailIntents(before,after,authority,command)){
  await client.query('select vega_private.enqueue_booking_email($1,$2,$3::jsonb)',[authority.tenantId,authority.businessId,JSON.stringify(intent)]);
 }
}
export async function readBookingEmails(client,authority){
 const {rows}=await client.query('select reservation_id,participant_id,kind,status,created_at from vega_private.booking_email_intents where tenant_id=$1 and business_id=$2 order by created_at,id',[authority.tenantId,authority.businessId]);
 return rows.filter(r=>authority.role==='staff'||authority.participantIds.includes(r.participant_id)).map(r=>({reservationId:r.reservation_id,participantId:r.participant_id,kind:r.kind,status:r.status,label:emailStateLabel(r.status),createdAt:r.created_at}));
}
export async function deliverBookingEmail(pool,adapter){
 const lease=randomUUID(),{rows}=await pool.query('select * from vega_private.claim_booking_email($1)',[lease]);
 if(!rows.length)return {processed:0};
 const row=rows[0];
 // Payload was durably frozen before the first network attempt.
 const outcome=await adapter.send(row.message,`booking-email/${row.id}`);
 await pool.query('select vega_private.finish_booking_email($1,$2,$3,$4,$5)',[row.id,lease,outcome.state,outcome.providerId||null,outcome.reason||null]);
 return {processed:1,state:outcome.state};
}
export async function prepareBookingEmails(pool){
 const {rows}=await pool.query('select * from vega_private.pending_booking_email_messages()');
 for(const row of rows){
  let message=null;
  try{message=bookingEmailMessage({kind:row.kind,snapshot:row.snapshot,recipient:row.recipient},row.configuration);}catch{}
  await pool.query('select vega_private.prepare_booking_email($1,$2::jsonb)',[row.id,message?JSON.stringify(message):null]);
 }
}
export function startBookingEmailDelivery(pool,env){
 if(env.VEGA_ENV!=='development'||env.BOOKING_EMAIL_DELIVERY!=='enabled'||!env.RESEND_API_KEY)return async()=>{};
 const adapter=createResendBookingAdapter(env.RESEND_API_KEY);let stopped=false,timer,running;
 async function tick(){try{await prepareBookingEmails(pool);await deliverBookingEmail(pool,adapter);}catch{console.error('Booking email processing needs attention');}if(!stopped)timer=setTimeout(()=>{running=tick();},5000);}
 running=tick();return async()=>{stopped=true;clearTimeout(timer);await running;};
}
