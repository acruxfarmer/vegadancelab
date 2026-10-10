import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=x=>createHash('sha256').update(x).digest('hex');
const norm=x=>Buffer.from(x.toString('utf8').replace(/\r\n/g,'\n'));
const baselines=['docs/refund-readiness/acquisition-trust-baseline-hashes.json','docs/refund-readiness/authorization-lifecycle-baseline-hashes.json','docs/refund-readiness/operational-coordinator-baseline-hashes.json','docs/refund-readiness/original-acceptance-baseline-hashes.json','docs/commerce-610/projection-compatibility-baseline-hashes.json','docs/refund-readiness/purchase-acquisition-receipt-baseline-hashes.json','docs/commerce-610/single-consumption-correction-baseline-hashes.json'];
const historical={
 'src/application.mjs':['d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e','checkout_crlf','Rental commands and safe status projection'],
 'src/commerce.mjs':['d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e','repository','Pre-existing commerce evolution, unchanged by rental build'],
 'src/payments.mjs':['d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e','repository','Frozen quote expiry and legitimate withdrawal checks'],
 'src/refund-eligibility.mjs':['697de1a7f3b7f7be350a4db9215df01d4a59d375','repository','Historical fulfillment independent of rental expiry; consumed viewing remains consumed'],
 'src/runtime/application-api.mjs':['697de1a7f3b7f7be350a4db9215df01d4a59d375','checkout_crlf','Three rental management routes using existing authenticated commands'],
 'src/runtime/application-database.mjs':['697de1a7f3b7f7be350a4db9215df01d4a59d375','checkout_crlf','Pre-existing database evolution, unchanged by rental build'],
 'src/runtime/payment-workflow.mjs':['d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e','repository','Pre-existing payment evolution, unchanged by rental build'],
 'src/runtime/web.mjs':['56d03e745add11a253078cdadf9b673f13b64f67','checkout_crlf','Pre-existing web evolution, unchanged by rental build'],
 'src/runtime/providers/square.mjs':['d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e','repository','Pre-existing provider evolution, unchanged by rental build']
};
const git=(rev,path)=>execFileSync('git',['show',rev+':'+path]);
const handoff=JSON.parse(fs.readFileSync('docs/layer-6/vod-rental-development-handoff.json','utf8'));
const report={status:'reconciled_without_baseline_edits',checkpoint:'ccfe301',originalAssertionsStillFail:7,baselines:[],files:{},limitations:'Historical byte-equality assertions remain historical assertions. This additive reconciliation verifies their original bytes and binds authorized current deltas; it does not replace behavioral, hosted or provider tests.'};
for(const file of baselines){
 const bytes=fs.readFileSync(file),baseline=JSON.parse(bytes.toString().replace(/^\uFEFF/,''));let unchanged=0,differences=[];
 for(const [raw,expected] of Object.entries(baseline)){
  const path=raw.includes('/')?raw:'src/'+raw,current=fs.readFileSync(path);
  if(hash(current)===expected){unchanged++;continue;}
  const item=historical[path];assert.ok(item,'Unreconciled source change: '+path);
  const [commit,encoding,reason]=item;let original=git(commit,path);if(encoding==='checkout_crlf')original=Buffer.from(norm(original).toString().replace(/\n/g,'\r\n'));
  assert.equal(hash(original),expected,'Historical source mismatch: '+path);
  const checkpoint=git('ccfe301',path),changedSinceCheckpoint=hash(norm(current))!==hash(norm(checkpoint));
  if(changedSinceCheckpoint)assert.equal(hash(current),(handoff.sourceSha256[path]??({'src/runtime/application-api.mjs':'714f809f0d42b514b60510d53cf5ced96a95fb781a806416305e6e3eba05f404'})[path]),'Current source drift beyond reviewed rental checkpoint: '+path);
  else assert.equal(hash(norm(current)),hash(norm(checkpoint)));
  report.files[path]={historicalCommit:commit,historicalEncoding:encoding,historicalSha256:expected,currentSha256:hash(current),checkpointRepositorySha256:hash(checkpoint),changedSinceCheckpoint,reason};differences.push(path);
 }
 report.baselines.push({file,sha256:hash(bytes),entries:Object.keys(baseline).length,unchanged,differences});
}
report.closedSlices=['l6-s8b','l6-s9'].map(name=>{const path='docs/layer-6/'+name+'-canonical-closure.json';assert.deepEqual(fs.readFileSync(path),git('ccfe301',path));return {path,unchanged:true,sha256:hash(fs.readFileSync(path))};});
fs.writeFileSync('docs/layer-6/vod-rental-source-reconciliation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,baselines:report.baselines.length,uniqueChangedFiles:Object.keys(report.files).length,preExisting:Object.values(report.files).filter(x=>!x.changedSinceCheckpoint).length,rentalChanges:Object.values(report.files).filter(x=>x.changedSinceCheckpoint).length,closedSlicesUnchanged:true}));
