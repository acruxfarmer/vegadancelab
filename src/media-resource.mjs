import {randomUUID} from 'node:crypto';
import {ApplicationError} from './application.mjs';

const fail=(message,status=400)=>{throw new ApplicationError(message,status);};
const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Unsupported resource fields');};
export function resourceOwner(value){
 fields(value,['kind','userId','tenantId','businessId']);
 if(value.kind==='user'&&text(value.userId,128)&&Object.keys(value).length===2)return {kind:'user',userId:value.userId};
 if(value.kind==='business'&&text(value.tenantId,128)&&text(value.businessId,128)&&Object.keys(value).length===3)return {kind:'business',tenantId:value.tenantId,businessId:value.businessId};
 fail('Valid resource owner required');
}
export function resourceSource(value){
 fields(value,['kind','provider','reference']);
 if(!['external_reference','managed_reference','legacy_video'].includes(value.kind)||!text(value.provider,80)||!text(value.reference,2048))fail('Valid media source reference required');
 // An opaque server-side reference, never a fetch URL or playback authorization.
 return {kind:value.kind,provider:value.provider,reference:value.reference};
}
export function newMediaResource(input,actorId,{id=randomUUID,now=()=>new Date().toISOString()}={}){
 fields(input,['owner','title','creator','source']);
 if(!text(input.title,160)||typeof input.creator!=='string'||input.creator.length>160||/[\u0000-\u001f]/.test(input.creator)||!text(actorId,128))fail('Valid resource metadata required');
 return {id:id(),mediaType:'video',owner:resourceOwner(input.owner),title:input.title.trim(),creator:input.creator.trim(),submittedBy:actorId,source:resourceSource(input.source),lifecycle:'active',revision:1,createdAt:now()};
}
export function archiveMediaResource(resource,expectedRevision,now=()=>new Date().toISOString()){
 if(resource.revision!==expectedRevision)fail('Resource changed. Refresh before saving.',409);
 if(resource.lifecycle==='archived')return structuredClone(resource);
 return {...structuredClone(resource),lifecycle:'archived',revision:resource.revision+1,archivedAt:now()};
}
export function editMediaResource(resource,expectedRevision,input,now=()=>new Date().toISOString()){
 fields(input,['title','creator']);
 if(resource.revision!==expectedRevision)fail('Resource changed. Refresh before saving.',409);
 if(resource.lifecycle!=='active')fail('Archived media cannot be edited',409);
 if(!text(input.title,160)||typeof input.creator!=='string'||input.creator.length>160||/[\u0000-\u001f]/.test(input.creator))fail('Valid resource metadata required');
 return {...structuredClone(resource),title:input.title.trim(),creator:input.creator.trim(),revision:resource.revision+1,updatedAt:now()};
}
// Compatibility identifiers are scoped. They never replace the canonical ID.
export const legacyMediaKey=({tenantId,businessId,videoId})=>JSON.stringify([tenantId,businessId,videoId]);
