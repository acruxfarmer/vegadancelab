import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresRefundSource,postgresBatchExecutor} from '../src/runtime/refund-postgres-source.mjs';
import {createOwnedRefundSnapshotLoader} from '../src/refund-snapshot-loader.mjs';
import {assemblyFixture} from './helpers/refund-assembly-fixtures.mjs';
import {inventoryDigest} from '../src/refund-inventory.mjs';

function fixture(business='original',processor='processor-alpha'){
 const f=assemblyFixture(business,processor),state=structuredClone(f.ownedSnapshot.state);delete state.refundRecords;
 const a={...f.authority,userId:'verified-user'};
 const envelope={identity:{role:'app_runtime',read_only:'on',isolation:'repeatable read',restricted:true,isolated:true},authority:a,
 row:{tenantId:a.tenantId,businessId:a.businessId,state,revision:'127',historicalMd5:'a'.repeat(32),observedAt:f.context.at},recovery:null};
 const calls=[];
 const config={environment:'development',connectionIdentity:'development-db',expectedConnectionIdentity:'development-db',schema:'owned',runtimeRole:'app_runtime',actorSetting:'app.actor_id',scope:{...a,purchaseId:f.context.scope.purchaseId,attemptId:f.context.scope.attemptId},
 verifyPrincipal:async p=>p==='verified-token'?{userId:'verified-user'}:null,executeTransaction:async sql=>{calls.push(sql);return envelope;}};
 const args={authenticatedPrincipal:'verified-token',purchaseId:f.context.scope.purchaseId,expectedAttemptId:f.context.scope.attemptId,expectedCheckpoint:{revision:'127'},assessmentContext:{at:f.context.at}};
 return {config,args,envelope,calls};
}
const run=x=>createOwnedRefundSnapshotLoader({source:createPostgresRefundSource(x.config)})(x.args);
for(const b of ['original','second'])for(const p of ['processor-alpha','processor-beta'])test(`Postgres source chain ${b}/${p}`,async()=>{
 const x=fixture(b,p),before=structuredClone(x.envelope),r=await run(x);
 assert.equal(x.calls.length,1);assert.equal(r.status,'blocked');assert.equal(r.executionAuthorized,false);
 assert.equal(r.assemblerInput.attestations.coverage.provider.state,'provider_unknown');
 assert.ok(Object.values(r.assemblerInput.attestations.coverage.owned).every(c=>c.state==='incomplete'));
 assert.equal(r.assemblerInput.ownedSnapshot.facts.refunds,undefined);assert.equal(r.assemblerInput.ownedSnapshot.facts.recovery,undefined);
 for(const code of ['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED'])assert.ok(r.assemblerInput.attestations.policyBoundaries.includes(code));
 assert.equal(r.assessment.coverage.provider,'provider_unknown');
 assert.ok(r.reasonCodes.includes('PROVIDER_ACTIVITY_UNKNOWN'));
 assert.equal(r.checkpoint.stateDigest,inventoryDigest(x.envelope.row.state));assert.deepEqual(x.envelope,before);
 assert.match(x.calls[0],/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);assert.match(x.calls[0],/ROLLBACK;$/);
});
test('unauthenticated never queries PostgreSQL',async()=>{const x=fixture();x.args.authenticatedPrincipal='forged';assert.equal((await run(x)).status,'denied');assert.equal(x.calls.length,0);});
test('non-staff returns no state and invokes no assessment',async()=>{const x=fixture();x.envelope.authority.role='member';x.envelope.row=null;const r=await run(x);assert.equal(r.status,'denied');assert.equal(r.checkpoint,undefined);assert.match(x.calls[0],/CASE WHEN EXISTS\(SELECT 1 FROM authority WHERE role='staff'\)/);});
test('missing and cross-business purchase indistinguishable',async()=>{const x=fixture(),y=fixture();x.args.purchaseId='missing';y.envelope.row.state.purchaseDrafts[0].businessId='other';assert.deepEqual(await run(x),await run(y));});
for(const field of ['restricted','isolated','read_only','isolation','role'])test(`reject database guarantee drift ${field}`,async()=>{const x=fixture();x.envelope.identity[field]=false;await assert.rejects(run(x),/guarantees/);});
for(const change of [x=>x.config.environment='production',x=>x.config.connectionIdentity='other-db',x=>x.config.schema='owned;drop',x=>x.config.actorSetting="app.actor';--"] )test('reject invalid trusted configuration',()=>{const x=fixture();change(x);assert.throws(()=>createPostgresRefundSource(x.config));});
test('scope mismatch cannot return data',async()=>{const x=fixture();x.envelope.authority.businessId='other';await assert.rejects(run(x),/Authority scope mismatch/);});
test('SQL input is encoded data, never executable SQL',async()=>{const x=fixture();x.config.scope.businessId="';DELETE FROM app_state;--";x.envelope.authority=null;x.envelope.row=null;await run(x);assert.ok(!x.calls[0].includes('DELETE FROM'));});
test('revision mismatch blocks closed chain',async()=>{const x=fixture();x.args.expectedCheckpoint.revision='126';assert.deepEqual((await run(x)).reasonCodes,['SNAPSHOT_CHECKPOINT_MISMATCH']);});
test('correlated audit/recovery retains scope and remains incomplete',async()=>{const x=fixture();const s=x.envelope.row.state,a=x.envelope.authority;s.activity=[{id:'audit1',subjectId:x.args.purchaseId,attemptId:x.args.expectedAttemptId,requestId:'req',actorId:'actor',tenantId:a.tenantId,businessId:a.businessId}];x.envelope.recovery=[{id:'receipt1',requestId:'req',actorId:'actor',tenantId:a.tenantId,businessId:a.businessId},{id:'unrelated',requestId:'other',actorId:'actor'}];const r=await run(x);assert.equal(r.assemblerInput.ownedSnapshot.facts.recovery.length,1);assert.equal(r.assemblerInput.attestations.coverage.owned.recovery.state,'incomplete');});
test('foreign audit evidence blocks disclosure',async()=>{const x=fixture();x.envelope.row.state.activity=[{id:'foreign',subjectId:x.args.purchaseId,tenantId:'foreign',businessId:x.config.scope.businessId}];assert.equal((await run(x)).reasonCodes[0],'OWNED_PROJECTION_CONFLICT');});
test('reader expires outside callback',async()=>{const x=fixture();let reader;await createPostgresRefundSource(x.config).withSnapshot({isolation:'repeatable read',readOnly:true},async r=>{reader=r;});await assert.rejects(reader.resolveAuthority('verified-token'),/expired/);});
test('pg executor rolls back and discards failed connection',async()=>{const calls=[];const executor=postgresBatchExecutor({connect:async()=>({query:async sql=>{calls.push(sql);if(sql!=='ROLLBACK')throw new Error('failure');},release:bad=>calls.push(bad)})});await assert.rejects(executor('batch'),/failure/);assert.deepEqual(calls,['batch','ROLLBACK',true]);});
test('pg executor returns only final envelope and releases success',async()=>{let released;const e={ok:true};const executor=postgresBatchExecutor({connect:async()=>({query:async()=>[{rows:[]},{rows:[{set_config:'id'}]},{rows:[{envelope:e}]},{rows:[]}],release:x=>released=x})});assert.deepEqual(await executor('batch'),e);assert.equal(released,false);});
