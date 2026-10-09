import {ApplicationError} from '../application.mjs';
import {playbackPolicy,requireBumperOwnership,resolvePlaybackSequence} from '../media-playback-policy.mjs';
import {createNativeMediaDelivery} from './native-media-delivery.mjs';
import {createMediaViewerStore,requireMediaDecision} from './media-viewer-store.mjs';
import {requireReadyMediaBinding} from '../media-provider-binding.mjs';
import {mediaAssetBytes} from '../media.mjs';

export async function configurePlaybackPolicy(tx,placementId,expectedRevision,input){
 const p=await tx.get(placementId);
 if(!p||!await tx.canManageBusiness(p.context))throw new ApplicationError('Context media management required',403);
 if(!p.authorized||!await tx.resourceActive(p.id))throw new ApplicationError('Placement is inactive',409);
 const policy=playbackPolicy(input);
 for(const ref of Object.values(policy))requireBumperOwnership(p,await tx.resource(ref.resourceId));
 return tx.savePlaybackPolicy(p,expectedRevision,policy);
}

export function createPlaybackPolicyDelivery(pool,{adapters={}}={}){
 return async(viewerId,placementId,stage,revision)=>{
  const c=await pool.connect();
  try{
   await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[viewerId||'']);
   const nested={connect:async()=>({release(){},query:(sql,args)=>['begin','commit','rollback'].includes(sql)?Promise.resolve({rows:[]}):c.query(sql,args)})};
   const native=createNativeMediaDelivery(nested,{adapters}),legacy=createMediaViewerStore(nested);
   const primary=await native.resolve(viewerId,placementId)??await legacy.describe(viewerId,placementId);
   requireMediaDecision(primary); // DENY stops before any policy or bumper material lookup.
   const material=(await c.query('select media_private.playback_policy_material($1) as material',[placementId])).rows[0]?.material;
   if(!material)throw new ApplicationError('Playback unavailable',409);
   const sequence=resolvePlaybackSequence({decision:primary.decision,placement:material.placement,policy:material.policy});
   let result;
   if(stage===undefined)result={revision:material.revision,stages:sequence.map(x=>x.stage)};
   else{
    if(revision!==material.revision||!sequence.some(x=>x.stage===stage))throw new ApplicationError('Playback policy changed. Reopen this video.',409);
    if(stage==='PRIMARY')result=await native.resolve(viewerId,placementId,true)??await legacy.play(viewerId,placementId);
    else{
     const ref=sequence.find(x=>x.stage===stage).reference,item=material.sources[ref.resourceId];
     const resource=requireBumperOwnership(material.placement,item?.resource);
     if(resource.source.kind==='managed_reference'){
      requireReadyMediaBinding(resource,item.binding);
      const adapter=adapters[item.binding.provider];if(!adapter)throw new ApplicationError('Media delivery temporarily unavailable',503);
      result=await adapter.authorize(item.binding);
     }else if(resource.source.kind==='legacy_video'&&item.video?.publishState==='published')result=mediaAssetBytes(item.video);
     else throw new ApplicationError('Media delivery temporarily unavailable',503);
    }
   }
   await c.query('commit');return result;
  }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
 };
}
