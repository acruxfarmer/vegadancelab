import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function reconcileFreshPreparation(before,infra,after,api){
 const same=(actual,expected,label)=>assert.deepEqual(actual,expected,label);
 same(api.status,'api_checks_passed_independent_database_reconciliation_required','API checks incomplete');
 same(api.candidate,'d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e','Runtime candidate changed');
 same(api.deploymentStatus,'live','Development deployment is not live');
 same(api.configurationAfter.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled','Execution configuration changed');
 same(api.configurationAfter.VEGA_EXTERNAL_EFFECTS,'disabled','External effects changed');
 same(api.configurationAfter.VEGA_ENV,'development','Wrong environment');
 same(api.configurationAfter.VEGA_SANDBOX_PURCHASE_ID,api.purchaseId,'Designation mismatch');
 same(api.squareRequestsByVerifier,0,'Verifier contacted Square');
 same(api.productionChanged,false,'Production changed');same(api.workerChanged,false,'Worker changed');
 same(api.beforeFirstAttempt.paymentStatus,'not_started','Attempt was not first-time');
 assert.ok(!api.beforeFirstAttempt.activeAttemptId&&!api.beforeFirstAttempt.paymentSummary,'Pre-existing attempt');
 same(after.revision,before.revision+3,'Expected draft plus two unique preparation command commits');
 same(after.unaffected_state_digest,before.unaffected_state_digest,'Unrelated domain state changed');
 for(const [key,value] of Object.entries(before.component_digests))if(!['purchaseDrafts','paymentAttempts','activity'].includes(key))same(after.component_digests[key],value,`${key} changed`);
 const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
 same(sorted(after.original_purchases),sorted(before.purchases),'Historical purchases changed');
 same(after.historical_attempt,before.attempts,'Historical attempt changed');
 same(after.original_activity_digest,before.activity_digest,'Historical activity changed');
 same(after.original_commands_digest,infra.commands_digest,'Historical commands changed');
 same(after.integrations,infra.integrations,'Registry changed');
 for(const key of ['inbox_count','inbox_digest','journal_count','journal_digest'])same(after[key],infra[key],`Square ${key} changed`);
 same(after.fresh_purchases.length,1,'Exactly one fresh purchase required');
 same(after.fresh_attempts.length,1,'Exactly one fresh attempt required');
 const d=after.fresh_purchases[0],a=after.fresh_attempts[0];
 same(d.id,api.purchaseId,'Purchase identity');same(a.id,api.attemptId,'Attempt identity');same(a.purchaseId,d.id,'Attempt owner');
 same(d.activeAttemptId,a.id,'Owned active attempt');same(a.integrationRef,infra.integrations[0].integration_ref,'Scoped integration');
 same(a.financialIntent,{amountMinor:6000,currency:'USD',collection:'immediate',method:'card',partialAllowed:false,tipsAllowed:false},'Owned financial intent');
 same(a.binding,undefined,'Native binding in fresh attempt');
 same(a.idempotencyKey,a.id,'Stable key');same(a.referenceId,a.id,'Stable reference');
 same(a.sourceDigest,null,'Payment source bound');same(a.prepareSourceDigest,null,'Preparation source');
 for(const key of ['executionStartedAt','executionRequestDigest','transactionRef','evidence'])assert.ok(a[key]==null,`${key} unexpectedly set`);
 same(a.paymentId,null,'Provider payment exists');same(a.paymentConfirmedAt,null,'Attempt confirmed');
 same(a.reason,'prepared_execution_disabled','Preparation reason');same(a.status,'pending','Attempt status');
 same(d.paymentStatus,'pending','Purchase status');same(d.status,'draft','Purchase no longer draft');same(d.fulfillmentStatus,'not_issued','Fulfillment occurred');
 for(const key of ['paymentConfirmedAt','validFrom','expiresAt','refundWindowStartsAt'])same(d[key],null,`${key} started`);
 same(d.terms,api.freshDraftBefore.terms,'Immutable purchase terms changed');
 for(const key of ['buyerId','participantId','tenantId','businessId','currency','subtotalMinor','taxMinor','totalMinor','createdAt','offerId','offerVersion','requestId'])same(d[key],api.freshDraftBefore[key],`Purchase ${key} changed`);
 same(after.activity_count,before.activity_count+2,'Unexpected domain events');
 same(after.appended_activity.map(e=>e.action),['purchase-draft','payment-intent'],'Unexpected side-effect event');
 assert.ok(after.appended_activity.every(e=>e.subjectId===d.id),'Wrong event scope');
 same(after.commands_count,infra.commands_count+3,'Unexpected commands');same(after.outbox_count,infra.outbox_count+3,'Unexpected recovery receipts');
 same(after.fresh_commands.length,3,'Missing command receipts');
 same(after.fresh_commands.map(c=>c.revision),[121,122,123],'Revision continuity');
 assert.ok(after.fresh_commands.every(c=>c.receiptState==='acknowledged'),'Independent receipt pending');
 const preparations=after.fresh_commands.filter(c=>c.requestId!==api.draftRequestId);
 same(preparations.map(c=>c.requestId).sort(),[...api.requestIds].sort(),'Unique request identities');
 assert.ok(preparations.every(c=>c.response.attemptId===a.id&&c.response.purchaseId===d.id),'Command results diverge');
 same(api.requests.length,5,'Concurrent request count');
 assert.ok(api.requests.every(r=>r.status===202&&r.attemptId===a.id&&r.executionEnabled===false),'Concurrent responses diverge');
 assert.ok(Math.max(...api.requests.map(r=>Date.parse(r.startedAt)))<Math.min(...api.requests.map(r=>Date.parse(r.finishedAt))),'Client request intervals did not overlap');
 assert.ok(api.checks.length>0&&api.checks.every(c=>c.passed),'Negative/reopening checks failed');
 for(const role of ['member','staff']){
  same(api[role+'Draft'].id,d.id,`${role} purchase visibility`);
  same(api[role+'Draft'].activeAttemptId,a.id,`${role} attempt visibility`);
  same(api[role+'Draft'].paymentSummary.integrationRef,a.integrationRef,`${role} integration visibility`);
 }
 return {status:'fresh_provider_neutral_preparation_verified',runtimeCandidate:api.candidate,deployment:api.deployment,purchaseId:d.id,attemptId:a.id,revisionBefore:before.revision,revisionAfter:after.revision,concurrentRequests:5,uniquePreparationCommands:2,newAttempts:1,newPurchases:1,allHistoricalRecordsPreserved:true,unaffectedDomainStatePreserved:true,independentRecoveryReceiptsAdded:3,providerExecution:'disabled',squareVerifierRequests:0,squareIntakeAndJournalUnchanged:true,limitations:['Single approved Development member/business only; no authenticated cross-account/business coverage.','Client requests overlapped; no server lock-wait trace was collected.','No Square transaction, payment success, fulfillment, refund, or settlement was exercised.','No network packet trace; zero payment-provider effects are supported by disabled gates, unreachable execution routes, unchanged provider journal, and local zero-call tests.','Existing recovery receipt delivery uses the established external recovery store; this is an expected audit effect, not a payment-provider effect.']};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dir=new URL('../docs/commerce-69-fresh/',import.meta.url);
 const json=name=>JSON.parse(readFileSync(new URL(name,dir),'utf8').replace(/^\uFEFF/,''));
 const api=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 const result=reconcileFreshPreparation(json('baseline.json'),json('infrastructure-baseline.json'),json('hosted-state.json'),api);
 for(const record of json('preserved-evidence-sha256.json'))assert.equal(createHash('sha256').update(readFileSync(record.path)).digest('hex').toUpperCase(),record.sha256,'Closed evidence file changed');
 writeFileSync(new URL('verification-result.json',dir),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
