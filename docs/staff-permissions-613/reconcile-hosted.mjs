// Read-only Development reconciliation using the existing restricted app role.
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions,createApplicationStore} from '../../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../../src/staff-role-management.mjs';
import {PERMISSIONS} from '../../src/staff-permissions.mjs';
import {digest} from '../../src/payments.mjs';
const owner=DEVELOPMENT_INITIAL_OWNERS[0],memberId='e5946b40-9839-4a96-99d5-93262d9573f0';
const baseline='4f63de07fac41b25dddfb09350df6fcb9501873937e3b8d6c484b79b942eeb3e';
assert.equal(process.env.VEGA_ENV,'development');assert.equal(process.env.VEGA_EXTERNAL_EFFECTS,'disabled');assert.equal(process.env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
const store=createApplicationStore(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS});
try{
 const staff=await store.read(owner),member=await store.read(memberId);
 assert.equal(staff.staffAccess.role,'owner');assert.deepEqual(staff.staffAccess.permissions,Object.keys(PERMISSIONS));assert.equal(member.staffAccess,undefined);assert.equal(member.customerProfile.waiverStatus,'Accepted');
 await assert.rejects(store.read({...owner,businessId:'foreign-business'}),e=>e.status===403);
 await assert.rejects(store.read({...owner,tenantId:'foreign-tenant'}),e=>e.status===403);
 for(const key of ['purchaseDrafts','passes','creditUnits','reservations'])for(const row of member[key])assert.ok(staff[key].some(r=>r.id===row.id));
 assert.deepEqual(member.purchaseDrafts,staff.purchaseDrafts.filter(p=>p.buyerId===memberId));
 assert.deepEqual(member.creditUnits,staff.creditUnits.filter(p=>member.context.participantIds.includes(p.participantId)));
 const c=await pool.connect();let result;
 try{
  await c.query('begin isolation level repeatable read read only');await c.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[owner.userId]);
  const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',[owner.tenantId,owner.businessId])).rows[0],s=row.state;
  const unrelated=structuredClone(s);delete unrelated.staffRoleAssignments;delete unrelated.staffDirectory;unrelated.activity=unrelated.activity.filter(a=>!['staff-register','staff-role-set'].includes(a.action));
  assert.equal(digest(unrelated),baseline,'Unrelated business records changed');
  const receipts=(await c.query("select event_id,discovery_state,revision from vega_private.recovery_outbox where tenant_id=$1 and business_id=$2 and actor_id=$3 and revision>154 order by revision",[owner.tenantId,owner.businessId,owner.userId])).rows;
  assert.ok(receipts.every(r=>r.discovery_state==='acknowledged'));
  if(process.argv[2]==='final'){assert.equal(s.staffRoleAssignments.filter(r=>r.userId===owner.userId&&r.role==='owner').length,1);assert.equal(receipts.length,1);}
  result={phase:process.argv[2]||'before',build:process.env.RENDER_GIT_COMMIT,revision:row.revision,stateDigest:digest(s),ownerRole:staff.staffAccess,staffAssignments:staff.staffManagement.people,member:{waiverStatus:member.customerProfile.waiverStatus,profileRevision:member.customerProfile.revision,passes:member.passes.length,credits:member.creditUnits.length,bookings:member.reservations.length,purchases:member.purchaseDrafts.length,refunds:member.refundHistory.length},foreignBusinessAndTenantDenied:true,staffMemberFactsAgree:true,unrelatedStateMatchesRevision154:true,unrelatedDigest:digest(unrelated),receipts,audit:s.activity.filter(a=>['staff-register','staff-role-set'].includes(a.action)),paymentExecution:process.env.VEGA_SANDBOX_PAYMENT_EXECUTION};
  await c.query('commit');
 }finally{c.release();}
 console.log(JSON.stringify(result));
}finally{await pool.end();}
