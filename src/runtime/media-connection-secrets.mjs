import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {MediaConnectionError} from './providers/external-media-vimeo.mjs';

// Dedicated runtime key: recovery receipt private keys remain offline and are
// never repurposed for OAuth credentials. Scope/purpose are authenticated data.
export function createMediaConnectionSecrets(encodedKey){
 if(typeof encodedKey!=='string'||! /^[a-f0-9]{64}$/.test(encodedKey))throw new MediaConnectionError('credential_storage_not_configured');
 const key=Buffer.from(encodedKey,'hex');
 const aad=context=>Buffer.from(JSON.stringify(['vega.media-connection.v1',context.tenantId,context.businessId,context.provider,context.purpose]));
 function contextValid(context){if(!context||['tenantId','businessId','provider','purpose'].some(k=>typeof context[k]!=='string'||!context[k].length))throw new MediaConnectionError('credential_context_invalid');}
 return {
  seal(value,context){
   contextValid(context);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(context));
   const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
   return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
  },
  open(value,context){
   contextValid(context);
   try{
    if(typeof value!=='string'||value.length>32768)throw Error();
    const [version,iv,tag,ciphertext,...extra]=value.split('.');if(version!=='v1'||extra.length)throw Error();
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));decipher.setAAD(aad(context));decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8'));
   }catch{throw new MediaConnectionError('credential_unavailable');}
  }
 };
}
