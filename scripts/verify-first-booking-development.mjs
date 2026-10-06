// Bounded Development verification through existing membership, command and receipt paths.
import assert from 'node:assert/strict';
import {createApplicationDatabase} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
const participantId='64a3edf5-ff0e-46b2-bdba-7e097eaaff8c',classId='ced0dba0-316b-4168-a3f1-f16d6fa43819',productId='5dcc7d89-2398-4b29-ba6e-f4e549d4e4f1';
if(process.env.VEGA_ENV!=='development'||process.env.VEGA_EXTERNAL_EFFECTS!=='disabled'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Development service required');
const store=createApplicationDatabase(process.env.APP_DATABASE_URL),owner=DEVELOPMENT_INITIAL_OWNERS[0];
try{
 const before=await store.read(owner),profile=before.profileAdministration.participants.find(p=>p.participantId===participantId)?.profile;
 assert.ok(profile?.accountId,'Established test member required');
 const member={...owner,userId:profile.accountId};
 if(process.argv.includes('--prepare')){
  const result=await store.command(owner,{action:'issue-entitlement',body:{requestId:'layer3-first-booking-test-credit-v1',participantId,productId,issuanceRef:'layer3-first-booking-test-credit-v1',reason:'Synthetic Development first-booking verification; no payment or sale'}});
  const after=await store.read(owner);
  for(const key of ['classes','reservations','purchaseDrafts','refundHistory','participants','profileAdministration'])assert.deepEqual(after[key],before[key],key+' changed');
  console.log(JSON.stringify({prepared:true,productId,participantId,quantity:result.quantity,receipt:result.independentReceipt,unrelatedRecordsUnchanged:true}));
 }else{
  const [m,s]=await Promise.all([store.read(member),store.read(owner)]),rows=m.reservations.filter(r=>r.classId===classId&&r.participantId===participantId&&r.status==='reserved');
  assert.equal(rows.length,1);const r=rows[0];assert.ok(r.creditConsumption);
  assert.deepEqual(s.reservations.find(x=>x.id===r.id),r);
  const units=m.creditUnits.filter(u=>u.passId===r.creditConsumption.passId);assert.equal(units.filter(u=>!u.sourceUnitId).length,3);assert.equal(units.filter(u=>u.status==='spent'&&u.spentByBookingId===r.id).length,1);assert.equal(units.filter(u=>u.status==='available').length,2);
  assert.equal(s.creditEvents.filter(e=>e.type==='consume'&&e.bookingId===r.id).length,1);
  assert.equal(m.classes.find(c=>c.id===classId).reservedCount,s.reservations.filter(r=>r.classId===classId&&r.status==='reserved').length);
  const revision=s.revision;
  await assert.rejects(store.command(member,{action:'reserve',body:{requestId:'layer3-first-booking-duplicate-check',participantId,classId}}),/Already booked/);
  assert.equal((await store.read(owner)).revision,revision);
  console.log(JSON.stringify({verified:true,reservationId:r.id,memberStaffAgree:true,capacityAgrees:true,creditsIssued:3,creditsSpent:1,creditsRemaining:2,duplicateRejectedWithoutMutation:true,recoveryPending:m.recovery.pendingCount,revision}));
 }
}finally{await store.close();}

