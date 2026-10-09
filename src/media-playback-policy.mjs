import {ApplicationError} from './application.mjs';
const fail=()=>{throw new ApplicationError('Playback policy unavailable',409);};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export function playbackPolicy(value={}){
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['preRoll','postRoll'].includes(k)))fail();
 const result={};
 for(const slot of ['preRoll','postRoll'])if(value[slot]!==undefined){
  const ref=value[slot];
  if(!ref||Object.keys(ref).length!==2||ref.kind!=='media_resource'||!uuid(ref.resourceId))fail();
  result[slot]={kind:'media_resource',resourceId:ref.resourceId};
 }
 return result;
}
export function requireBumperOwnership(placement,resource){
 const o=resource?.owner,c=placement?.context;
 if(!c||o?.kind!=='business'||o.tenantId!==c.tenantId||o.businessId!==c.businessId||resource.lifecycle!=='active')fail();
 return resource;
}
// No entitlement evaluation here. The caller must supply the current L6-S2 decision.
// Viewer/context rules can later influence this resolver without adding entitlements.
export function resolvePlaybackSequence({decision,placement,policy}){
 if(decision?.allowed!==true)return [];
 const p=playbackPolicy(policy);
 return [...(p.preRoll?[{stage:'PRE_ROLL',reference:p.preRoll}]:[]),{stage:'PRIMARY',reference:{kind:'media_resource',resourceId:placement.resourceId}},...(p.postRoll?[{stage:'POST_ROLL',reference:p.postRoll}]:[])];
}
