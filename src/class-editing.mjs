import {createHash} from 'node:crypto';
import {classDetails} from './class-details.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function classEditOption(state,c,at){
 let reason='Only an upcoming open occurrence with no reservation, waitlist or attendance history can be edited.';
 const allowed=c.status==='open'&&Number.isFinite(Date.parse(c.startsAt))&&Date.parse(c.startsAt)>Date.parse(at)&&!state.reservations.some(r=>r.classId===c.id);
 if(state.reservations.some(r=>r.classId===c.id))reason='Reservation, waitlist or attendance history exists, including cancelled history. This occurrence cannot be edited.';
 return {classId:c.id,allowed,reason:allowed?'Review changes before confirming this occurrence edit.':reason,versionToken:hash(c)};
}
export function reviewClassEdit(state,body,authority,at,fail){
 if(authority.role!=='staff')fail('Staff access required',403);
 const c=state.classes.find(c=>c.id===body.classId);if(!c)fail('Class unavailable',404);
 const option=classEditOption(state,c,at);
 if(!option.allowed)fail(option.reason,409);
 if(body.versionToken!==option.versionToken)fail('Occurrence changed. Refresh and review the edit again.',409);
 if(!body.details||typeof body.details!=='object'||Array.isArray(body.details))fail('Class details required');
 const before=classDetails(c,fail),after=classDetails(body.details,fail);
 if(Object.keys(body.details).some(k=>!Object.hasOwn(after,k)))fail('Unsupported occurrence edit field');
 if(Date.parse(after.startsAt)<=Date.parse(at))fail('The edited occurrence must remain upcoming',409);
 const changes=Object.keys(after).filter(k=>before[k]!==after[k]).map(field=>({field,before:before[field],after:after[field]}));
 if(!changes.length)fail('No occurrence changes to review');
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(!reason||body.reason.length>1000)fail('An occurrence edit reason is required');
 const review={classId:c.id,versionToken:option.versionToken,before,after,changes,reason};
 return {...review,reviewToken:hash({review,actorId:authority.userId,tenantId:authority.tenantId,businessId:authority.businessId})};
}
export function editClass(state,body,authority,{id,now},fail){
 const at=now(),review=reviewClassEdit(state,body,authority,at,fail);
 if(body.reviewToken!==review.reviewToken)fail('Review the proposed changes before confirming this occurrence edit.',409);
 const c=state.classes.find(c=>c.id===body.classId),eventId=id();
 Object.assign(c,review.after);
 (c.editHistory??=[]).push({id:eventId,action:'occurrence-edited',actorId:authority.userId,actorRole:authority.role,requestId:body.requestId,createdAt:at,reason:review.reason,before:review.before,after:review.after});
 state.activity.push({id:id(),action:'edit-class',subjectId:c.id,actorId:authority.userId,actorRole:authority.role,createdAt:at,classEditEventId:eventId});
 return {classId:c.id,eventId,outcome:'applied'};
}
