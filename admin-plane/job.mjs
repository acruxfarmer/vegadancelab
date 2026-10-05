import fs from 'node:fs';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {canonical,sha,verifyApproval,requireThat} from './contract.mjs';
import {requireIsolatedEnvironment} from './render-adapter.mjs';

// No retries, redirects, SQL dispatch or dynamic module selection.
export function journalRequest(base, ca, token, route, body) {
  const u = new URL(base); requireThat(u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash, 'JOURNAL_ENDPOINT');
  const bytes = JSON.stringify(body);
  return new Promise((resolve,reject) => {
    const req = https.request(new URL(route,u),{method:'POST',ca,rejectUnauthorized:true,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':Buffer.byteLength(bytes)},timeout:15000},res => {
      let raw = ''; res.on('data',chunk => { raw += chunk; if(raw.length > 131072) req.destroy(); });
      res.on('end',() => { try { const result = JSON.parse(raw); requireThat(res.statusCode === 200 && result.ok, 'JOURNAL_REJECTED'); resolve(result.result); } catch { reject(Error('JOURNAL_RESPONSE_UNKNOWN')); } });
      res.on('error',() => reject(Error('JOURNAL_RESPONSE_UNKNOWN')));
    });
    req.on('timeout',() => req.destroy()); req.on('error',() => reject(Error('JOURNAL_RESPONSE_UNKNOWN'))); req.end(bytes);
  });
}

export async function runJob({envelope,publicKey,expectedDigest,buildCommit,artifactDigest,request,qualify,now = Date.now()}) {
  const digest = verifyApproval(envelope,publicKey,now), m = envelope.manifest;
  requireThat(digest === expectedDigest && m.runner.buildCommit === buildCommit && m.runner.artifactDigest === artifactDigest, 'JOB_BUILD_BINDING');
  await request('/claim',{envelope});
  // Losing either acknowledgment stops before any database observation.
  await request('/append',{envelope,state:'observation_started',evidence:{migrationDispatched:false}});
  let result;
  try { result = await qualify(m); }
  catch { await request('/append',{envelope,state:'outcome_unknown',evidence:{migrationDispatched:false}}); return {status:'outcome_unknown',executionAuthorized:false}; }
  await request('/append',{envelope,state:result.state,evidence:result.evidence});
  return {status:result.state,resultDigest:sha(canonical(result)),executionAuthorized:false};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    requireIsolatedEnvironment(process.env);
    const [attempt,digest] = process.argv.slice(2);
    const envelope = JSON.parse(process.env.ACRUX_APPROVAL_ENVELOPE || 'null');
    requireThat(envelope?.manifest.attemptId === attempt, 'ATTEMPT_BINDING');
    // The closed target adapter is loaded only after manifest verification in runJob.
    const {qualifyVega} = await import('./targets/vega-development.mjs');
    const artifact = JSON.parse(fs.readFileSync(new URL('./artifact.json',import.meta.url)));
    for (const [file,hash] of Object.entries(artifact.files)) requireThat(sha(fs.readFileSync(new URL('../'+file,import.meta.url))) === hash, 'ARTIFACT_CHANGED');
    const result = await runJob({envelope,publicKey:process.env.ACRUX_APPROVAL_PUBLIC_KEY,expectedDigest:digest,buildCommit:process.env.RENDER_GIT_COMMIT,artifactDigest:sha(canonical(artifact.files)),request:(route,body) => journalRequest(process.env.ACRUX_JOURNAL_URL,process.env.ACRUX_JOURNAL_CA,process.env.ACRUX_JOURNAL_TOKEN,route,body),qualify:m => qualifyVega(m,process.env.DIRECT_ADMIN_DATABASE_URL)});
    console.log(JSON.stringify(result));
  } catch { console.log('{"status":"STOPPED_RECONCILIATION_REQUIRED","automaticRetry":false,"migrationDispatched":false}'); process.exitCode = 1; }
}
