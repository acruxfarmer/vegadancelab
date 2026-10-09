// Business authorization is resolved from membership plus explicit business-owned
// assignments. Authentication, provider credentials and display names grant nothing.
export const RENTAL_DELEGABLE_PERMISSIONS=Object.freeze(['rentals.extend','rentals.correct']);
export const PERMISSIONS=Object.freeze({
 'rentals.configure':'Configure rental offers and media availability',
 'rentals.extend':'Extend individual rental viewing time',
 'rentals.correct':'Reset, replace, grant complimentary or revoke rental access',
 'attendance.read':'View class rosters and attendance',
 'attendance.write':'Record and correct attendance',
 'bookings.manage':'Book, cancel, correct and promote bookings',
 'schedule.read':'View the schedule',
 'schedule.edit':'Create, edit and duplicate classes and cancellation policies',
 'schedule.cancel':'Cancel class occurrences',
 'history.read':'View occurrence and reservation history',
 'sales.manage':'Create and complete front-desk sales',
 'finance.read':'View purchase, payment and refund history',
 'refunds.manage':'Manage refunds and refund recovery',
 'customers.read':'View customer profiles and waiver status',
 'customers.manage':'Add participants and manage studio communications',
 'waivers.publish':'Publish required waiver versions',
 'entitlements.manage':'Configure products and issue or adjust credits',
 'reports.read':'View operational reports and audit history',
 'roles.manage':'Manage staff roles and class assignments'
});
// Approved V1 product policy. Refund authority is an explicit permission;
// the role mapping may vary in future business policy without changing checks.
export const ROLE_MODEL=Object.freeze({
 owner:{label:'Owner / Admin',permissions:Object.keys(PERMISSIONS)},
 manager:{label:'Manager',permissions:['rentals.extend','attendance.read','attendance.write','bookings.manage','schedule.read','schedule.edit','schedule.cancel','history.read','sales.manage','finance.read','customers.read','customers.manage','waivers.publish','entitlements.manage','reports.read']},
 front_desk:{label:'Front Desk',permissions:['attendance.read','attendance.write','bookings.manage','schedule.read','history.read','sales.manage','customers.read']},
 instructor:{label:'Instructor',permissions:['attendance.read','attendance.write','schedule.read','history.read']}
});
const same=(r,a)=>r.tenantId===a.tenantId&&r.businessId===a.businessId;
export function resolveStaffAccess(state,authority,{initialOwners=[]}={}){
 if(authority.role!=='staff')return null;
 const assignments=(state.staffRoleAssignments||[]).filter(r=>same(r,authority)&&r.userId===authority.userId);
 const initial=initialOwners.filter(r=>same(r,authority)&&r.userId===authority.userId);
 const assigned=assignments.length===1?assignments[0]:null;
 const role=assignments.length>1?null:assigned?.role??(assignments.length===0&&initial.length===1?'owner':null);
 const policy=Object.hasOwn(ROLE_MODEL,role)?ROLE_MODEL[role]:null;
 return {role:policy?role:null,label:policy?.label||'Access needs review',permissions:policy?[...new Set([...policy.permissions,...(Array.isArray(assigned?.rentalPermissions)?assigned.rentalPermissions.filter(p=>RENTAL_DELEGABLE_PERMISSIONS.includes(p)):[])])]:[],classIds:role==='instructor'&&Array.isArray(assigned?.classIds)?[...new Set(assigned.classIds)]:[],revision:assigned?.revision||0,tenantId:authority.tenantId,businessId:authority.businessId,userId:authority.userId};
}
export function hasStaffPermission(access,authority,permission){return !!access&&same(access,authority)&&access.userId===authority.userId&&access.permissions.includes(permission);}
export function requireStaffPermission(access,authority,permission,fail){
 if(!hasStaffPermission(access,authority,permission))fail(`Your staff role does not allow this action: ${PERMISSIONS[permission]||'unsupported operation'}. Ask your business owner for help.`,403);
}
const commandPermissions={
 'rental-offer-configure':'rentals.configure','rental-availability':'rentals.configure','rental-correct':'rentals.correct',
 'media-offer-attach':'sales.manage',
 attendance:'attendance.write',reserve:'bookings.manage',cancel:'bookings.manage','correct-cancellation':'bookings.manage',promote:'bookings.manage',
 class:'schedule.edit','edit-class':'schedule.edit','duplicate-class':'schedule.edit','class-policy':'schedule.edit','cancel-class':'schedule.cancel',
 'front-desk-sale':'sales.manage','entitlement-product':'entitlements.manage','issue-entitlement':'entitlements.manage','issue-credit':'entitlements.manage',
 participant:'customers.manage',preferences:'customers.manage','media-group-save':'customers.manage','media-organize':'customers.manage','media-save':'customers.manage','media-publish':'customers.manage','media-unpublish':'customers.manage',notification:'customers.manage','waiver-publish':'waivers.publish','staff-role-set':'roles.manage'
};
export function requireStaffCommand(state,command,authority,access,fail){
 if(authority.role!=='staff'){
  if(!['reserve','cancel','preferences','purchase-draft','profile-update','waiver-accept'].includes(command.action)&&!command.action.startsWith('payment-'))fail('Staff access required',403);
  return;
 }
 const permission=command.action==='rental-correct'&&command.body?.action==='extend'?'rentals.extend':command.action.startsWith('refund-')?'refunds.manage':command.action.startsWith('payment-')?'sales.manage':commandPermissions[command.action];
 requireStaffPermission(access,authority,permission,fail);
 if(command.action==='media-offer-attach')requireStaffPermission(access,authority,'customers.manage',fail);
 if(access.role==='instructor'&&command.action!=='rental-correct'){
  const r=state.reservations.find(x=>x.id===command.id),classId=r?.classId??command.body?.classId;
  if(!classId||!access.classIds.includes(classId)||!state.classes.some(c=>c.id===classId))fail('This class is not assigned to you. Ask your business owner for help.',403);
 }
}
export function visibleStaffData(view,authority,access){
 const result=structuredClone(view),allowed=p=>hasStaffPermission(access,authority,p);
 result.staffAccess=structuredClone(access);
 if(!['rentals.extend','rentals.correct','rentals.configure'].some(allowed))result.rentals=[];
 if(!allowed('schedule.read'))result.classes=[];
 if(!allowed('attendance.read')){result.reservations=[];result.participants=[];}
 if(access?.role==='instructor'){
  result.classes=result.classes.filter(c=>access.classIds.includes(c.id));
  const classes=new Set(result.classes.map(c=>c.id));result.reservations=result.reservations.filter(r=>classes.has(r.classId));
  const people=new Set(result.reservations.map(r=>r.participantId));result.participants=result.participants.filter(p=>people.has(p.id)).map(({id,name})=>({id,name}));
  // Attendance and roster facts are useful; entitlement, money and staff notes are not.
  result.reservations=result.reservations.map(({id,classId,participantId,status,attendanceStatus,attendanceRevision,attendanceHistory,createdAt,waitlistPosition})=>({id,classId,participantId,status,attendanceStatus,attendanceRevision,attendanceHistory,createdAt,waitlistPosition}));
 }
 if(!allowed('customers.read')){delete result.profileAdministration;result.preferences=[];result.notifications=[];}
 if(!allowed('bookings.manage')){result.passes=[];result.creditUnits=[];result.creditEvents=[];result.memberships=[];result.entitlementIssuances=[];delete result.staffAccount;result.bookingOptions=[];result.promotionOptions=[];}
 if(!allowed('entitlements.manage'))result.entitlementProducts=[];
 if(!allowed('schedule.edit')){result.classEditOptions=[];result.classDuplicateOptions=[];}
 if(!allowed('schedule.cancel'))result.classCancellationOptions=[];
 if(!allowed('sales.manage')){delete result.frontDesk;result.frontDeskCustomers=[];result.frontDeskOffers=[];}
 if(!allowed('finance.read')){
  result.purchaseDrafts=allowed('sales.manage')?(result.purchaseDrafts||[]).filter(p=>p.saleChannel==='front_desk'&&p.createdByStaffId===authority.userId):[];
  result.refundHistory=[];result.refundOperations=[];result.orders=[];result.jobs=[];
 }
 if(!allowed('reports.read'))result.activity=[];
 if(!allowed('sales.manage'))result.commerceOffers=[];
 if(!allowed('customers.manage')){result.preferences=[];result.notifications=[];result.videos=[];result.mediaGroups=[];}
 if(!allowed('finance.read')){
  result.reservations=result.reservations.map(({paymentStatus,refundStatus,...r})=>r);
  result.entitlementIssuances=[];
 }
 if(!access?.role){result.videos=[];result.events=[];result.products=[];}
 if(!allowed('sales.manage'))result.paymentExecution={enabled:false,purchaseId:null};
 if(!allowed('refunds.manage')){result.refundWorkflow={enabled:false,purchaseId:null};result.refundProgram={enabled:false,purchaseId:null};}
 if(!allowed('roles.manage')){delete result.staffRoleAssignments;delete result.staffDirectory;}
 return result;
}
// Command replies are another projection boundary, including idempotent replay.
// Attendance does not authorize returning a full reservation's financial facts.
export function staffCommandResult(result,a,access){
 if(a.role==='staff'&&result?.entitlementId&&Number.isInteger(result.revision)&&['rentals.extend','rentals.correct'].some(p=>hasStaffPermission(access,a,p)))return {entitlementId:result.entitlementId,revision:result.revision};
 if(a.role!=='staff'||hasStaffPermission(access,a,'finance.read'))return result;
 if(access?.role==='instructor'){
  const {id,classId,participantId,status,attendanceStatus,attendanceRevision,attendanceHistory,outcome}=result;
  return {id,classId,participantId,status,attendanceStatus,attendanceRevision,attendanceHistory,outcome};
 }
 const {paymentStatus,refundStatus,...rest}=result;
 // Own front-desk purchase/payment results are legitimate sale receipts.
 return result.saleChannel==='front_desk'||result.purchaseId?result:rest;
}
