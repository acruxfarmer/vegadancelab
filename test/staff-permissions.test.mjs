import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROLE_MODEL,PERMISSIONS,resolveStaffAccess,hasStaffPermission,requireStaffCommand,visibleStaffData} from '../src/staff-permissions.mjs';
const staff={userId:'staff-one',tenantId:'tenant-one',businessId:'business-one',role:'staff',participantIds:[]};
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
const fixture=role=>({staffRoleAssignments:[{...staff,role,classIds:['class-one'],revision:1}],classes:[{id:'class-one'},{id:'class-two'}],reservations:[{id:'booking-one',classId:'class-one',participantId:'person-one',status:'reserved',attendanceStatus:'not_recorded',paymentStatus:'paid',creditConsumption:{unitId:'sensitive-credit'}},{id:'booking-two',classId:'class-two',participantId:'person-two'}],participants:[{id:'person-one',name:'One',phone:'private'},{id:'person-two',name:'Two'}],purchaseDrafts:[{id:'sale-one',saleChannel:'front_desk',createdByStaffId:staff.userId},{id:'sale-other',saleChannel:'front_desk',createdByStaffId:'someone-else'}],refundHistory:[{id:'refund'}],refundOperations:[{id:'refund'}],orders:[{amount:6000}],jobs:[{paymentId:'provider'}],activity:[{action:'refund'}],passes:[{}],creditUnits:[{}],creditEvents:[{}],memberships:[{}],entitlementIssuances:[{}],entitlementProducts:[{}],preferences:[{}],notifications:[{}],profileAdministration:{participants:[{phone:'private'}]},frontDesk:{customers:[{id:'person-one'}]},paymentExecution:{enabled:true,purchaseId:'sale-one'}});
const command=(action,body={},id)=>({action,body,id});
test('membership alone grants no staff permission; approved initial owner is exact tenant/business/account',()=>{
 const empty=resolveStaffAccess({},staff);assert.equal(empty.permissions.length,0);
 const options={initialOwners:[staff]},owner=resolveStaffAccess({},staff,options);assert.equal(owner.role,'owner');assert.deepEqual(owner.permissions,Object.keys(PERMISSIONS));
 for(const changed of [{businessId:'other'},{tenantId:'other'},{userId:'other'}])assert.equal(resolveStaffAccess({},{...staff,...changed},options).permissions.length,0);
 assert.equal(resolveStaffAccess({},{...staff,role:'member'},options),null);
});
test('four roles express supported actions with owner-only refunds and role administration',()=>{
 for(const role of Object.keys(ROLE_MODEL)){const s=fixture(role),a=resolveStaffAccess(s,staff);assert.equal(hasStaffPermission(a,staff,'refunds.manage'),role==='owner');assert.equal(hasStaffPermission(a,staff,'roles.manage'),role==='owner');assert.equal(hasStaffPermission(a,staff,'sales.manage'),role!=='instructor');assert.equal(hasStaffPermission(a,staff,'schedule.edit'),['owner','manager'].includes(role));assert.equal(hasStaffPermission(a,staff,'finance.read'),['owner','manager'].includes(role));}
});
test('denied staff commands fail with understandable explanations; member behavior unchanged',()=>{
 const s=fixture('front_desk'),a=resolveStaffAccess(s,staff);
 for(const action of ['refund-program-intent','refund-program-dispatch','edit-class','waiver-publish','issue-credit','staff-role-set','unknown-operation'])assert.throws(()=>requireStaffCommand(s,command(action),staff,a,fail),e=>e.status===403&&e.message.includes('Your staff role'));
 for(const action of ['front-desk-sale','reserve','cancel','promote','payment-prepare'])assert.doesNotThrow(()=>requireStaffCommand(s,command(action),staff,a,fail));
 assert.doesNotThrow(()=>requireStaffCommand(s,command('reserve'),{...staff,role:'member'},null,fail));
});
test('instructors can modify only explicitly assigned class attendance',()=>{
 const s=fixture('instructor'),a=resolveStaffAccess(s,staff);
 assert.doesNotThrow(()=>requireStaffCommand(s,command('attendance',{},'booking-one'),staff,a,fail));
 assert.throws(()=>requireStaffCommand(s,command('attendance',{},'booking-two'),staff,a,fail),/not assigned/);
 assert.throws(()=>requireStaffCommand(s,command('promote',{},'booking-one'),staff,a,fail),/staff role/);
 const v=visibleStaffData(s,staff,a);assert.deepEqual(v.classes,[{id:'class-one'}]);assert.deepEqual(v.participants,[{id:'person-one',name:'One'}]);assert.equal(v.reservations.length,1);assert.equal(v.reservations[0].paymentStatus,undefined);assert.equal(v.reservations[0].creditConsumption,undefined);assert.deepEqual(v.purchaseDrafts,[]);assert.deepEqual(v.refundHistory,[]);assert.equal(v.profileAdministration,undefined);assert.equal(v.frontDesk,undefined);assert.deepEqual(v.activity,[]);
});
test('front desk sees its own sale receipts but no financial history, refund records or reports',()=>{
 const s=fixture('front_desk'),v=visibleStaffData(s,staff,resolveStaffAccess(s,staff));assert.deepEqual(v.purchaseDrafts,[s.purchaseDrafts[0]]);for(const key of ['refundHistory','refundOperations','orders','jobs','activity'])assert.deepEqual(v[key],[]);assert.equal(v.refundProgram.enabled,false);assert.ok(v.profileAdministration);
});
test('one user has distinct roles in two businesses; roles cannot be carried across scopes',()=>{
 const other={...staff,businessId:'business-two'},s=fixture('manager');s.staffRoleAssignments.push({...other,role:'instructor',classIds:['class-two'],revision:1});
 const one=resolveStaffAccess(s,staff),two=resolveStaffAccess(s,other);assert.equal(one.role,'manager');assert.equal(two.role,'instructor');assert.equal(hasStaffPermission(one,other,'schedule.edit'),false);assert.deepEqual(two.classIds,['class-two']);
});
test('role changes are read from current state; conflicting or unsupported assignments fail closed',()=>{
 const s=fixture('manager');assert.equal(resolveStaffAccess(s,staff).role,'manager');s.staffRoleAssignments[0].role='front_desk';s.staffRoleAssignments[0].revision++;assert.equal(resolveStaffAccess(s,staff).permissions.includes('schedule.edit'),false);
 s.staffRoleAssignments.push({...s.staffRoleAssignments[0],role:'owner'});assert.equal(resolveStaffAccess(s,staff).permissions.length,0);s.staffRoleAssignments=[{...staff,role:'made-up',permissions:['refunds.manage']}];assert.equal(resolveStaffAccess(s,staff).permissions.length,0);
});
