const fields=['version','activationDays','viewingHours','replayAllowed','releaseAt','startupRecoveryMinutes'];
export function normalizeRentalPolicy(input,{historical=false}={}){
 const legacy=historical&&input?.version===1;
 const allowed=legacy?[...fields,'graceBufferMinutes','graceCapHours']:fields;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Invalid rental policy');
 const p={version:legacy?1:2,activationDays:30,viewingHours:48,replayAllowed:true,releaseAt:null,startupRecoveryMinutes:10,...input};
 for(const [key,min,max] of [['activationDays',1,3650],['viewingHours',1,8760]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw Error(`Invalid rental ${key}`);
 if(p.version!==(legacy?1:2)||p.startupRecoveryMinutes!==10||typeof p.replayAllowed!=='boolean'||p.releaseAt!==null&&(typeof p.releaseAt!=='string'||!Number.isFinite(Date.parse(p.releaseAt))))throw Error('Invalid rental policy');
 if(p.releaseAt!==null)p.releaseAt=new Date(p.releaseAt).toISOString();
 return p;
}
export function createRentalTerms(policy,{grantedAt,availableAt=null}){
 const p=normalizeRentalPolicy(policy,{historical:true}),grant=Date.parse(grantedAt);
 if(!Number.isFinite(grant))throw Error('Invalid rental grant time');
 let available=null;
 if(availableAt!==null){const actual=Date.parse(availableAt);if(!Number.isFinite(actual))throw Error('Invalid rental availability time');available=Math.max(grant,actual,p.releaseAt?Date.parse(p.releaseAt):grant);}
 return {policy:p,availableAt:available===null?null:new Date(available).toISOString(),startBy:available===null?null:new Date(available+p.activationDays*86400000).toISOString(),activation:null,expiresAt:null,recoveryUsedMs:0};
}
