import {randomUUID,createHash} from 'node:crypto';
import {customerProfileView} from './customer-profile.mjs';
import {ApplicationError} from './application.mjs';
export const MAX_VIDEO_BYTES=262144;
const fail=(m,s=400)=>{throw new ApplicationError(m,s)};
const scoped=(v,a)=>v.tenantId===a.tenantId&&v.businessId===a.businessId;
export function mediaEligible(state,a){return a.role==='member'&&customerProfileView(state,a).customerProfile?.status==='ready';}
export function mediaMetadata(v){const {id,title,description,creator,duration,publishState,businessId,tenantId,accessRequirement,revision}=v;return {id,title,description,creator,duration,publishState,businessId,tenantId,accessRequirement,revision,categoryIds:[...(v.categoryIds||[])],collectionIds:[...(v.collectionIds||[])],poster:'/media-poster.svg',assetAvailable:!!v.asset?.data};}
export function mediaView(state,a){return (state.videos||[]).filter(v=>scoped(v,a)&&(a.role==='staff'||mediaEligible(state,a)&&v.publishState==='published')).map(mediaMetadata);}
export function mediaOrganization(state,a){return a.role==='staff'||mediaEligible(state,a)?(state.mediaGroups||[]).filter(g=>scoped(g,a)).map(({id,kind,name,description,revision})=>({id,kind,name,description,revision})):[];}
export function mediaTransition(original,command,a,{id=randomUUID,now=()=>new Date().toISOString()}={}){
 if(a.role!=='staff')fail('Staff access required',403);
 const b=command.body||{};if(typeof b.requestId!=='string'||!b.requestId.trim())fail('A request identifier is required');
 const state=structuredClone(original);state.videos??=[];
 if(command.action==='media-group-save'){
  if(Object.keys(b).some(k=>!['requestId','id','expectedRevision','kind','name','description'].includes(k)))fail('Unsupported organization field');
  if(!['category','collection'].includes(b.kind)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||/[\u0000-\u001f]/.test(b.name)||typeof b.description!=='string'||b.description.length>500||/[\u0000-\u001f]/.test(b.description))fail('Enter a name and valid description');
  state.mediaGroups??=[];let group=state.mediaGroups.find(g=>g.id===b.id&&scoped(g,a));
  if(b.id&&!group)fail('Library organization unavailable',404);
  if(group&&(group.kind!==b.kind||group.revision!==b.expectedRevision))fail('Library organization changed. Refresh before saving.',409);
  if(state.mediaGroups.some(g=>scoped(g,a)&&g.kind===b.kind&&g.id!==b.id&&g.name.toLowerCase()===b.name.trim().toLowerCase()))fail('That name already exists');
  if(!group){if(state.mediaGroups.filter(g=>scoped(g,a)).length>=40)fail('Library organization limit reached');group={id:id(),kind:b.kind,tenantId:a.tenantId,businessId:a.businessId,revision:0};state.mediaGroups.push(group);}
  Object.assign(group,{name:b.name.trim(),description:b.description.trim(),revision:group.revision+1});
  (state.activity??=[]).push({id:id(),action:command.action,subjectId:group.id,actorId:a.userId,tenantId:a.tenantId,businessId:a.businessId,createdAt:now()});
  return {state,result:mediaOrganization(state,a).find(g=>g.id===group.id)};
 }
 let v=state.videos.find(v=>v.id===b.id&&scoped(v,a));
 if(b.id&&!v)fail('Media unavailable',404);
 if(v&&b.expectedRevision!==v.revision)fail('This video changed. Refresh before saving.',409);
 if(command.action==='media-save'){
  if(Object.keys(b).some(k=>!['requestId','id','expectedRevision','title','description','creator','duration','assetData','assetSourceId'].includes(k)))fail('Unsupported media field');
  for(const [k,max] of [['title',160],['description',2000],['creator',160]])if(typeof b[k]!=='string'||b[k].length>max||/[\u0000-\u001f]/.test(b[k]))fail('Enter valid video details');
  if(!b.title.trim())fail('Give this video a title');
  if(b.duration!==null&&(!Number.isFinite(b.duration)||b.duration<=0||b.duration>3600))fail('Enter a valid duration');
  let asset=v?.asset;
  if(b.assetSourceId!==undefined){
   if(b.assetData!==undefined)fail('Choose one video source');
   const source=state.videos.find(x=>x.id===b.assetSourceId&&scoped(x,a));
   if(!source?.asset?.data)fail('Approved video source unavailable',404);
   asset=structuredClone(source.asset);
  }
  if(b.assetData!==undefined){
   if(typeof b.assetData!=='string'||b.assetData.length>Math.ceil(MAX_VIDEO_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.assetData))fail('Choose an MP4 video up to 256 KB');
   const bytes=Buffer.from(b.assetData,'base64');
   if(bytes.length<24||bytes.length>MAX_VIDEO_BYTES||bytes.toString('ascii',4,8)!=='ftyp'||bytes.toString('base64')!==b.assetData)fail('Choose a valid MP4 video up to 256 KB');
   asset={kind:'private-inline-mp4-v1',data:b.assetData,digest:createHash('sha256').update(bytes).digest('hex')};
  }
  if(!asset)fail('Attach an approved video before saving');
  if(!v){if(state.videos.length>=10)fail('Development library limit reached');v={id:id(),tenantId:a.tenantId,businessId:a.businessId,revision:0};state.videos.push(v);}
  Object.assign(v,{title:b.title.trim(),description:b.description.trim(),creator:b.creator.trim(),duration:b.duration,asset,publishState:'draft',accessRequirement:'linked_business_member'});
 }else if(command.action==='media-organize'){
  if(!v)fail('Media unavailable',404);
  if(Object.keys(b).some(k=>!['requestId','id','expectedRevision','categoryIds','collectionIds'].includes(k)))fail('Unsupported organization field');
  for(const [field,kind] of [['categoryIds','category'],['collectionIds','collection']]){
   if(!Array.isArray(b[field])||b[field].length>20||new Set(b[field]).size!==b[field].length||b[field].some(key=>typeof key!=='string'||!(state.mediaGroups||[]).some(g=>g.id===key&&g.kind===kind&&scoped(g,a))))fail('Choose categories and collections from this studio');
   v[field]=[...b[field]];
  }
 }else if(command.action==='media-publish'||command.action==='media-unpublish'){
  if(!v)fail('Media unavailable',404);
  if(Object.keys(b).some(k=>!['requestId','id','expectedRevision'].includes(k)))fail('Unsupported media field');
  if(!v.asset?.data)fail('Video asset unavailable',409);
  v.publishState=command.action==='media-publish'?'published':'draft';
 }else fail('Unsupported media action');
 v.revision++;v.updatedAt=now();
 (state.activity??=[]).push({id:id(),action:command.action,subjectId:v.id,actorId:a.userId,tenantId:a.tenantId,businessId:a.businessId,createdAt:now()});
 return {state,result:mediaMetadata(v)};
}
export function mediaPlayback(state,a,id,revision,staffAllowed=false){
 const v=(state.videos||[]).find(v=>v.id===id&&scoped(v,a));
 if(!v||(a.role==='staff'?!staffAllowed:!mediaEligible(state,a)||v.publishState!=='published'))fail('This video is unavailable for your account.',404);
 if(v.revision!==revision)fail('This video changed. Return to the library and open it again.',409);
 return mediaAssetBytes(v);
}
// Shared bounded asset integrity check. Authorization belongs to the caller's
// established legacy policy or canonical placement resolver.
export function mediaAssetBytes(v){
 if(v.asset?.kind!=='private-inline-mp4-v1'||!v.asset.data)fail('Video temporarily unavailable.',503);
 const bytes=Buffer.from(v.asset.data,'base64');
 if(bytes.length>MAX_VIDEO_BYTES||createHash('sha256').update(bytes).digest('hex')!==v.asset.digest)fail('Video temporarily unavailable.',503);
 return bytes;
}
