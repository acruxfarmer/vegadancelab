// Real restricted runtime; every business transition and intent rolls back.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions,createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0'||process.env.BOOKING_EMAIL_DELIVERY==='enabled')throw Error('Disabled Development email runtime required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL)),owner=DEVELOPMENT_INITIAL_OWNERS[0],participantId='64a3edf5-ff0e-46b2-bdba-7e097eaaff8c';
const store=createApplicationStore(pool,{bookingEmails:true,initialOwners:DEVELOPMENT_INITIAL_OWNERS});
const original=await store.read(owner),profile=original.profileAdministration.participants.find(p=>p.participantId===participantId)?.profile;
assert.ok(profile?.accountId);const member={...owner,userId:profile.accountId},c=await pool.connect();let checked=0;
const rollbackPool={connect:async()=>({release(){},query:async(sql,args)=>{
 if(sql==='begin')return {rows:[]};
 if(sql==='commit'){await c.query('set constraints all immediate');checked++;return {rows:[]};}
 return c.query(sql,args);
}})};
const testing=createApplicationStore(rollbackPool,{bookingEmails:true,initialOwners:DEVELOPMENT_INITIAL_OWNERS});
const command=async(actor,action,body={},id)=>testing.command(actor,{action,...(id?{id}:{}),body:{...body,requestId:randomUUID()}});
try{
 await c.query('begin');
 const course=await command(owner,'class',{title:'Movement practice',instructor:'Studio team',location:'Studio',category:'Movement',startsAt:new Date(Date.now()+86400000*3).toISOString(),duration:60,capacity:1,creditRequired:false,waitlistEnabled:true,cancellationCutoffMinutes:90});
 const first=await command(member,'reserve',{classId:course.id,participantId});
 await command(member,'cancel',{},first.id);
 const again=await command(member,'reserve',{classId:course.id,participantId});
 await command(member,'cancel',{},again.id);
 const other=original.participants.find(p=>p.id!==participantId);assert.ok(other);
 const full=await command(owner,'reserve',{classId:course.id,participantId:other.id});
 const waiting=await command(member,'reserve',{classId:course.id,participantId,waitlistOnly:true});
 assert.equal(waiting.status,'waitlisted');
 await command(owner,'cancel',{},full.id);
 await command(owner,'promote',{},waiting.id);
 const m=await testing.read(member),s=await testing.read(owner),emails=m.bookingEmails.filter(x=>[first.id,again.id,waiting.id].includes(x.reservationId));
 for(const kind of ['booking_confirmation','booking_cancellation','rebooking_confirmation','waitlist_promotion'])assert.ok(emails.some(x=>x.kind===kind),kind);
 assert.ok(emails.every(x=>x.status==='intent_created'));assert.equal(emails.length,5);
 assert.deepEqual(s.bookingEmails.filter(x=>[first.id,again.id,waiting.id].includes(x.reservationId)),emails);
 assert.equal(m.reservations.find(r=>r.id===waiting.id).status,'reserved');
 await c.query('savepoint forbidden_lookup');
 await assert.rejects(c.query("select * from vega_private.booking_email_recipient('vega-development','vega-dance-lab',$1)",[participantId]),/permission denied/);
 await c.query('rollback to savepoint forbidden_lookup');
 const permissions=await c.query("select current_user as role,has_table_privilege(current_user,'vega_private.booking_email_intents','INSERT,UPDATE,DELETE') as direct_write,has_column_privilege(current_user,'vega_private.booking_email_intents','recipient','SELECT') as recipient_read");
 assert.equal(permissions.rows[0].role,'vega_app_runtime');assert.equal(permissions.rows[0].direct_write,false);assert.equal(permissions.rows[0].recipient_read,false);
 await c.query('rollback');
 const after=await store.read(owner);assert.equal(after.revision,original.revision);
 for(const key of ['classes','participants','reservations','passes','creditUnits','creditEvents','purchaseDrafts','refundHistory','preferences','bookingEmails'])assert.deepEqual(after[key],original[key],key);
 console.log(JSON.stringify({verified:true,allFourLifecycleKinds:true,memberStaffAgree:true,verifiedRecipientRequired:true,privateLookupDenied:true,directDeliveryWritesDenied:true,recoveryConstraintsChecked:checked,rolledBack:true,businessRevisionUnchanged:after.revision,externalMessages:0}));
}finally{await c.query('rollback').catch(()=>{});c.release();await pool.end();}
