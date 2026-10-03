// Fixed Vega Development verification composition. No runtime route imports this file.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPostgresRefundSource,postgresBatchExecutor} from '../src/runtime/refund-postgres-source.mjs';
import {createRefundInventoryComposition} from '../src/refund-inventory-composition.mjs';
import {assembleRefundAssessment} from '../src/refund-inventory-assembler.mjs';
import {evidenceGapKinds} from '../src/refund-evidence-gaps.mjs';
export const target=Object.freeze({tenantId:'vega-development',businessId:'vega-dance-lab',purchaseId:'3609b576-10f1-4d16-94df-e46e10ec7a96',attemptId:'c5ddcda0-5d3f-4e1a-9916-03c6a990a2b1'});
export const baseline=Object.freeze({revision:'127',historicalMd5:'2697037513f331bcf116a37d2bd003bc',canonicalStateSha256:'d0871b339c712e6dd11f0288261174a579e25903877d2020c0d97d9c20c8c6c8',frozenTermsSha256:'5774a6c42989d2f65fd2aaf48fca1cbbb98369734d85f4285ccaa8bed477b62e'});
const project='cjdoczrxcjynjhgpgqop',staff='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',member='e5946b40-9839-4a96-99d5-93262d9573f0';
export const policies=Object.freeze(['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED']);
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(v=>stable(v)??'null').join(',')+']':'{'+Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
export const sha=x=>createHash('sha256').update(stable(x)).digest('hex');
export const checkpointSql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL ROLE vega_app_runtime;
SELECT set_config('vega.actor_id','${staff}',true);
SELECT s.revision::text AS revision,md5(s.state::text) AS historical_md5,s.state,
 (SELECT jsonb_object_agg(key,md5(value::text)) FROM jsonb_each(s.state)) AS component_digests,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor_id,request_id),'[]'::jsonb)::text) FROM vega_private.app_commands c WHERE c.tenant_id=s.tenant_id AND c.business_id=s.business_id) AS commands_digest,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY event_id),'[]'::jsonb)::text) FROM vega_private.recovery_outbox o WHERE o.tenant_id=s.tenant_id AND o.business_id=s.business_id) AS recovery_digest,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY user_id),'[]'::jsonb)::text) FROM vega_private.app_members m WHERE m.tenant_id=s.tenant_id AND m.business_id=s.business_id) AS members_digest,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY integration_id,version),'[]'::jsonb)::text) FROM vega_private.payment_integrations i WHERE i.tenant_id=s.tenant_id AND i.business_id=s.business_id) AS integrations_digest,
 current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation
