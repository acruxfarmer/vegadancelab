import {createApplicationDatabase} from '../src/runtime/refund-application-database.mjs';
import {createSquareRefundAdapter,refundTransportEnabled,refundProgramTransportEnabled} from '../src/runtime/providers/square-refunds.mjs';
import {reconcileRefundInventory} from '../src/refund-reconciliation.mjs';

// Existing application runtime identity, read-only inspection. Not an operator
// credential route, migration tool, authentication substitute or refund trigger.
let store;
try{
 const [userId,purchaseId]=process.argv.slice(2);
 if(process.env.VEGA_ENV!=='development'||process.env.VEGA_EXTERNAL_EFFECTS!=='disabled'||refundTransportEnabled(process.env)||refundProgramTransportEnabled(process.env)||!/^[a-f0-9-]{36}$/.test(userId??'')||!/^[a-f0-9-]{36}$/.test(purchaseId??''))throw Error('guard');
 store=createApplicationDatabase(process.env.APP_DATABASE_URL);
 const before=await store.refundContext(userId,purchaseId);
 const evidence=await createSquareRefundAdapter(process.env).inventory(before.purchase);
 const report=reconcileRefundInventory({purchase:before.purchase,operations:before.operations,evidence,at:new Date().toISOString()});
 const after=await store.refundContext(userId,purchaseId);
 if(before.revision!==after.revision||before.stateDigest!==after.stateDigest)throw Error('state changed');
 console.log(JSON.stringify({status:report.status,build:process.env.RENDER_GIT_COMMIT,beforeRevision:before.revision,afterRevision:after.revision,stateDigest:after.stateDigest,purchaseId,completedMinor:report.completedMinor,pendingMinor:report.pendingMinor,remainingProviderMinor:report.remainingProviderMinor,matchedCount:report.matches.length,externalCount:report.external.length,reasonCodes:report.reasonCodes,evidenceDigest:report.evidenceDigest,cutoff:report.cutoff,legacyExecutionEnabled:false,programExecutionEnabled:false,executionAuthorized:false,providerSubmission:false,businessMutation:false,historyCompleteness:'unknown',authenticationQualification:'Runtime scope check only; current session verified separately in staff UI'}));
}catch{console.error('Refund program read-only verification stopped; no submission or automatic retry.');process.exitCode=1;}finally{await store?.close();}
