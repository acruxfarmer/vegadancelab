import {createHash,createPublicKey,randomBytes,createCipheriv,publicEncrypt,constants} from 'node:crypto';

export const digest=value=>createHash('sha256').update(value).digest('hex');
export function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v)??'null').join(',')+']';
 return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
// A version-bound structural delta preserves changed values without copying
// unrelated customers. Array operations are ordered and use the prior revision.
export function changes(before,after,path=[]){
 if(canonical(before)===canonical(after))return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)){
  if(Array.isArray(after)){
   const result=[];for(let i=0;i<Math.min(before.length,after.length);i++)result.push(...changes(before[i],after[i],[...path,i]));
   for(let i=before.length-1;i>=after.length;i--)result.push({op:'remove',path:[...path,i]});
   for(let i=before.length;i<after.length;i++)result.push({op:'set',path:[...path,i],value:after[i]});
   return result;
  }
  const result=[];for(const key of Object.keys(before).sort())if(!Object.hasOwn(after,key))result.push({op:'remove',path:[...path,key]});
  for(const key of Object.keys(after).sort())result.push(...changes(before[key],after[key],[...path,key]));
  return result;
 }
 return [{op:'set',path,value:after}];
}
export function receiptKey(value){
 const key=createPublicKey(value);
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072)throw new Error('Recovery public key must be RSA 3072 bits or stronger');
 return key;
}
export function buildRecoveryReceipt({before,after,revision,authority,command,result,occurredAt,publicKey}){
 const previous=BigInt(revision),next=previous+1n;
 const operation={tenantId:authority.tenantId,businessId:authority.businessId,actorId:authority.userId,requestId:command.body.requestId};
 const eventId=digest(canonical(['vega-independent-receipt-v1',operation]));
 const payload={schema:'vega.committed-result.v1',eventId,operation,owner:'vega-application',source:'native',stage:'committed-result',previousRevision:String(previous),revision:String(next),occurredAt,actorRole:authority.role,intent:{action:command.action,targetId:command.id??null},beforeDigest:digest(canonical(before)),afterDigest:digest(canonical(after)),changes:changes(before,after),result};
 return sealReceipt(payload,publicKey);
}
export function buildRevocationReceipt({authority,sessionId,outcome,occurredAt,publicKey}){
 const operation={tenantId:authority.tenantId,businessId:authority.businessId,actorId:authority.userId,providerSessionId:sessionId};
 const eventId=digest(canonical(['vega-session-revocation-v1',operation]));
 return sealReceipt({schema:'vega.security-termination.v1',eventId,operation,owner:'vega-authentication',source:'supabase',stage:'provider-revocation-observed',occurredAt,outcome,rule:'security termination is fail-safe and immediate; independent evidence archival is durable but non-blocking'},publicKey);
}
function sealReceipt(payload,publicKey){
 const key=receiptKey(publicKey),secret=randomBytes(32),iv=randomBytes(12);
 const keyId=digest(key.export({type:'spki',format:'der'}));
 const {eventId,operation,previousRevision,revision}=payload;
 const envelope={schema:'vega.encrypted-recovery-receipt.v1',eventId,tenantId:operation.tenantId,businessId:operation.businessId,...(revision?{previousRevision,revision}:{}),keyId,cipher:'AES-256-GCM',keyWrapping:'RSA-OAEP-SHA256'};
 const cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(canonical(envelope)));
 try{
  const bytes=Buffer.concat([cipher.update(canonical(payload),'utf8'),cipher.final()]);
  const sealed={...envelope,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),wrappedKey:publicEncrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},secret).toString('base64'),ciphertext:bytes.toString('base64')};
  const serialized=canonical(sealed);
  return {eventId,previousRevision,revision,payload:serialized,payloadDigest:digest(serialized)};
 }finally{secret.fill(0);}
}
