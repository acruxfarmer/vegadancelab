// Read-only verification; no provider execution or business state writes.
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions,createApplicationStore} from '../../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../../src/staff-role-management.mjs';
import {digest} from '../../src/payments.mjs';
import {deskCustomer} from '../../public/front-desk-operations.js';
const owner=DEVELOPMENT_INITIAL_OWNERS[0],memberId='e5946b40-9839-4a96-99d5-93262d9573f0';
assert.equal(process.env.VEGA_ENV,'development');assert.equal(process.env.VEGA_EXTERNAL_EFFECTS,'disabled');assert.equal(process.env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
const store=createApplicationStore(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS});
try{
 const staff=await store.read(owner),member=await store.read(memberId),customer=deskCustomer(staff,'vega-member-test-joe');
 assert.equal(staff.staffAccess.role,'owner');assert.equal(customer.linked,true);assert.equal(customer.review,false);assert.equal(customer.profile.waiverStatus,member.customerProfile.waiverStatus);
 assert.equal(customer.available,member.memberAccount.available);assert.deepEqual(customer.purchases,member.purchaseDrafts);const refundFacts=rows=>rows.map(({id,purchaseId,amountMinor,currency,status,entitlementDisposition})=>({id,purchaseId,amountMinor,currency,status,entitlementDisposition}));assert.deepEqual(refundFacts(customer.refunds),refundFacts(member.refundHistory));assert.deepEqual(customer.passes,member.passes);const bookingFacts=rows=>rows.map(({id,participantId,classId,status,attendanceStatus,creditConsumption})=>({id,participantId,classId,status,attendanceStatus,creditConsumption}));assert.deepEqual(bookingFacts(customer.reservations),bookingFacts(member.reservations));
 await assert.rejects(store.read({...owner,businessId:'foreign-business'}),e=>e.status===403);await assert.rejects(store.read({...owner,tenantId:'foreign-tenant'}),e=>e.status===403);
 const c=await pool.connect();let revision,stateDigest;
 try{
  await c.query('begin isolation level repeatable read read only');await c.query("select set_config('vega.actor_id',$1,true)",[owner.userId]);
  const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',[owner.tenantId,owner.businessId])).rows[0];revision=Number(row.revision);stateDigest=digest(row.state);
  assert.equal(revision,155);assert.equal(stateDigest,'e8f54bb7504d8cbfa76a32e5753defdd8995110ba0c7e1fc7c26b5ceba7a5b69','Business records changed from closed 6.13');await c.query('commit');
 }finally{c.release();}
 console.log(JSON.stringify({build:process.env.RENDER_GIT_COMMIT,revision,stateDigest,checks:{owner:true,linkedCustomer:true,waiverAgreement:true,creditAgreement:true,purchaseAgreement:true,refundAgreement:true,passAgreement:true,bookingAttendanceAgreement:true,foreignBusinessDenied:true,foreignTenantDenied:true,unchangedBusinessState:true,paymentExecutionDisabled:true},customer:{passes:customer.passes.length,availableCredits:customer.available,bookings:customer.reservations.length,purchases:customer.purchases.length,refunds:customer.refunds.length,waiver:customer.profile.waiverStatus},production:'untouched'}));
}finally{await pool.end();}
