import {ApplicationError} from './application.mjs';

export const EXTERNAL_PAGE_SIZE=12;
export const externalProvider=p=>['vimeo','youtube'].includes(p);
export function externalMediaId(provider,id){
 if(typeof id!=='string'||!(provider==='vimeo'?/^[1-9][0-9]{0,19}$/:provider==='youtube'?/^[A-Za-z0-9_-]{11}$/:/$a/).test(id))throw new ApplicationError('Invalid provider media identity',400);
 return id;
}
export function externalPage(provider,value=''){
 if(typeof value!=='string'||value.length>512||(provider==='vimeo'?!/^(?:[1-9][0-9]{0,4})?$/.test(value):!/^[A-Za-z0-9_=-]*$/.test(value)))throw new ApplicationError('Invalid media page',400);
 return value;
}
export function externalPolicy(policy){
 if(!['public','memberships'].includes(policy?.kind))throw new ApplicationError('Protected paid access and rentals are unavailable for external video',400);
 return policy;
}
export function externalPresentation(provider,id){
 externalMediaId(provider,id);
 return {kind:'external',provider,id,url:provider==='youtube'?`https://www.youtube.com/embed/${id}`:`https://player.vimeo.com/video/${id}`};
}
export function providerItem(provider,raw,accountId,now=Date.now()){
 const text=(v,max)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').slice(0,max):'';
 let id,title,creator,eligible=false,status='restricted';
 if(provider==='youtube'){
  id=externalMediaId(provider,raw.id);
  if(raw.snippet?.channelId!==accountId)throw new ApplicationError('Media does not belong to the connected account',403);
  title=text(raw.snippet?.title,160);creator=text(raw.snippet?.channelTitle,160);
  eligible=raw.status?.privacyStatus==='public'&&raw.status?.embeddable===true&&raw.status?.uploadStatus==='processed'&&!raw.contentDetails?.regionRestriction&&raw.contentDetails?.contentRating?.ytRating!=='ytAgeRestricted'&&raw.snippet?.liveBroadcastContent==='none';
 }else{
  id=externalMediaId(provider,raw.uri?.replace(/^\/videos\//,''));
  if(raw.user?.uri!==accountId)throw new ApplicationError('Media does not belong to the connected account',403);
  title=text(raw.name,160);creator=text(raw.user?.name,160);
  eligible=raw.status==='available'&&raw.privacy?.view==='anybody'&&raw.privacy?.embed==='public';
 }
 if(!title)throw new ApplicationError('Provider metadata unavailable',502);
 if(eligible)status='eligible';
 return {provider,id,title,creator,status,eligible,checkedAt:new Date(now).toISOString()};
}
