import {randomUUID} from 'node:crypto';
import {ROLE_MODEL,PERMISSIONS,RENTAL_DELEGABLE_PERMISSIONS,resolveStaffAccess,requireStaffPermission} from './staff-permissions.mjs';
const scoped=(r,a)=>r.tenantId===a.tenantId&&r.businessId===a.businessId;
// Explicit Joe + Chett approval, 6.13. This is deployment policy, not a generic
// default staff role. A stored assignment always supersedes this initial grant.
export const DEVELOPMENT_INITIAL_OWNERS=Object.freeze([{tenantId:'vega-development',businessId:'vega-dance-lab',userId:'4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',name:'Joe Graham'}]);
export function staffManagementView(state,a,initialOwners=[]){
 const access=resolveStaffAccess(state,a,{initialOwners});
 const own=(state.staffDirectory||[]).filter(r=>scoped(r,a)&&r.userId===a.userId);
 const result={staffRegistration:{registered:own.length===1,name:own.length===1?own[0].name:''}};
 if(!access?.permissions.includes('roles.manage'))return result;
 const directory=(state.staffDirectory||[]).filter(r=>scoped(r,a));
 const roots=initialOwners.filter(r=>scoped(r,a));
 const ids=[...new Set([...directory,...roots,...(state.staffRoleAssignments||[]).filter(r=>scoped(r,a))].map(r=>r.userId))];
 result.staffManagement={roles:Object.entries(ROLE_MODEL).map(([id,r])=>({id,label:r.label,permissions:r.permissions.map(p=>PERMISSIONS[p])})),people:ids.map(userId=>{
  const records=directory.filter(r=>r.userId===userId),root=roots.find(r=>r.userId===userId);
  const resolved=resolveStaffAccess(state,{...a,userId},{initialOwners});
  return {userId,name:records.length===1?records[0].name:root?.name||'Staff record needs review',registered:records.length===1||!!root,...resolved,rentalPermissions:[...((state.staffRoleAssignments||[]).find(r=>scoped(r,a)&&r.userId===userId)?.rentalPermissions||[])]};
 }),history:(state.activity||[]).filter(r=>scoped(r,a)&&['staff-register','staff-role-set'].includes(r.action))};
 return result;
}
export function staffManagementTransition(original,command,a,{initialOwners=[],id=randomUUID,now=()=>new Date().toISOString()}={},fail){
 if(a.role!=='staff')fail('Staff membership required',403);
 const s=structuredClone(original),b=command.body||{},access=resolveStaffAccess(s,a,{initialOwners});
 const scope={tenantId:a.tenantId,businessId:a.businessId};
 let result;
 if(command.action==='staff-register'){
  if(Object.keys(b).some(k=>!['requestId','name'].includes(k))||typeof b.name!=='string'||!b.name.trim()||b.name.length>120||/[\u0000-\u001f\u007f]/.test(b.name))fail('Enter your staff display name',400);
  const existing=(s.staffDirectory||[]).filter(r=>scoped(r,a)&&r.userId===a.userId);
  if(existing.length>1)fail('Staff record needs owner review',409);
  if(existing.length)fail('Your staff name is already registered',409);
  result={...scope,userId:a.userId,name:b.name.trim(),registeredAt:now()};
  (s.staffDirectory??=[]).push(result);
 }else{
  requireStaffPermission(access,a,'roles.manage',fail);
  if(Object.keys(b).some(k=>!['requestId','userId','role','classIds','expectedRevision','rentalPermissions'].includes(k))||typeof b.userId!=='string'||!Object.hasOwn(ROLE_MODEL,b.role))fail('Choose a supported staff role',400);
  const directory=(s.staffDirectory||[]).filter(r=>scoped(r,a)&&r.userId===b.userId);
  const root=initialOwners.filter(r=>scoped(r,a)&&r.userId===b.userId);
  if(directory.length>1||(!root.length&&directory.length!==1))fail('This person must first sign in with existing staff membership and register for owner review',409);
  const target={...a,userId:b.userId},rows=(s.staffRoleAssignments||[]).filter(r=>scoped(r,a)&&r.userId===b.userId);
  if(rows.length>1)fail('Conflicting assignments need staff review',409);
  if(b.expectedRevision!==(rows[0]?.revision||0))fail('This staff role changed. Refresh and review before saving.',409);
  if(!Array.isArray(b.classIds)||b.classIds.length>500||new Set(b.classIds).size!==b.classIds.length||b.classIds.some(c=>typeof c!=='string'||!s.classes.some(x=>x.id===c))||(b.role!=='instructor'&&b.classIds.length))fail('Choose valid assigned classes for an Instructor',400);
  const rentalPermissions=b.rentalPermissions??[];
  if(!Array.isArray(rentalPermissions)||new Set(rentalPermissions).size!==rentalPermissions.length||rentalPermissions.some(p=>!RENTAL_DELEGABLE_PERMISSIONS.includes(p)))fail('Choose supported rental permissions',400);
  const before=resolveStaffAccess(s,target,{initialOwners});
  if(before.role==='owner'&&b.role!=='owner'){
   const candidates=new Set([...initialOwners,...(s.staffRoleAssignments||[])].filter(r=>scoped(r,a)).map(r=>r.userId));
   if(![...candidates].some(userId=>userId!==b.userId&&resolveStaffAccess(s,{...a,userId},{initialOwners}).role==='owner'))fail('Keep at least one Owner / Admin for this business.',409);
  }
  result={...scope,userId:b.userId,role:b.role,classIds:[...b.classIds],rentalPermissions:[...rentalPermissions],revision:(rows[0]?.revision||0)+1,updatedAt:now(),updatedBy:a.userId};
  if(rows.length)Object.assign(rows[0],result);else(s.staffRoleAssignments??=[]).push(result);
  result={...result,previousRole:before.role};
 }
 (s.activity??=[]).push({id:id(),action:command.action,...scope,actorId:a.userId,subjectId:result.userId,requestId:b.requestId,createdAt:now(),...(command.action==='staff-role-set'?{from:result.previousRole,to:result.role,classIds:result.classIds,rentalPermissions:result.rentalPermissions,previousPermissions:access.userId===result.userId?access.permissions:resolveStaffAccess(original,{...a,userId:result.userId},{initialOwners})?.permissions,revision:result.revision}:{})});
 return {state:s,result};
}
