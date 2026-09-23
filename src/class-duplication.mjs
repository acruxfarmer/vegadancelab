import {createHash} from 'node:crypto';
import {classDetails} from './class-details.mjs';
import {createClass} from './class-creation.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function classDuplicateOption(c,at){
 const allowed=c.status==='open'&&Number.isFinite(Date.parse(c.startsAt))&&Date.parse(c.startsAt)>Date.parse(at);
 return {classId:c.id,allowed,versionToken:hash(c),reason:allowed?'Create one independent occurrence from these details.':'Only an upcoming open occurrence can be used as a starting point.'};
}
export function reviewClassDuplicate(state,body,authority,at,fail){
 if(authority.role!=='staff')fail('Staff access required',403);
 const source=state.classes.find(c=>c.id===body.classId);if(!source)fail('Class unavailable',404);
 const option=classDuplicateOption(source,at);
 if(!option.allowed)fail(option.reason,409);
 if(body.versionToken!==option.versionToken)fail('Source occurrence changed. Refresh and review again.',409);
 if(!body.details||typeof body.details!=='object'||Array.isArray(body.details))fail('Class details required');
 // Read the source at review AND at locked confirmation. Only canonical creation
 // fields enter the snapshot; staff can override them in the reviewed proposal.
 const sourceDetails=classDetails(source,fail);
 if(Object.keys(body.details).some(k=>!Object.hasOwn(sourceDetails,k)))fail('Unsupported occurrence creation field');
 if(!Object.hasOwn(body.details,'startsAt'))fail('Choose a new future start');
 const details=classDetails({...sourceDetails,...body.details},fail);
 if(Date.parse(details.startsAt)<=Date.parse(at)||details.startsAt===sourceDetails.startsAt)fail('Choose a new future start different from the source',409);
 const review={classId:source.id,versionToken:option.versionToken,sourceDetails,details};
 return {...review,reviewToken:hash({review,actorId:authority.userId,tenantId:authority.tenantId,businessId:authority.businessId})};
}
export function duplicateClass(state,body,authority,{id,now},fail){
 const at=now(),review=reviewClassDuplicate(state,body,authority,at,fail);
 if(body.reviewToken!==review.reviewToken)fail('Review the proposed occurrence before confirming creation.',409);
 const result=createClass(state,review.details,authority,{id,now:()=>at},fail),event=state.activity.at(-1);
 // Historical metadata only. No reads of this metadata influence class behavior.
 result.creationProvenance={id:event.id,action:'created-from-occurrence',sourceClassId:review.classId,classId:result.id,sourceVersion:review.versionToken,actorId:authority.userId,actorRole:authority.role,requestId:body.requestId,createdAt:at,sourceDetails:structuredClone(review.sourceDetails),details:structuredClone(review.details)};
 Object.assign(event,{sourceClassId:review.classId,actorRole:authority.role,creationProvenanceId:event.id});
 return result;
}
