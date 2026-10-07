import {mediaTransition,mediaView,mediaOrganization} from './media.mjs';
import {transition as existingTransition,visibleState as existingView,ApplicationError} from './refund-application.mjs';
import {customerProfileView} from './customer-profile.mjs';

// Compose the established self-profile rules with the existing booking engine.
export function bookingReadiness(state,authority,at=new Date().toISOString()){
 if(authority.role!=='member')return null;
 const profile=customerProfileView(state,authority,at).customerProfile;
 if(profile.status!=='ready')return {nextStep:'review',reason:'Needs Staff Review. Contact the studio to confirm your member relationship.'};
 if(!profile.revision)return {nextStep:'profile',reason:'Complete your profile before booking.'};
 if(profile.waiverStatus==='Acceptance required')return {nextStep:'profile',reason:'Review and accept the current studio waiver before booking.'};
 return null;
}
export function transition(state,command,authority,options={}){
 if(command.action.startsWith('media-'))return mediaTransition(state,command,authority,options);
 if(command.action==='reserve'&&authority.role==='member'){
  const gate=bookingReadiness(state,authority,options.now?.());
  if(gate)throw new ApplicationError(gate.reason,409);
 }
 return existingTransition(state,command,authority,options);
}
export function visibleState(state,authority,at=new Date().toISOString()){
 const result=existingView(state,authority,at),gate=bookingReadiness(state,authority,at);
 if(gate)result.bookingOptions=result.bookingOptions.map(o=>({...o,...gate,eligible:false,waitlistEligible:false,passId:undefined}));
 else if(authority.role==='member')result.bookingOptions=result.bookingOptions.map(o=>({...o,...(!o.eligible&&!o.waitlistEligible&&o.creditRequired&&o.reason.startsWith('No eligible class credit')?{nextStep:'passes'}:{})}));
 result.videos=mediaView(state,authority);result.mediaGroups=mediaOrganization(state,authority);
 return result;
}
