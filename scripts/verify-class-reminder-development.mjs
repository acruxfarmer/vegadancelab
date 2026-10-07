import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions,createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {bookingEmailMessage} from '../src/booking-email.mjs';
if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0'||process.env.BOOKING_EMAIL_DELIVERY==='enabled')throw Error('Disabled Development runtime required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL)),owner=DEVELOPMENT_INITIAL_OWNERS[0],store=createApplicationStore(pool,{bookingEmails:true,initialOwners:DEVELOPMENT_INITIAL_OWNERS}),original=await store.read(owner),c=await pool.connect();
try{
 await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[owner.userId]);
 const {rows}=await c.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',[owner.tenantId,owner.businessId]);
 const s=rows[0].state,r=s.reservations.find(x=>x.id==='d0802ae7-28d0-4007-a1a8-327a17c3bc2b'),course=s.classes.find(x=>x.id===r.classId),person=s.participants.find(x=>x.id===r.participantId);assert.equal(r.status,'reserved');
 course.startsAt=new Date(Date.now()+86400000-30000).toISOString();r.createdAt=new Date(Date.now()-86400000*2).toISOString();s.preferences=s.preferences.filter(x=>!(x.participantId===r.participantId&&x.purpose==='class_reminders'));
 const write=()=>c.query('update vega_private.app_state set state=$3::jsonb where tenant_id=$1 and business_id=$2',[owner.tenantId,owner.businessId,JSON.stringify(s)]);await write();
 const id=createHash('sha256').update(randomUUID()).digest('hex'),snapshot={className:course.title,startsAt:course.startsAt,instructor:course.instructor||'',memberName:person.name,status:'reserved',reminderWindow:'24h'};
 await c.query('select vega_private.enqueue_booking_email($1,$2,$3::jsonb)',[owner.tenantId,owner.businessId,JSON.stringify({id,reservationId:r.id,participantId:r.participantId,kind:'class_reminder',snapshot})]);
 // No network adapter is created. Business delivery configuration stays disabled.
 await c.query('select * from vega_private.claim_booking_email($1)',[randomUUID()]);
 let result=await c.query('select status from vega_private.booking_email_intents where id=$1',[id]);assert.equal(result.rows[0].status,'intent_created');
 s.preferences.push({participantId:r.participantId,channel:'email',purpose:'class_reminders',allowed:false});await write();
 await c.query('select * from vega_private.claim_booking_email($1)',[randomUUID()]);result=await c.query('select status from vega_private.booking_email_intents where id=$1',[id]);assert.equal(result.rows[0].status,'suppressed');
 await c.query('savepoint private_helper');await assert.rejects(c.query("select vega_private.class_reminder_snapshot('{}','x','x','x',now())"),/permission denied/);await c.query('rollback to savepoint private_helper');
 const access=await c.query("select current_user as role,has_table_privilege(current_user,'vega_private.booking_email_intents','INSERT,UPDATE,DELETE') as direct_write");assert.equal(access.rows[0].role,'vega_app_runtime');assert.equal(access.rows[0].direct_write,false);
 await c.query('rollback');const after=await store.read(owner);assert.equal(after.revision,original.revision);for(const k of ['classes','participants','reservations','passes','creditUnits','creditEvents','purchaseDrafts','refundHistory','preferences','bookingEmails'])assert.ok(JSON.stringify(after[k])===JSON.stringify(original[k]),k+' unchanged');
 console.log(JSON.stringify({verified:true,role:access.rows[0].role,eligibleReminderRetained:true,preferenceOffSuppresses:true,privateHelperDenied:true,directIntentWritesDenied:true,allStateUnchanged:true,rolledBack:true,externalMessages:0,delivery:process.env.BOOKING_EMAIL_DELIVERY}));
}finally{await c.query('rollback').catch(()=>{});c.release();await pool.end();}
