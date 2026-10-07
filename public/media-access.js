// Presentation only. Decisions come from the server; no membership inspection.
const denied={
 authentication_required:['sign_in_required','Sign in to check access.'],
 membership_required:['locked','This media is available to eligible members.'],
 membership_not_current:['locked','Your access to this media is not currently active.'],
 paid_access_required:['locked','Paid access is required. Purchasing access is not available yet.'],
 placement_unavailable:['unavailable','This media is no longer available here.'],
 resource_unavailable:['unavailable','This media is currently unavailable.'],
 access_policy_invalid:['unavailable','This media is currently unavailable.']
};
export function mediaPresentation(decision){
 if(!decision)return {state:'loading',message:'Checking access…',playable:false};
 if(decision.allowed===true)return {state:'available',message:'Ready to watch.',playable:true};
 const [state,message]=denied[decision.reason]||['unavailable','Access could not be checked. Please try again.'];
 return {state,message,playable:false};
}
export function accessNotice(decision,escape,actions=[]){
 const p=mediaPresentation(decision);
 return `<p role="status" data-access-state="${p.state}">${escape(p.message)}</p>${actions.filter(a=>a.state===p.state&&a.href?.startsWith('/')&&!a.href.startsWith('//')).map(a=>`<a class="button secondary" href="${escape(a.href)}">${escape(a.label)}</a>`).join('')}`;
}
