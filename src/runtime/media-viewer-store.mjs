import {resolveMediaViewerAccess} from '../media-viewer-access.mjs';
import {mediaAssetBytes} from '../media.mjs';
import {ApplicationError} from '../application.mjs';

// The material lookup locks the placement, resource and published source until
// this transaction ends. No cached grant or caller-supplied source is accepted.
export async function resolveMediaOnClient(client,viewerId,placementId,{at=new Date().toISOString(),observe=()=>{}}={}){
 const {rows}=await client.query('select media_private.viewer_material($1) as material',[placementId]);
 const material=rows[0]?.material,p=material?.placement;
 let authority,state;
 if(p?.policy?.kind==='memberships'&&viewerId){
  const memberships=await client.query('select role,participant_ids from vega_private.app_members where user_id::text=$1 and tenant_id=$2 and business_id=$3',[viewerId,p.context.tenantId,p.context.businessId]);
  if(memberships.rows.length===1){
   const m=memberships.rows[0];authority={userId:viewerId,role:m.role,participantIds:m.participant_ids,...p.context};
   const s=await client.query('select state from vega_private.app_state where tenant_id=$1 and business_id=$2 for share',[p.context.tenantId,p.context.businessId]);state=s.rows[0]?.state;
  }
 }
 let result=resolveMediaViewerAccess({placement:p,resourceAvailable:!!material?.video,viewerId,authority,state,at});
 let bytes;
 if(result.allowed){try{bytes=mediaAssetBytes(material.video);}catch{result={allowed:false,reason:'resource_unavailable'};}}
 // A caller may record this allowlisted diagnostic, never the token or source.
 observe({placementId,context:p?.context??null,...result});
 const v=material?.video;
 const metadata=v&&p?.authorized===true&&p.visible===true?{title:v.title,description:v.description,creator:v.creator,duration:v.duration,poster:'/media-poster.svg',availability:({public:'ALL',memberships:'MEMBERS',pay_on_demand:'PAY_ON_DEMAND'})[p.policy?.kind]||null}:null;
 return {decision:result,metadata,...(result.allowed?{bytes,revision:material.video.revision}: {})};
}
export function requireMediaDecision(result){
 if(!result.decision.allowed){const e=new ApplicationError('This video is unavailable for your account.',result.decision.reason==='authentication_required'?401:403);e.mediaReason=result.decision.reason;throw e;}
 return result.bytes;
}
export function createMediaViewerStore(pool,{observe=()=>{},now=()=>new Date().toISOString()}={}){
 return {async resolve(viewerId,placementId){
  const c=await pool.connect();try{
   await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[viewerId||'']);
   const result=await resolveMediaOnClient(c,viewerId,placementId,{at:now(),observe});
   await c.query('commit');return result;
  }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
 },async describe(viewerId,placementId){const {decision,metadata}=await this.resolve(viewerId,placementId);return {decision,metadata};},async play(viewerId,placementId){return requireMediaDecision(await this.resolve(viewerId,placementId));}};
}
