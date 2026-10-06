import {createHash} from 'node:crypto';

const scoped=(r,a)=>r.tenantId===a.tenantId&&r.businessId===a.businessId;
const review='Needs Staff Review';
const hash=w=>createHash('sha256').update(JSON.stringify([w.tenantId,w.businessId,w.version,w.title,w.text,w.effectiveAt])).digest('hex');
const versions=(s,a)=>(s.waiverVersions||[]).filter(w=>scoped(w,a));
function current(s,a,at){return versions(s,a).filter(w=>Date.parse(w.effectiveAt)<=Date.parse(at)).sort((x,y)=>y.version-x.version)[0]||null;}
function linkage(s,a){
 if(a.role!=='member'||!a.userId||!a.tenantId||!a.businessId||a.participantIds?.length!==1)return null;
 const matches=s.participants.filter(p=>p.id===a.participantIds[0]);
 if(matches.length!==1)return null;
 const p=matches[0];if((p.tenantId&&p.tenantId!==a.tenantId)||(p.businessId&&p.businessId!==a.businessId))return null;
 const records=(s.customerProfiles||[]).filter(r=>scoped(r,a)&&(r.accountId===a.userId||r.participantId===p.id));
 if(records.length>1||records.some(r=>r.accountId!==a.userId||r.participantId!==p.id))return null;
 if((s.waiverAcceptances||[]).some(r=>scoped(r,a)&&(r.accountId===a.userId||r.participantId===p.id)&&(r.accountId!==a.userId||r.participantId!==p.id)))return null;
 return {participant:p,profile:records[0]||null};
}
const waiverStatus=(w,acceptances)=>!w?'No current waiver':acceptances.some(r=>r.waiverId===w.id&&r.contentDigest===w.contentDigest)?'Accepted':'Acceptance required';
export function customerProfileView(s,a,at){
 const w=current(s,a,at),all=versions(s,a),acceptances=(s.waiverAcceptances||[]).filter(r=>scoped(r,a));
 if(a.role==='staff')return {profileAdministration:{versions:structuredClone(all),latestVersion:Math.max(0,...all.map(x=>x.version)),currentWaiver:structuredClone(w),participants:s.participants.map(p=>{
  const rows=(s.customerProfiles||[]).filter(r=>scoped(r,a)&&r.participantId===p.id),history=acceptances.filter(r=>r.participantId===p.id);
  const conflict=rows.length>1||new Set([...rows.map(r=>r.accountId),...history.map(r=>r.accountId)]).size>1;
  return {participantId:p.id,name:p.name,profile:rows.length===1?structuredClone(rows[0]):null,status:conflict?review:rows.length?'Profile saved':'Profile not yet saved',waiverStatus:conflict?review:waiverStatus(w,history),acceptances:structuredClone(history)};
 })}};
 const link=linkage(s,a);if(!link)return {customerProfile:{status:review,message:'Your account must have one unambiguous participant relationship with this business. Contact the studio.'}};
 const own=acceptances.filter(r=>r.accountId===a.userId&&r.participantId===link.participant.id);
 return {customerProfile:{status:'ready',accountId:a.userId,tenantId:a.tenantId,businessId:a.businessId,participantId:link.participant.id,businessName:link.participant.name,revision:link.profile?.revision||0,fields:structuredClone(link.profile?.fields||{displayName:link.participant.name,contactEmail:'',phone:''}),currentWaiver:structuredClone(w),waiverStatus:waiverStatus(w,own),acceptances:structuredClone(own),acceptedVersions:structuredClone(all.filter(v=>own.some(r=>r.waiverId===v.id)))}};
}
export function customerProfileTransition(s,action,b,a,{id,now},fail){
 const keys=allowed=>{if(Object.keys(b).some(k=>!allowed.includes(k)))fail('Unsupported profile or waiver field',400);};
 const audit=(subjectId,details)=>{(s.activity??=[]).push({id:id(),action,tenantId:a.tenantId,businessId:a.businessId,actorId:a.userId,subjectId,requestId:b.requestId,createdAt:now(),...details});};
 if(action==='waiver-publish'){
  if(a.role!=='staff')fail('Staff access required',403);
  keys(['requestId','title','text','effectiveAt','expectedVersion']);
  const latest=Math.max(0,...versions(s,a).map(x=>x.version));
  if(b.expectedVersion!==latest)fail('Waiver versions changed. Refresh and review before publishing.',409);
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>160||typeof b.text!=='string'||!b.text.trim()||b.text.length>10000||typeof b.effectiveAt!=='string'||!Number.isFinite(Date.parse(b.effectiveAt)))fail('Waiver title, text and effective date required',400);
  const prior=versions(s,a).find(x=>x.version===latest);
  if(prior&&Date.parse(b.effectiveAt)<Date.parse(prior.effectiveAt))fail('New versions cannot take effect before prior versions',409);
  const w={id:id(),tenantId:a.tenantId,businessId:a.businessId,version:latest+1,title:b.title.trim(),text:b.text.trim(),effectiveAt:new Date(b.effectiveAt).toISOString(),publishedAt:now(),publishedBy:a.userId};w.contentDigest=hash(w);
  (s.waiverVersions??=[]).push(w);audit(w.id,{version:w.version,contentDigest:w.contentDigest});return w;
 }
 if(a.role!=='member')fail('Member self-service required',403);
 const link=linkage(s,a);if(!link)fail(review,409);
 if(b.participantId!==link.participant.id)fail('Participant authority required',403);
 if(action==='profile-update'){
  keys(['requestId','participantId','expectedRevision','displayName','contactEmail','phone']);
  if(b.expectedRevision!==(link.profile?.revision||0))fail('Profile changed. Refresh before saving.',409);
  const fields={};for(const [key,max] of [['displayName',120],['contactEmail',254],['phone',40]]){if(typeof b[key]!=='string'||b[key].length>max||/[\u0000-\u001f\u007f]/.test(b[key]))fail('Invalid profile information',400);fields[key]=b[key].trim();}
  if(!fields.displayName||(fields.contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contactEmail)))fail('Display name and valid contact email required',400);
  const changedFields=Object.keys(fields).filter(k=>fields[k]!==link.profile?.fields[k]);
  if(link.profile&&!changedFields.length)return {participantId:b.participantId,revision:link.profile.revision,outcome:'unchanged'};
  const p={tenantId:a.tenantId,businessId:a.businessId,accountId:a.userId,participantId:b.participantId,fields,revision:(link.profile?.revision||0)+1,updatedAt:now()};
  if(link.profile)Object.assign(link.profile,p);else(s.customerProfiles??=[]).push(p);
  audit(b.participantId,{revision:p.revision,changedFields});return {participantId:b.participantId,revision:p.revision,outcome:'saved'};
 }
 keys(['requestId','participantId','waiverId','contentDigest','accepted']);
 const w=current(s,a,now());
 if(!w||w.id!==b.waiverId||w.contentDigest!==b.contentDigest)fail('Waiver changed. Read the current version before accepting.',409);
 if(b.accepted!==true)fail('Explicit acceptance required',400);
 const existing=(s.waiverAcceptances||[]).find(r=>scoped(r,a)&&r.accountId===a.userId&&r.participantId===b.participantId&&r.waiverId===w.id);
 if(existing)return {acceptance:existing,outcome:'already_accepted'};
 const acceptance={id:id(),tenantId:a.tenantId,businessId:a.businessId,accountId:a.userId,participantId:b.participantId,waiverId:w.id,version:w.version,effectiveAt:w.effectiveAt,contentDigest:w.contentDigest,acceptedAt:now()};
 (s.waiverAcceptances??=[]).push(acceptance);audit(b.participantId,{acceptanceId:acceptance.id,waiverId:w.id,version:w.version,contentDigest:w.contentDigest});return {acceptance,outcome:'accepted'};
}
