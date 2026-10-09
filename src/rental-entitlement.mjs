import {createRentalTerms} from './rental-policy.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
const scope=(x,a)=>x.tenantId===a.tenantId&&x.businessId===a.businessId;
export function rentalStatus(e,at){
 if(e.state==='revoked')return 'revoked';
 if(!e.rental)return e.state==='active'?'active':'revoked';
 const r=e.rental,t=Date.parse(at);if(!Number.isFinite(t))return 'expired';
 if(!r.availableAt||t<Date.parse(r.availableAt))return 'scheduled';
 if(r.activation?.confirmedAt)return Number.isFinite(Date.parse(r.expiresAt))&&t<Date.parse(r.expiresAt)?'active':'expired';
 if(!Number.isFinite(Date.parse(r.startBy))||t>=Date.parse(r.startBy))return 'expired';
 if(r.activation&&r.activation.state!=='recovered')return 'starting';
 return Number.isFinite(Date.parse(r.startBy))&&t<Date.parse(r.startBy)?'ready_to_start':'expired';
}
export const rentalEligible=(e,at)=>['active','ready_to_start','starting'].includes(rentalStatus(e,at));
// Caller resolves business permissions inside the existing command transaction.
export function grantComplimentaryRental(state,body,a,{id,now},fail){
 if(a.role!=='staff'||!body.principalId||!body.target||body.target.kind!=='media_placement'||!scope(body.target,a)||!body.reason?.trim())fail('Scoped complimentary rental and reason required',400);
 state.accessEntitlements||=[];
 const prior=state.accessEntitlements.find(e=>scope(e,a)&&e.provenance?.actorId===a.userId&&e.provenance?.requestId===body.requestId);
 if(prior){if(prior.principalId!==body.principalId||!equal(prior.target,body.target)||prior.provenance.reason!==body.reason.trim()||prior.provenance.relatedEntitlementId!==(body.relatedEntitlementId??null))fail('Request identifier conflict',409);return prior;}
 const at=now(),e={id:id(),principalId:body.principalId,tenantId:a.tenantId,businessId:a.businessId,target:structuredClone(body.target),state:'active',createdAt:at,revokedAt:null,revocationRef:null,revision:1,rental:createRentalTerms(body.rentalPolicy,{grantedAt:at,availableAt:body.availableAt??null}),provenance:{kind:'staff_grant',actorId:a.userId,reason:body.reason.trim(),requestId:body.requestId,createdAt:at,relatedEntitlementId:body.relatedEntitlementId??null},corrections:[]};
 state.accessEntitlements.push(e);state.activity.push({id:id(),action:'rental-complimentary-grant',actorId:a.userId,subjectId:e.id,tenantId:a.tenantId,businessId:a.businessId,reason:e.provenance.reason,createdAt:at,requestId:body.requestId});return e;
}
export function correctRentalEntitlement(state,body,a,{id,now},fail){
 body={...body,operation:body.operation??body.action};
 const e=state.accessEntitlements?.find(e=>e.id===body.entitlementId&&scope(e,a));
 if(a.role!=='staff'||!e?.rental)fail('Rental unavailable',404);
 const prior=e.corrections?.find(c=>c.requestId===body.requestId&&c.actorId===a.userId);if(prior){if(prior.operation!==body.operation||prior.reason!==body.reason?.trim()||prior.hours!==(body.hours??null))fail('Request identifier conflict',409);return prior.operation==='replace'?state.accessEntitlements.find(x=>x.provenance?.relatedEntitlementId===e.id&&x.provenance?.requestId===body.requestId):e;}
 if(!body.reason?.trim()||body.expectedRevision!==(e.revision||1))fail('Current revision and correction reason required',409);
 const before=structuredClone({state:e.state,rental:e.rental}),at=now(),next=structuredClone(e);
 if(body.operation==='extend'){
  if(e.state==='revoked'||!Number.isInteger(body.hours)||body.hours<1||body.hours>8760)fail('Invalid rental extension',400);
  const field=e.rental.activation?.confirmedAt?'expiresAt':'startBy',base=Date.parse(e.rental[field]);
  if(!Number.isFinite(base))fail('Release rental before extending',409);
  next.rental[field]=new Date(Math.max(base,Date.parse(at))+body.hours*3600000).toISOString();
 }else if(body.operation==='reset'){
  if(e.state==='revoked')fail('Revoked access requires replacement',409);
  next.rental=createRentalTerms(e.rental.policy,{grantedAt:at,availableAt:e.rental.availableAt?at:null});
 }else if(['revoke','replace'].includes(body.operation)){next.state='revoked';next.revokedAt=at;next.revocationRef=body.requestId;}
 else fail('Unsupported rental correction',400);
 next.revision=(e.revision||1)+1;next.corrections||=[];
 next.corrections.push({id:id(),actorId:a.userId,reason:body.reason.trim(),operation:body.operation,hours:body.hours??null,requestId:body.requestId,at,revision:next.revision,before,after:structuredClone({state:next.state,rental:next.rental})});
 Object.assign(e,next);
 if(['reset','revoke','replace'].includes(body.operation))for(const session of state.rentalPlaybackSessions||[])if(session.entitlementId===e.id){session.state='revoked';session.revokedAt=at;}
 if(['reset','revoke','replace'].includes(body.operation))for(const ticket of state.rentalPlaybackTickets||[])if(ticket.entitlementId===e.id&&ticket.state!=='revoked')ticket.state='revocation_pending';
 state.activity.push({id:id(),action:`rental-${body.operation}`,actorId:a.userId,subjectId:e.id,tenantId:a.tenantId,businessId:a.businessId,createdAt:at,requestId:body.requestId,revision:e.revision,reason:body.reason.trim()});
 if(body.operation==='replace')return grantComplimentaryRental(state,{...body,principalId:e.principalId,target:e.target,rentalPolicy:e.rental.policy,availableAt:e.rental.availableAt?at:null,relatedEntitlementId:e.id},a,{id,now:()=>at},fail);
 return e;
}
