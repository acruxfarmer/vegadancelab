import {randomUUID,createHash} from 'node:crypto';
import {customerProfileView} from './customer-profile.mjs';
import {ApplicationError} from './application.mjs';
export const MAX_VIDEO_BYTES=262144;
const fail=(m,s=400)=>{throw new ApplicationError(m,s)};
const scoped=(v,a)=>v.tenantId===a.tenantId&&v.businessId===a.businessId;
export function mediaEligible(state,a){return a.role==='member'&&customerProfileView(state,a).customerProfile?.status==='ready';}
export function mediaMetadata(v){const {id,title,description,creator,duration,publishState,businessId,tenantId,accessRequirement,revision}=v;return {id,title,description,creator,duration,publishState,businessId,tenantId,accessRequirement,revision,poster:'/media-poster.svg',assetAvailable:!!v.asset?.data};}
export function mediaView(state,a){return (state.videos||[]).filter(v=>scoped(v,a)&&(a.role==='staff'||mediaEligible(state,a)&&v.publishState==='published')).map(mediaMetadata);}
export function mediaTransition(original,command,a,{id=randomUUID,now=()=>new Date().toISOString()}={}){
 if(a.role!=='staff')fail('Staff access required',403);
 const b=command.body||{};if(typeof b.requestId!=='string'||!b.requestId.trim())fail('A request identifier is required');
 const state=structuredClone(original);state.videos??=[];
 let v=state.videos.find(v=>v.id===b.id&&scoped(v,a));
 if(b.id&&!v)fail('Media unavailable',404);
 if(v&&b.expectedRevision!==v.revision)fail('This video changed. Refresh before saving.',409);
 if(command.action==='media-save'){
  if(Object.keys(b).some(k=>!['requestId','id','expectedRevision','title','description','creator','duration','assetData'].includes(k)))fail('Unsupported media field');
  for(const [k,max] of [['title',160],['description',2000],['creator',160]])if(typeof b[k]!=='string'||b[k].length>max||/[\u0000-\u001f]/.test(b[k]))fail('Enter valid video details');
  if(!b.title.trim())fail('Give this video a title');
  if(b.duration!==null&&(!Number.isFinite(b.duration)||b.duration<=0||b.duration>3600))fail('Enter a valid duration');
  let asset=v?.asset;
  if(b.assetData!==undefined){
   if(typeof b.assetData!=='string'||b.assetData.length>Math.ceil(MAX_VIDEO_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.assetData))fail('Choose an MP4 video up to 256 KB');
   const bytes=Buffer.from(b.assetData,'base64');
   if(bytes.length<24||bytes.length>MAX_VIDEO_BYTES||bytes.toString('ascii',4,8)!=='ftyp'||bytes.toString('base64')!==b.assetData)fail('Choose a valid MP4 video up to 256 KB');
   asset={kind:'private-inline-mp4-v1',data:b.assetData,digest:createHash('sha256').update(bytes).digest('hex')};
  }
  if(!asset)fail('Attach an approved video before saving');
  if(!v){if(state.videos.length>=10)fail('Development library limit reached');v={id:id(),tenantId:a.tenantId,businessId:a.businessId,revision:0};state.videos.push(v);}
  Object.assign(v,{title:b.title.trim(),description:b.description.trim(),creator:b.creator.trim(),duration:b.duration,asset,publishState:'draft',accessRequirement:'linked_business_member'});
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
 if(v.asset?.kind!=='private-inline-mp4-v1'||!v.asset.data)fail('Video temporarily unavailable.',503);
 const bytes=Buffer.from(v.asset.data,'base64');
 if(bytes.length>MAX_VIDEO_BYTES||createHash('sha256').update(bytes).digest('hex')!==v.asset.digest)fail('Video temporarily unavailable.',503);
 return bytes;
}
