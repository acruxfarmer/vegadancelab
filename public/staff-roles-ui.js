export const staffCan=(data,permission)=>data?.context?.role==='staff'&&data.staffAccess?.permissions?.includes(permission)===true;
export function staffRolesUI({getData,escape:e,mutate,notify}){
 function render(){
  const d=getData(),m=d.staffManagement,registration=d.staffRegistration;
  let html=`<section class="card"><h1>Staff access</h1><p>Your role: <strong>${e(d.staffAccess?.label||'Access needs review')}</strong> · ${e(d.context.name)}</p><p>Roles apply only within this business. Ask an Owner / Admin if your access needs changing.</p><button class="button secondary" data-refresh-booking>Refresh staff access</button></section>`;
  if(!registration?.registered&&!m?.people.some(p=>p.userId===d.context.userId))html+=`<form id="staff-register" class="card"><h2>Request owner review</h2><p>Your account already has staff membership. Register your name so the owner can recognize and assign you. This step grants no permissions.</p><label class="field">Your staff display name<input name="name" required maxlength="120"></label><button class="button">Register for owner review</button><p role="alert"></p></form>`;
  if(!m)return html;
  html+=`<section class="card"><h2>Roles in this business</h2><p>Refund execution and staff-role administration are assigned only to Owner / Admin in V1. Payment-provider access is separate.</p>${m.roles.map(r=>`<details><summary>${e(r.label)}</summary><ul>${r.permissions.map(p=>`<li>${e(p)}</li>`).join('')}</ul></details>`).join('')}</section><section class="card"><h2>Staff assignments</h2><p>Staff appear here after signing in with an existing business membership and registering for owner review. Display names are staff-provided; confirm the account with the person before granting authority.</p>${m.people.map(p=>`<form class="card" data-staff-role data-user="${e(p.userId)}" data-revision="${p.revision}"><h3>${e(p.name)}</h3><details><summary>Confirm account</summary><p>${e(p.userId)}</p></details><p>Current role: ${e(p.label)}</p><label class="field">Role for ${e(p.name)}<select name="role">${!p.role?'<option value="">Choose role</option>':''}${m.roles.map(r=>`<option value="${e(r.id)}" ${p.role===r.id?'selected':''}>${e(r.label)}</option>`).join('')}</select></label><fieldset data-staff-classes ${p.role==='instructor'?'':'hidden'}><legend>Assigned classes</legend><p>Only selected occurrences are accessible. New or duplicated classes must be assigned separately.</p>${d.classes.map(c=>`<label class="check"><input type="checkbox" name="classIds" value="${e(c.id)}" ${p.classIds.includes(c.id)?'checked':''}> ${e(c.title)} · ${e(c.startsAt)} · ${e(c.location)}</label>`).join('')||'<p>No classes are available.</p>'}</fieldset><button class="button secondary">Save role for ${e(p.name)}</button><p role="alert"></p></form>`).join('')}</section><section class="card"><h2>Staff access history</h2>${m.history.map(h=>`<p>${e(h.createdAt)} · ${e(h.action==='staff-role-set'?'Role updated':'Registered for review')} · ${e(m.people.find(p=>p.userId===h.subjectId)?.name||'Staff member')}${h.to?` · ${e(m.roles.find(r=>r.id===h.to)?.label)}`:''}</p>`).join('')||'<p>No staff role changes recorded yet.</p>'}</section>`;
  return html;
 }
 async function submit(f){
  if(f.dataset.pending)return;f.dataset.pending='true';const button=f.querySelector('button');button.disabled=true;
  try{const values=new FormData(f),register=f.id==='staff-register';
   await mutate(register?'/api/staff/register':'/api/staff/roles',register?{name:values.get('name')}:{userId:f.dataset.user,role:values.get('role'),classIds:values.get('role')==='instructor'?values.getAll('classIds'):[],expectedRevision:Number(f.dataset.revision)},()=>{});
   notify('Staff access saved. Review the current role and recovery confirmation.');
  }catch(error){if(f.isConnected)f.querySelector('[role="alert"]').textContent=error.message;}
  finally{delete f.dataset.pending;button.disabled=false;}
 }
 return {render,submit};
}
