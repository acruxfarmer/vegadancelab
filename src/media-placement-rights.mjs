import {ApplicationError} from './application.mjs';
export const accessModes=['public','memberships','pay_on_demand'];
const fail=()=>{throw new ApplicationError('Choose explicit placement rights',400);};
export function placementRights(input,ceiling){
 if(!input||Object.keys(input).some(k=>!['present','organize','access'].includes(k))||typeof input.present!=='boolean'||typeof input.organize!=='boolean')fail();
 const a=input.access;
 if(!a||Object.keys(a).some(k=>!['mode','modes'].includes(k))||!['none','restrict','modes','all'].includes(a.mode))fail();
 if(a.mode==='modes'&&(!Array.isArray(a.modes)||!a.modes.length||new Set(a.modes).size!==a.modes.length||a.modes.some(m=>!accessModes.includes(m))))fail();
 if(a.mode!=='modes'&&a.modes!==undefined)fail();
 return {present:input.present,organize:input.organize,access:{mode:a.mode,...(a.mode==='modes'?{modes:[...a.modes].sort()}:{}),ceiling:structuredClone(ceiling)}};
}
export function effectivePlacementRights(p){return p.rights||{present:true,organize:true,access:{mode:'none',ceiling:p.policy}};}
export function sameAccess(a,b){return a?.kind===b?.kind&&(a.kind!=='memberships'||JSON.stringify([...a.productIds].sort())===JSON.stringify([...b.productIds].sort()));}
// Membership predicates are OR: removing products narrows the audience.
// PAY_ON_DEMAND is not ranked against MEMBERS; its future semantics stay closed.
export function noBroader(next,boundary){
 return sameAccess(next,boundary)||boundary?.kind==='public'||next?.kind==='memberships'&&boundary?.kind==='memberships'&&next.productIds.every(id=>boundary.productIds.includes(id));
}
export function delegatedAccessAllowed(p,next){
 if(sameAccess(p.policy,next))return true;
 const {access:a}=effectivePlacementRights(p);
 if(a.mode==='all')return true;
 if(a.mode==='modes')return a.modes.includes(next.kind);
 return a.mode==='restrict'&&noBroader(next,a.ceiling)&&noBroader(next,p.policy);
}
export function receiverAccessOptions(p){
 const a=effectivePlacementRights(p).access;
 if(a.mode==='none')return [];
 if(a.mode==='all')return accessModes;
 if(a.mode==='modes')return a.modes;
 return accessModes.filter(kind=>kind==='memberships'?noBroader({kind,productIds:p.policy.productIds||[]},a.ceiling)&&noBroader({kind,productIds:p.policy.productIds||[]},p.policy):noBroader({kind},a.ceiling)&&noBroader({kind},p.policy));
}
