// Offline recovery inspection only. Never imported by the application or worker;
// the recovery private key must remain in separate operator custody.
import {createPublicKey,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {canonical,digest} from './recovery-receipt.mjs';

export function decodeReceipt(bytes,privateKey){
 const {iv,tag,wrappedKey,ciphertext,...header}=JSON.parse(bytes);
 if(header.schema!=='vega.encrypted-recovery-receipt.v1'||header.cipher!=='AES-256-GCM'||header.keyWrapping!=='RSA-OAEP-SHA256')throw new Error('Unsupported recovery envelope');
 if(header.keyId!==digest(createPublicKey(privateKey).export({type:'spki',format:'der'})))throw new Error('Recovery key mismatch');
 const secret=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(wrappedKey,'base64'));
 try{
  const cipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(canonical(header)));cipher.setAuthTag(Buffer.from(tag,'base64'));
  const payload=JSON.parse(Buffer.concat([cipher.update(Buffer.from(ciphertext,'base64')),cipher.final()]).toString('utf8'));
  const namespace=payload.schema==='vega.committed-result.v1'?'vega-independent-receipt-v1':payload.schema==='vega.security-termination.v1'?'vega-session-revocation-v1':null;
  if(!namespace||payload.eventId!==digest(canonical([namespace,payload.operation]))||payload.eventId!==header.eventId||payload.operation.tenantId!==header.tenantId||payload.operation.businessId!==header.businessId||payload.revision!==header.revision||payload.previousRevision!==header.previousRevision)throw new Error('Recovery identity mismatch');
  return payload;
 }finally{secret.fill(0);}
}

// Same logical ID with different immutable bytes is a conflict, not a newer
// replacement. Never choose a version silently, even if both decrypt correctly.
export function reconcileReceiptCopies(copies,privateKey){
 const seen=new Map();
 for(const copy of copies){
  const bytes=Buffer.from(copy.bytes),hash=digest(bytes);
  if(copy.expectedDigest&&copy.expectedDigest!==hash)throw new Error('Downloaded receipt digest mismatch');
  const payload=decodeReceipt(bytes,privateKey),prior=seen.get(payload.eventId);
  if(prior&&prior.digest!==hash)throw new Error('Conflicting copies for one logical receipt');
  if(!prior)seen.set(payload.eventId,{digest:hash,payload});
 }
 return [...seen.values()];
}

export function applyBusinessReceipt({state,revision,tenantId,businessId},receipt){
 if(receipt.schema!=='vega.committed-result.v1'||receipt.operation.tenantId!==tenantId||receipt.operation.businessId!==businessId)throw new Error('Recovery business scope mismatch');
 if(String(revision)!==receipt.previousRevision||BigInt(receipt.revision)!==BigInt(revision)+1n||digest(canonical(state))!==receipt.beforeDigest)throw new Error('Required recovery baseline or predecessor missing');
 let restored=structuredClone(state);
 for(const change of receipt.changes){
  if(!['set','remove'].includes(change.op)||!Array.isArray(change.path)||change.path.some(k=>!(typeof k==='string'||Number.isSafeInteger(k))||['__proto__','constructor','prototype'].includes(k)))throw new Error('Invalid recovery change');
  if(!change.path.length){if(change.op!=='set')throw new Error('Invalid root removal');restored=structuredClone(change.value);continue;}
  let parent=restored;
  for(const key of change.path.slice(0,-1)){if(!parent||!Object.hasOwn(parent,key))throw new Error('Missing recovery path');parent=parent[key];}
  const key=change.path.at(-1);
  if(!parent||typeof parent!=='object')throw new Error('Invalid recovery parent');
  if(Array.isArray(parent)&&(!Number.isSafeInteger(key)||key<0||key>parent.length||(change.op==='remove'&&key===parent.length)))throw new Error('Invalid recovery array position');
  if(change.op==='set')parent[key]=structuredClone(change.value);
  else if(Array.isArray(parent))parent.splice(key,1);
  else {if(!Object.hasOwn(parent,key))throw new Error('Missing recovery value');delete parent[key];}
 }
 if(digest(canonical(restored))!==receipt.afterDigest)throw new Error('Reconstructed state digest mismatch');
 return {state:restored,revision:receipt.revision,tenantId,businessId};
}
