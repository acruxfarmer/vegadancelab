import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {inventory} from './lifecycle-migration-catalog.mjs';

export const RUNNER_VERSION='lifecycle-migration-runner/1';
export const PROPOSAL_HASH='a8412f7102bedcbe6d3033fdfe1be6232f7cc3d86232676106382686a02f3072';
export const PROJECT='cjdoczrxcjynjhgpgqop';
export const LOCK='vega:authorization-lifecycle-v1:installation';
const manifestFile=new URL('../docs/refund-readiness/lifecycle-runner-approved-catalog.json',import.meta.url);
const manifestHash='0573070d7d64a46be7fae5ede08d0ea2599a43496568d570a4b1ef5c3ddf4d27';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const states=new Set(['prepared','locked','dispatch_intent_recorded','dispatched','acknowledged','outcome_unknown','reconciled_fully_applied','reconciled_absent','reconciled_conflicting','failed_before_dispatch']);
const ref=(s,prefix)=>typeof s==='string' && new RegExp('^'+prefix+'[a-zA-Z0-9_-]{1,100}$').test(s);

// Validation only. No credentials are retrieved and no operational connection is enabled.
export function developmentConnectionOptions(value) {
  const u=new URL(value);
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==`db.${PROJECT}.supabase.co`||!['','5432'].includes(u.port)||u.pathname!=='/postgres'||decodeURIComponent(u.username)!=='postgres'||!u.password||u.search||u.hash)throw Error('DEVELOPMENT_DIRECT_ADMIN_REQUIRED');
  return {host:u.hostname,port:5432,database:'postgres',user:'postgres',password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true,servername:u.hostname},connectionTimeoutMillis:10000,application_name:RUNNER_VERSION};
}
export function runDevelopmentMigration(){throw Error('DEVELOPMENT_TRANSPORT_NOT_ENABLED');}