FROM vega_private.app_state s WHERE s.tenant_id='vega-development' AND s.business_id='vega-dance-lab';
ROLLBACK;`;

export function summarizeCheckpoint(rows){
 assert.equal(rows.length,1);const r=rows[0];assert.equal(r.read_only,'on');assert.equal(r.isolation,'repeatable read');
 const p=r.state.purchaseDrafts.filter(p=>p.id===target.purchaseId&&p.tenantId===target.tenantId&&p.businessId===target.businessId);
 assert.equal(p.length,1);assert.equal(p[0].activeAttemptId,target.attemptId);assert.equal(p[0].paymentStatus,'succeeded');
 const a=r.state.paymentAttempts.filter(a=>a.id===target.attemptId&&a.purchaseId===target.purchaseId);assert.equal(a.length,1);assert.equal(a[0].status,'succeeded');
 // Never return raw state, identities, components with arbitrary keys, or database messages.
 return {revision:r.revision,historicalMd5:r.historical_md5,canonicalStateSha256:sha(r.state),frozenTermsSha256:sha(p[0].terms),
  componentDigest:sha(r.component_digests),commandsDigest:r.commands_digest,recoveryDigest:r.recovery_digest,membersDigest:r.members_digest,integrationsDigest:r.integrations_digest};
}
export async function readCheckpoint(pool){
 const c=await pool.connect();let failed=false;
 try{const batch=await c.query(checkpointSql);return summarizeCheckpoint(batch.flatMap(r=>r.rows??[]).filter(r=>Object.hasOwn(r,'revision')));}
 catch(e){failed=true;await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release(failed);}
}
export function fixedLoader(pool){
 return async scenario=>{
  const source=createPostgresRefundSource({environment:'development',connectionIdentity:project,expectedConnectionIdentity:project,schema:'vega_private',runtimeRole:'vega_app_runtime',actorSetting:'vega.actor_id',scope:{...target,tenantId:scenario.tenantId??target.tenantId,businessId:scenario.businessId??target.businessId},verifyPrincipal:async p=>scenario.label!=='unauthorized'&&p===scenario.userId?{userId:p}:null,executeTransaction:postgresBatchExecutor(pool)});
  return createRefundInventoryComposition({source})({authenticatedPrincipal:scenario.userId,purchaseId:scenario.purchaseId??target.purchaseId,expectedAttemptId:target.attemptId,expectedCheckpoint:{revision:baseline.revision,historicalMd5:baseline.historicalMd5,stateDigest:baseline.canonicalStateSha256},assessmentContext:{get at(){return new Date().toISOString();}}});
 };
}
export function validateEnvironment(env,args){
 assert.equal(args.length,0);assert.equal(env.VEGA_ENV,'development');assert.equal(env.VEGA_EXTERNAL_EFFECTS,'disabled');assert.equal(env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');
 assert.equal(env.SUPABASE_URL,'https://cjdoczrxcjynjhgpgqop.supabase.co');
 assert.match(env.VEGA_REFUND_VERIFY_COMMIT??'',/^[a-f0-9]{40}$/);assert.equal(env.RENDER_GIT_COMMIT,env.VEGA_REFUND_VERIFY_COMMIT);
 assert.ok(env.APP_DATABASE_URL);assert.ok(!env.NODE_OPTIONS);assert.ok(!env.NODE_PATH);
 return env.RENDER_GIT_COMMIT;
}

export async function verifyReads({read,load}){
 const before=await read();for(const [k,v] of Object.entries(baseline))assert.equal(before[k],v);
 const scenarios=[{label:'staff',userId:staff},{label:'unauthorized',userId:'unverified-principal'},{label:'member',userId:member},{label:'missing-purchase',userId:staff,purchaseId:'00000000-0000-4000-8000-000000000000'},{label:'foreign-business',userId:staff,businessId:'verification-foreign-business'},{label:'foreign-tenant',userId:staff,tenantId:'verification-foreign-tenant'}];
 let payload,diagnostics;
 for(const s of scenarios){
  const r=await load(s);assert.equal(r.executionAuthorized,false);
  if(s.label!=='staff'){
   assert.equal(r.status,'denied');
   assert.ok(Object.keys(r).every(k=>['status','reasonCodes','staffApprovalRequired','executionAuthorized'].includes(k)));
   assert.deepEqual(r.reasonCodes,['OWNERSHIP_SCOPE_DENIED']);continue;
  }
  const i=r.assemblerInput,c=r.assessment,g=c.gapReport;
  assert.equal(r.status,'blocked');assert.equal(c.status,'blocked');assert.equal(c.executionAuthorized,false);
  assert.deepEqual(c.assessment,assembleRefundAssessment(i));
  assert.equal(c.assessment.coverage.provider,'provider_unknown');assert.equal(c.assessment.eligibility,undefined);
  assert.equal(g.executionAuthorized,false);assert.equal(g.evidenceUsable,false);assert.equal(g.status,'blocked');assert.deepEqual(g.scope,target);
  assert.deepEqual(g.policyBlocks,[...policies]);
  assert.ok(g.evidenceGaps.some(x=>x.kind==='missing_provider_activity'&&x.origin==='provider'));
  assert.ok(g.evidenceGaps.some(x=>x.origin==='owned'));
  assert.ok(Object.values(i.attestations.coverage.owned).every(x=>x.state==='incomplete'));
  assert.equal(r.checkpoint.revision,baseline.revision);assert.equal(r.checkpoint.stateDigest,baseline.canonicalStateSha256);
  assert.equal(i.frozenTermsRef.digest,baseline.frozenTermsSha256);
  payload=sha({state:i.ownedSnapshot.state,facts:i.ownedSnapshot.facts});assert.equal(i.attestations.snapshot.payloadDigest,payload);
  const categories=['purchase','confirmation','refunds','issuance','consumption','restoration','reservations','clocks','ownership','recovery','audit','inventory','provider_activity'];
  diagnostics=g.evidenceGaps.map(x=>{
   assert.ok(categories.includes(x.category));assert.ok(evidenceGapKinds.includes(x.kind));assert.ok(['owned','provider'].includes(x.origin));assert.deepEqual(x.scope,target);assert.deepEqual(x.blocks,{affirmativeEligibility:true,execution:true});
   return {category:x.category,kind:x.kind,origin:x.origin,blocksAffirmativeEligibility:true,blocksExecution:true};
  });
  assert.ok(diagnostics.length>0&&diagnostics.length<=100);
 }
 const after=await read();assert.deepEqual(after,before);
 return {version:1,status:'passed',before,after,projectedPayloadSha256:payload,provider:'provider_unknown',owned:'incomplete',policies:[...policies],boundaryChecks:scenarios.map(s=>s.label),assessmentUnchanged:true,staffDiagnostics:diagnostics,executionAuthorized:false,independentReconciliationRequired:true};
}
