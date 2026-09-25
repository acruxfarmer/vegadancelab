import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {buildRecoveryReceipt,canonical,digest} from '../src/recovery-receipt.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072});
const publicPem=publicKey.export({type:'spki',format:'pem'});
function decode(serialized){
 const {iv,tag,wrappedKey,ciphertext,...header}=JSON.parse(serialized);
 const secret=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(wrappedKey,'base64'));
 const cipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(canonical(header)));cipher.setAuthTag(Buffer.from(tag,'base64'));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(ciphertext,'base64')),cipher.final()]));
}
const base={before:{participants:[{id:'a',name:'Unchanged private name'}],classes:[],metadata:{remove:'old'}},after:{participants:[{id:'a',name:'Unchanged private name'},{id:'b',name:'New synthetic person'}],classes:[{id:'c',capacity:4}],metadata:{added:true}},revision:'9007199254740993',authority:{tenantId:'t',businessId:'b',userId:'actor',role:'staff'},command:{action:'create',body:{requestId:'stable'}},result:{id:'b'},occurredAt:'2026-09-25T00:00:00Z',publicKey:publicPem};
test('encrypted receipt preserves operation identity and reconstructable values without unrelated customer copy',()=>{
 const r=buildRecoveryReceipt(base),payload=decode(r.payload);
 assert.equal(payload.revision,'9007199254740994');assert.equal(payload.previousRevision,base.revision);
 assert.equal(payload.operation.requestId,'stable');assert.equal(payload.actorRole,'staff');
 assert.equal(r.payloadDigest,digest(r.payload));assert.ok(!r.payload.includes('New synthetic person'));
 assert.ok(!JSON.stringify(payload).includes('Unchanged private name'));
 const restored=structuredClone(base.before);
 for(const change of payload.changes){let parent=restored;for(const k of change.path.slice(0,-1))parent=parent[k];const k=change.path.at(-1);if(change.op==='set')parent[k]=change.value;else if(Array.isArray(parent))parent.splice(k,1);else delete parent[k];}
 assert.deepEqual(restored,base.after);assert.equal(payload.afterDigest,digest(canonical(restored)));
 assert.equal(buildRecoveryReceipt(base).eventId,r.eventId);
 assert.notEqual(buildRecoveryReceipt({...base,authority:{...base.authority,businessId:'other'}}).eventId,r.eventId);
});
test('modified encrypted receipt or scope fails authentication; retries must use persisted ciphertext',()=>{
 const r=buildRecoveryReceipt(base),changed=JSON.parse(r.payload);changed.businessId='other';assert.throws(()=>decode(JSON.stringify(changed)));
 const another=buildRecoveryReceipt(base);assert.equal(another.eventId,r.eventId);assert.notEqual(another.payloadDigest,r.payloadDigest);
 assert.throws(()=>buildRecoveryReceipt({...base,publicKey:'invalid'}));
});
