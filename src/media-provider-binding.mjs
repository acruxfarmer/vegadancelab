import {randomUUID} from 'node:crypto';
import {ApplicationError} from './application.mjs';

const fail=message=>{throw new ApplicationError(message,409);};
const states={pending:['uploading','failed','deleting'],uploading:['processing','failed','deleting'],processing:['ready','failed','deleting'],ready:['failed','deleting'],failed:['deleting'],deleting:['deleted'],deleted:[]};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\u0000-\u001f]/.test(v);
// Server-only binding. Provider identity and playback configuration never enter
// canonical ownership, placements, policy, or user-visible projections.
export function newMediaProviderBinding(resource,{provider,integrationRef},{id=randomUUID}={}){
 if(!resource?.id||resource.lifecycle!=='active'||resource.source?.kind!=='managed_reference')fail('Active managed resource required');
 if(!text(provider)||!text(integrationRef))fail('Provider integration required');
 return {id:id(),resourceId:resource.id,provider,integrationRef,assetRef:null,playbackRef:null,state:'pending',revision:1};
}
export function transitionMediaProviderBinding(binding,expectedRevision,state,{assetRef,playbackRef,durationSeconds,readyAt}={}){
 if(binding.revision!==expectedRevision)fail('Binding changed');
 if(!states[binding.state]?.includes(state))fail('Invalid binding transition');
 if(assetRef!==undefined&&(!text(assetRef)||binding.assetRef&&assetRef!==binding.assetRef))fail('Provider asset identity cannot change within a binding');
 if(playbackRef!==undefined&&!text(playbackRef))fail('Invalid playback reference');
 const next={...binding,state,revision:binding.revision+1};
 if(assetRef!==undefined)next.assetRef=assetRef;
 if(playbackRef!==undefined)next.playbackRef=playbackRef;
 if(durationSeconds!==undefined){if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>86400)fail('Invalid validated media duration');next.durationSeconds=durationSeconds;next.durationAssetRef=next.assetRef;}
 if(readyAt!==undefined){if(state!=='ready'||typeof readyAt!=='string'||!Number.isFinite(Date.parse(readyAt)))fail('Invalid readiness time');next.readyAt=new Date(readyAt).toISOString();}
 if(state==='ready'&&(!next.assetRef||!next.playbackRef))fail('Provider readiness and playback binding required');
 if(state==='deleted'){next.assetRef=null;next.playbackRef=null;delete next.durationSeconds;delete next.durationAssetRef;delete next.readyAt;}
 return next;
}
export function mediaBindingStatus(binding){return {state:binding.state,revision:binding.revision};}
export function requireReadyMediaBinding(resource,binding){
 if(resource?.lifecycle!=='active'||resource.id!==binding?.resourceId||binding.state!=='ready'||!binding.assetRef||!binding.playbackRef)fail('Native media is not ready');
 return binding;
}
