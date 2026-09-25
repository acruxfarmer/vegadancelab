import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {buildRecoveryReceipt,buildRevocationReceipt} from '../src/recovery-receipt.mjs';
import {decodeReceipt,reconcileReceiptCopies,applyBusinessReceipt} from '../src/recovery-reconciliation.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072});
const input={before:{list:[1,2],old:true},after:{list:[3],new:true},revision:'4',authority:{tenantId:'t',businessId:'b',userId:'u',role:'staff'},command:{action:'synthetic',body:{requestId:'one'}},result:{changed:true},occurredAt:'2026-09-25T00:00:00Z',publicKey:publicKey.export({type:'spki',format:'pem'})};
test('independent copies deduplicate; replay requires exact baseline, scope and predecessor',()=>{
 const r=buildRecoveryReceipt(input),copy={bytes:r.payload,expectedDigest:r.payloadDigest};
 const receipts=reconcileReceiptCopies([copy,copy],privateKey);assert.equal(receipts.length,1);
 const baseline={state:input.before,revision:'4',tenantId:'t',businessId:'b'};
 const result=applyBusinessReceipt(baseline,receipts[0].payload);assert.deepEqual(result.state,input.after);assert.equal(result.revision,'5');
 assert.deepEqual(baseline.state,input.before);
 assert.throws(()=>applyBusinessReceipt({...baseline,revision:'3'},receipts[0].payload),/predecessor/);
 assert.throws(()=>applyBusinessReceipt({...baseline,state:{}},receipts[0].payload),/baseline/);
 assert.throws(()=>applyBusinessReceipt({...baseline,businessId:'other'},receipts[0].payload),/scope/);
 assert.throws(()=>reconcileReceiptCopies([{...copy,expectedDigest:'wrong'}],privateKey),/digest/);
 const conflict=buildRecoveryReceipt(input);assert.throws(()=>reconcileReceiptCopies([copy,{bytes:conflict.payload}],privateKey),/Conflicting/);
});
test('security receipts stay separate from business replay; encrypted metadata tampering fails',()=>{
 const r=buildRevocationReceipt({authority:input.authority,sessionId:'synthetic-session',outcome:'revoked',occurredAt:input.occurredAt,publicKey:input.publicKey});
 const payload=decodeReceipt(r.payload,privateKey);assert.equal(payload.schema,'vega.security-termination.v1');
 assert.throws(()=>applyBusinessReceipt({state:input.before,revision:'4',tenantId:'t',businessId:'b'},payload),/scope/);
 const changed=JSON.parse(r.payload);changed.tenantId='other';assert.throws(()=>decodeReceipt(JSON.stringify(changed),privateKey));
});
