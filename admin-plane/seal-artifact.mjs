// Local release preparation only. Signing the resulting digest is a separate
// cloud authorization action. This tool neither signs nor dispatches anything.
import fs from 'node:fs';
import {canonical,sha,requireThat} from './contract.mjs';
const root = new URL('../',import.meta.url);
const files = [
  'admin-plane/contract.mjs','admin-plane/journal.mjs','admin-plane/service.mjs',
  'admin-plane/approve.mjs','admin-plane/job.mjs','admin-plane/render-adapter.mjs','admin-plane/bootstrap.mjs',
  'admin-plane/targets/vega-development.mjs','admin-plane/seal-artifact.mjs',
  'scripts/qualify-development-admin-route.mjs','src/lifecycle-migration-runner.mjs',
  'src/lifecycle-migration-catalog.mjs','src/runtime/database-tls.mjs',
  'config/certificates/supabase-prod-ca-2021.crt','db/proposals/authorization-lifecycle-v1.sql',
  'docs/refund-readiness/lifecycle-runner-approved-catalog.json','package.json','pnpm-lock.yaml'
];
const hashes = Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(new URL(f,root)))]));
requireThat(hashes['db/proposals/authorization-lifecycle-v1.sql'] === 'a8412f7102bedcbe6d3033fdfe1be6232f7cc3d86232676106382686a02f3072','PROPOSAL_CHANGED');
fs.writeFileSync(new URL('admin-plane/artifact.json',root),JSON.stringify({contract:'acrux-administrative-artifact/1',files:hashes,artifactDigest:sha(canonical(hashes)),executionAuthorized:false},null,2)+'\n');
const baseline = JSON.parse(fs.readFileSync(new URL('docs/refund-readiness/lifecycle-runner-baseline-hashes.json',root)));
const changed = Object.entries(baseline).filter(([f,h])=>sha(fs.readFileSync(new URL(f,root)))!==h).map(([f])=>f);
requireThat(changed.length===0,'CLOSED_SOURCE_CHANGED');
console.log(JSON.stringify({artifactDigest:sha(canonical(hashes)),closedSourceFilesUnchanged:Object.keys(baseline).length,proposalUnchanged:true}));
