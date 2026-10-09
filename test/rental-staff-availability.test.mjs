import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStaffAccess,requireStaffCommand,staffCommandResult} from '../src/staff-permissions.mjs';
import {staffManagementTransition} from '../src/staff-role-management.mjs';
import {changeRentalAvailability,observeRentalAvailability,mayDiscoverRentalPlacement} from '../src/rental-management.mjs';
import {grantComplimentaryRental} from '../src/rental-entitlement.mjs';
const a={userId:'owner',role:'staff',tenantId:'tenant',businessId:'business',participantIds:[]},at='2026-10-09T00:00:00.000Z';
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};let serial=0;const clock={id:()=>`id-${++serial}`,now:()=>at};
const p={id:'placement',resourceId:'resource',authorized:true,context:{kind:'business',tenantId:a.tenantId,businessId:a.businessId}},r={id:p.resourceId,owner:p.context,lifecycle:'active'};
test('owner delegates sensitive rental correction without granting finance and instructor receives the minimal result',()=>{
 const s={classes:[],reservations:[],staffDirectory:[{...a,userId:'teacher',name:'Teacher'}],staffRoleAssignments:[{...a,role:'owner',revision:1},{...a,userId:'teacher',role:'instructor',revision:1,classIds:[]}]};
 const body={requestId:'delegate',userId:'teacher',role:'instructor',classIds:[],expectedRevision:1,rentalPermissions:['rentals.correct']};
 const changed=staffManagementTransition(s,{action:'staff-role-set',body},a,clock,fail),teacher={...a,userId:'teacher'},access=resolveStaffAccess(changed.state,teacher);
 requireStaffCommand(changed.state,{action:'rental-correct',body:{action:'revoke'}},teacher,access,fail);
 assert.equal(access.permissions.includes('finance.read'),false);
 assert.deepEqual(staffCommandResult({entitlementId:'grant',revision:2,paymentStatus:'paid',totalMinor:999,token:'secret'},teacher,access),{entitlementId:'grant',revision:2});
 assert.throws(()=>staffManagementTransition(changed.state,{action:'staff-role-set',body:{...body,expectedRevision:2}},teacher,clock,fail),/staff role/);
 assert.throws(()=>staffManagementTransition(s,{action:'staff-role-set',body:{...body,rentalPermissions:['rentals.configure']}},a,clock,fail),/supported rental/);
 assert.throws(()=>requireStaffCommand(changed.state,{action:'rental-correct',body:{action:'extend'}},teacher,access,fail),/staff role/);
 const history=changed.state.activity[0];assert.deepEqual(history.rentalPermissions,['rentals.correct']);assert.ok(history.previousPermissions);assert.equal(s.staffRoleAssignments[1].rentalPermissions,undefined);
});
test('unpublish retains sessions, suspension revokes delivery but preserves clocks, withdrawal blocks restoration',()=>{
 const e={id:'grant',...a,target:{kind:'media_placement',id:p.id},state:'active',rental:{startBy:'2026-11-09',expiresAt:'2026-10-11'}},foreign={placementId:p.id,tenantId:'other',businessId:a.businessId,status:'published',revision:5};
 const s={activity:[],accessEntitlements:[e],mediaAvailability:[foreign],rentalPlaybackSessions:[{id:'session',entitlementId:e.id,state:'active',deadlineAt:'2026-10-11'}],rentalPlaybackTickets:[{entitlementId:e.id,state:'issued'}]};
 const run=(availability,expectedRevision)=>changeRentalAvailability(s,{requestId:`a-${expectedRevision}`,placementId:p.id,availability,expectedRevision,reason:'Owner decision'},a,{placement:p,resource:r,binding:{state:'ready',readyAt:'2026-10-08T00:00:00Z'}},clock);
 run('unpublished',0);assert.equal(s.rentalPlaybackSessions[0].state,'active');assert.deepEqual(s.mediaAvailability.find(x=>x.tenantId==='other'),foreign);
 const terms=structuredClone(e.rental);run('suspended',1);assert.deepEqual(e.rental,terms);assert.equal(e.state,'active');assert.equal(s.rentalPlaybackTickets[0].state,'revocation_pending');assert.equal(s.rentalPlaybackSessions[0].state,'active');assert.equal(s.rentalPlaybackSessions[0].deadlineAt,'2026-10-11');
 run('published',2);assert.equal(s.mediaAvailability.find(x=>x.tenantId===a.tenantId).availableAt,'2026-10-08T00:00:00.000Z');assert.deepEqual(e.rental,terms);
 run('withdrawn',3);assert.equal(s.rentalPlaybackSessions[0].state,'revoked');assert.throws(()=>run('published',4),/withdrawn/);assert.equal(s.activity.length,4);assert.equal(s.activity[0].before.revision,0);assert.equal(s.activity[3].after.status,'withdrawn');
});
test('processing is not availability and delayed provider readiness moves the first availability forward',()=>{
 const s={activity:[]};assert.equal(observeRentalAvailability(s,p,{state:'processing'},at),null);assert.equal(s.mediaAvailability,undefined);
 observeRentalAvailability(s,p,{state:'ready',readyAt:'2026-10-08T00:00:00Z'},at);assert.equal(s.mediaAvailability[0].availableAt,'2026-10-08T00:00:00.000Z');
 observeRentalAvailability(s,p,{state:'ready',readyAt:'2026-10-08T12:00:00Z'},at);assert.equal(s.mediaAvailability[0].availableAt,'2026-10-08T12:00:00.000Z');
 const unready={activity:[]};changeRentalAvailability(unready,{requestId:'publish',placementId:p.id,availability:'published',expectedRevision:0,reason:'Schedule'},a,{placement:p,resource:r,binding:{state:'processing'}},clock);assert.equal(unready.mediaAvailability[0].availableAt,null);
 assert.throws(()=>changeRentalAvailability(s,{requestId:'bad',placementId:p.id,availability:'suspended',expectedRevision:0,reason:'Wrong resource'},a,{placement:p,resource:{...r,id:'other'}},clock),/Business-owned/);
});
test('unpublished media disappears from discovery but remains in the valid holder personal library',()=>{
 const s={activity:[],mediaAvailability:[{placementId:p.id,tenantId:a.tenantId,businessId:a.businessId,status:'unpublished',revision:1}]},holder={...a,userId:'holder',role:'member'},other={...holder,userId:'other'};
 assert.equal(mayDiscoverRentalPlacement(s,holder,p.id),false);
 const e=grantComplimentaryRental(s,{requestId:'grant',principalId:holder.userId,target:{...p.context,kind:'media_placement',id:p.id},rentalPolicy:{},reason:'Courtesy'},a,clock,fail);
 assert.equal(mayDiscoverRentalPlacement(s,holder,p.id),true);assert.equal(mayDiscoverRentalPlacement(s,other,p.id),false);
 e.state='revoked';assert.equal(mayDiscoverRentalPlacement(s,holder,p.id),false);e.state='active';s.activity=[];assert.equal(mayDiscoverRentalPlacement(s,holder,p.id),false);
 assert.equal(mayDiscoverRentalPlacement(s,a,p.id),true);
 assert.equal(mayDiscoverRentalPlacement(s,holder,'another-placement'),true);
});
