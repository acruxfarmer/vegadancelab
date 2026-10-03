import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assemblyFixture,attestAssembly} from './helpers/refund-assembly-fixtures.mjs';
import {composeRefundInventoryAssessment} from '../src/refund-inventory-composition.mjs';
import {target,baseline,policies,verifyReads,validateEnvironment,fixedLoader} from '../scripts/refund-composition-job-checks.mjs';
const checkpoint=()=>({...baseline,componentDigest:'b'.repeat(64),commandsDigest:'c'.repeat(32),recoveryDigest:'d'.repeat(32),membersDigest:'e'.repeat(32),integrationsDigest:'f'.repeat(32)});
function result(){
 let i=assemblyFixture('original','processor-alpha');
 let json=JSON.stringify(i);for(const k of Object.keys(target))json=json.replaceAll(i.context.scope[k],target[k]);i=JSON.parse(json);
 i.context.stateDigest=baseline.canonicalStateSha256;i.ownedSnapshot.stateDigest=baseline.canonicalStateSha256;
 i.frozenTermsRef.digest=baseline.frozenTermsSha256;i.ownedSnapshot.facts.purchase.frozenTermsDigest=baseline.frozenTermsSha256;
 i.attestations.policyBoundaries=[...policies];for(const c of Object.values(i.attestations.coverage.owned))c.state='incomplete';i.attestations.coverage.provider.state='provider_unknown';attestAssembly(i);
 const composition=composeRefundInventoryAssessment(i);
 return {status:composition.status,executionAuthorized:false,assessment:composition,assemblerInput:i,checkpoint:{revision:baseline.revision,stateDigest:baseline.canonicalStateSha256}};
}
function setup(){const calls=[];return {calls,read:async()=>{calls.push('read');return checkpoint()},load:async s=>{calls.push(s.label);return s.label==='staff'?result():{status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],executionAuthorized:false,staffApprovalRequired:true}}};}
test('composition probe returns sanitized receipt after six probes and two checkpoints',async()=>{
 const x=setup(),r=await verifyReads(x);assert.deepEqual(x.calls,['read','staff','unauthorized','member','missing-purchase','foreign-business','foreign-tenant','read']);assert.deepEqual(r.before,r.after);assert.equal(r.assessmentUnchanged,true);assert.equal(r.provider,'provider_unknown');assert.equal(r.executionAuthorized,false);assert.ok(r.staffDiagnostics.some(g=>g.kind==='missing_provider_activity'));
 assert.ok(r.staffDiagnostics.every(g=>Object.keys(g).sort().join(',')==='blocksAffirmativeEligibility,blocksExecution,category,kind,origin'));
});
for(const field of ['assessment','gapReport','checkpoint','assemblerInput','secret'])test(`denial leaking ${field} fails`,async()=>{const x=setup(),load=x.load;x.load=async s=>s.label==='staff'?load(s):{...await load(s),[field]:'SECRET'};await assert.rejects(verifyReads(x));});
for(const change of [r=>r.assessment.assessment.reasonCodes.push('changed'),r=>r.assessment.gapReport.policyBlocks=[],r=>r.assessment.gapReport.executionAuthorized=true,r=>r.assessment.gapReport.evidenceGaps[0].kind='SECRET',r=>r.checkpoint.revision='128'])test('unsafe composition evidence prevents receipt',async()=>{const x=setup(),load=x.load;x.load=async s=>{const r=await load(s);if(s.label==='staff')change(r);return r};await assert.rejects(verifyReads(x));});
test('database drift blocks success',async()=>{const x=setup();let n=0;x.read=async()=>({...checkpoint(),revision:++n===1?'127':'128'});await assert.rejects(verifyReads(x));});
test('unverified principal never opens database connection',async()=>{const load=fixedLoader({connect:()=>assert.fail('unexpected connection')});assert.equal((await load({label:'unauthorized',userId:'unverified-principal'})).status,'denied');});
const env={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',VEGA_SANDBOX_PAYMENT_EXECUTION:'disabled',SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',RENDER_GIT_COMMIT:'a'.repeat(40),VEGA_REFUND_VERIFY_COMMIT:'a'.repeat(40),APP_DATABASE_URL:'fixture'};
for(const key of Object.keys(env))test(`environment gate rejects ${key} drift`,()=>assert.throws(()=>validateEnvironment({...env,[key]:undefined},[])));
test('runner has fixed watchdog and read-only connection defaults',()=>{const s=readFileSync(new URL('../scripts/verify-refund-composition-job.mjs',import.meta.url),'utf8');assert.match(s,/110000/);assert.match(s,/default_transaction_read_only=on/);assert.doesNotMatch(s,/fetch\(|createServer|start-web|createDirectPayments/);});