export function readJournal(directory,attemptId) {
  if(!ref(attemptId,'attempt-'))throw Error('INVALID_ATTEMPT_REFERENCE');
  const file=path.join(directory,attemptId+'.jsonl');
  if(!fs.existsSync(file))return [];
  const text=fs.readFileSync(file,'utf8');
  if(!text.endsWith('\n'))throw Error('INCOMPLETE_JOURNAL_BLOCKS_EXECUTION');
  let previous=null;
  return text.trimEnd().split('\n').map((line,index)=>{
    const row=JSON.parse(line),{digest,...body}=row;
    if(row.sequence!==index||row.previousDigest!==previous||row.attemptId!==attemptId||!states.has(row.state)||sha(JSON.stringify(body))!==digest)throw Error('INVALID_JOURNAL_BLOCKS_EXECUTION');
    previous=digest;return row;
  });
}
function append(directory,attemptId,body) {
  const history=readJournal(directory,attemptId),last=history.at(-1);
  const row={...body,attemptId,sequence:history.length,previousDigest:last?.digest??null,timestamp:new Date().toISOString()};
  row.digest=sha(JSON.stringify(row));
  const fd=fs.openSync(path.join(directory,attemptId+'.jsonl'),history.length?'a':'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return row;
}
function normalize(catalog,owner){
  const result=structuredClone(catalog);
  for(const row of [...result.relations,...result.functions]){
    if(row.owner!==owner)throw Error('UNEXPECTED_CATALOG_OWNER');
    row.owner='$OWNER';if(row.acl)row.acl=row.acl.replaceAll(owner,'$OWNER');
  }
  return result;
}
export async function classifyCatalog(client,owner){
  const observed=await inventory(client);
  if(!observed.relations.length&&!observed.functions.length&&!observed.triggers.length&&!observed.constraints.length)return {classification:'absent',digest:sha(JSON.stringify(observed))};
  const bytes=fs.readFileSync(manifestFile);if(sha(bytes)!==manifestHash)throw Error('CATALOG_MANIFEST_HASH_MISMATCH');
  let normalized;try{normalized=normalize(observed,owner);}catch{return {classification:'conflicting',digest:sha(JSON.stringify(observed))};}
  return {classification:JSON.stringify(normalized)===JSON.stringify(JSON.parse(bytes))?'fully_applied':'conflicting',digest:sha(JSON.stringify(observed))};
}

// The only executable entry point is pinned to an already established disposable cluster.
// Fault callbacks exist exclusively here; operational transport remains disabled above.
export async function runLocalMigration({attemptId,authorizationRef,journalDirectory,database,proposalFile,
  mode='execute',fixtureProxyPort,fixtureFault=async()=>{}}){
  if(!ref(attemptId,'attempt-')||!ref(authorizationRef,'approval-')||!/^runner_fixture_[a-f0-9]+$/.test(database)||!['execute','reconcile'].includes(mode))throw Error('INVALID_LOCAL_REQUEST');
  const runtime=JSON.parse(fs.readFileSync(new URL('../docs/refund-readiness/authorization-lifecycle-pg-runtime.json',import.meta.url)));
  if(runtime.host!=='127.0.0.1'||runtime.user!=='fixture_admin')throw Error('DISPOSABLE_IDENTITY_REQUIRED');
  const bytes=fs.readFileSync(proposalFile);if(sha(bytes)!==PROPOSAL_HASH)throw Error('PROPOSAL_HASH_MISMATCH');
  fs.mkdirSync(journalDirectory,{recursive:true});
  let history=readJournal(journalDirectory,attemptId),existing=history.length>0;
  const target={environment:'disposable-qualification',project:PROJECT,database};
  const base={runnerVersion:RUNNER_VERSION,target,proposalHash:PROPOSAL_HASH,expectedCatalogState:'absent',authorizationRef,dispatchStarted:false,acknowledgment:'not_started',sessionTermination:'not_connected',catalogClassification:null,reconciliationResult:null,executionAuthorized:false};
  if(existing){const first=history[0];if(JSON.stringify(first.target)!==JSON.stringify(target)||first.proposalHash!==PROPOSAL_HASH||first.authorizationRef!==authorizationRef)throw Error('ATTEMPT_BINDING_MISMATCH');}
  else {
    if(mode==='reconcile')throw Error('ATTEMPT_NOT_FOUND');
    try{append(journalDirectory,attemptId,{...base,state:'prepared'});}catch(e){if(e.code==='EEXIST')return {state:'duplicate_invocation',dispatchCount:0};throw e;}
  }
  let current=readJournal(journalDirectory,attemptId).at(-1),client,locked=false,submitted=false;
  const record=(state,extra={})=>{current=append(journalDirectory,attemptId,{...base,dispatchStarted:current.dispatchStarted,acknowledgment:current.acknowledgment,sessionTermination:current.sessionTermination,catalogClassification:current.catalogClassification,reconciliationResult:current.reconciliationResult,...extra,state});return current;};
  try{
    client=new pg.Client({host:'127.0.0.1',port:fixtureProxyPort??runtime.port,user:runtime.user,database,connectionTimeoutMillis:5000,application_name:RUNNER_VERSION});
    client.on('error',()=>{});await client.connect();
    const identity=(await client.query("select current_database() as database,current_user as role,session_user as session_role,current_setting('data_directory') as path,pg_backend_pid() as pid")).rows[0];
    if(identity.database!==database||identity.role!=='fixture_admin'||identity.session_role!=='fixture_admin'||identity.path.replaceAll('\\','/').toLowerCase()!==runtime.data.replaceAll('\\','/').toLowerCase())throw Error('DISPOSABLE_IDENTITY_MISMATCH');
    locked=(await client.query('select pg_try_advisory_lock(hashtextextended($1,0)) as acquired',[LOCK])).rows[0].acquired;
    if(!locked){if(!existing)record('failed_before_dispatch',{reconciliationResult:'lock_unavailable'});return {state:'lock_unavailable',dispatchCount:0};}
    // The same backend owns the lock and all subsequent queries.
    const pid=(await client.query('select pg_backend_pid() as pid')).rows[0].pid;
    if(pid!==identity.pid)throw Error('SESSION_AFFINITY_MISMATCH');
    current=readJournal(journalDirectory,attemptId).at(-1);
    if(existing||mode==='reconcile'){
      const catalog=await classifyCatalog(client,runtime.user);
      return record('reconciled_'+catalog.classification,{catalogClassification:catalog.classification,reconciliationResult:'inspection_only_no_redispatch',sessionTermination:'prior_backend_released_lock',backendPid:pid,catalogDigest:catalog.digest});
    }
    if(current.state!=='prepared')throw Error('ATTEMPT_ALREADY_ADVANCED');
    record('locked',{sessionTermination:'connected',backendPid:pid});
    const catalog=await classifyCatalog(client,runtime.user);
    if(catalog.classification!=='absent')return record('reconciled_'+catalog.classification,{catalogClassification:catalog.classification,reconciliationResult:'preflight_no_dispatch',catalogDigest:catalog.digest});
    // A new ID must not bypass an unresolved earlier attempt for the same target.
    for(const name of fs.readdirSync(journalDirectory).filter(x=>x.endsWith('.jsonl')&&x!==attemptId+'.jsonl')){
      const prior=readJournal(journalDirectory,name.slice(0,-6));
      if(JSON.stringify(prior[0].target)===JSON.stringify(target)&&prior.some(x=>['dispatch_intent_recorded','dispatched','outcome_unknown'].includes(x.state)))throw Error('PRIOR_ATTEMPT_REQUIRES_REVIEWED_RECOVERY');
    }
    await fixtureFault('before_intent',client);
    // Verify the connection is still alive before writing intent; no replacement client.
    if((await client.query('select pg_backend_pid() as pid')).rows[0].pid!==pid)throw Error('SESSION_AFFINITY_MISMATCH');
    record('dispatch_intent_recorded',{dispatchIntentAt:new Date().toISOString(),catalogClassification:'absent',reconciliationResult:'preflight_absent',backendPid:pid});
    await fixtureFault('after_intent',client);
    // This durable state means send was attempted; a crash may precede actual socket delivery.
    record('dispatched',{dispatchStarted:true,acknowledgment:'pending',backendPid:pid});
    submitted=true;
    const promise=client.query(bytes.toString('utf8'));promise.catch(()=>{});
    await fixtureFault('after_dispatch',client);
    await promise;
    record('acknowledged',{dispatchStarted:true,acknowledgment:'received',backendPid:pid});
    const after=await classifyCatalog(client,runtime.user);
    return record('reconciled_'+after.classification,{catalogClassification:after.classification,reconciliationResult:'post_dispatch',catalogDigest:after.digest,backendPid:pid});
  }catch{
    // No raw errors, connection strings, SQL or caller-supplied fault text enter the journal.
    const uncertain=submitted||current.dispatchStarted||readJournal(journalDirectory,attemptId).some(row=>['dispatch_intent_recorded','dispatched','outcome_unknown'].includes(row.state));
    return record(uncertain?'outcome_unknown':'failed_before_dispatch',{acknowledgment:submitted?'unavailable':current.acknowledgment,reconciliationResult:'stopped_no_retry',sessionTermination:'unknown'});
  }finally{
    if(client){try{await client.end();if(locked)record(current.state,{sessionTermination:'client_end_completed_backend_not_independently_verified'});}catch{}}
  }
}
