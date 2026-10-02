import {isDeepStrictEqual} from 'node:util';

export function validIntegration(ref,scope){
 return !!ref&&Object.keys(ref).sort().join(',')==='businessId,environment,id,provider,tenantId,version'&&typeof ref.id==='string'&&ref.id.length>0&&Number.isSafeInteger(ref.version)&&ref.version>0&&
  ref.tenantId===scope.tenantId&&ref.businessId===scope.businessId&&typeof ref.provider==='string'&&!!ref.provider&&['sandbox','production'].includes(ref.environment);
}
export function financialIntent(d){return {amountMinor:d.totalMinor,currency:d.currency,collection:'immediate',method:'card',partialAllowed:false,tipsAllowed:false};}
export function sameIntegration(a,b){return isDeepStrictEqual(a,b);}
export function requireCapabilities(adapter,intent,fail){
 if(!adapter||adapter.contractVersion!==1||typeof adapter.submit!=='function'||typeof adapter.inspect!=='function'||typeof adapter.sourceFingerprint!=='function'||typeof adapter.validateIntent!=='function'||
 !['immediateCard','idempotentSubmit','verifiedLookup'].every(k=>adapter.capabilities?.[k]===true))fail('Provider capability unsupported',422);
 adapter.validateIntent(intent,fail);
}
export function qualifiedTransaction(ref,id){return {provider:ref.provider,environment:ref.environment,integrationId:ref.id,integrationVersion:ref.version,tenantId:ref.tenantId,businessId:ref.businessId,id};}
export function validCompletion(e,a,ref,intent){
 return e?.verified===true&&e.normalizationVersion===1&&sameIntegration(e.integrationRef,ref)&&e.referenceId===a.id&&
 e.amount===intent.amountMinor&&e.currency===intent.currency&&typeof e.paymentId==='string'&&!!e.paymentId&&
 isDeepStrictEqual(e.transactionRef,qualifiedTransaction(ref,e.paymentId))&&e.verification?.method==='authenticated_lookup'&&
 Number.isFinite(Date.parse(e.verification.observedAt))&&typeof e.verification.evidenceDigest==='string'&&/^[a-f0-9]{64}$/.test(e.verification.evidenceDigest);
}
