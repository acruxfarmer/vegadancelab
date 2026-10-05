// Read-only route qualification. Does not import or call the migration execution path.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkServerIdentity} from 'node:tls';
import pg from 'pg';
import {developmentConnectionOptions,PROJECT,PROPOSAL_HASH,LOCK} from '../src/lifecycle-migration-runner.mjs';
import {databaseTls,databaseCaFingerprint} from '../src/runtime/database-tls.mjs';

export const AUTHORIZATION='approval-development-admin-route-20261005';
export const JOURNAL_ROOT='D:\\JOES WIP\\ACRUX\\Codex Projects\\vega-commerce-68a-deployment\\lifecycle-migration-qualification\\administrative-route-journals';
export const SQL=Object.freeze({
  identity:"SELECT current_database() AS database,current_user AS role,session_user AS session_role,pg_backend_pid() AS pid,current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only,current_setting('default_transaction_read_only') AS default_read_only,(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='vega_private') AS schema_owner,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl",
  lock:'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
  unlock:'SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released',
  locks:"SELECT count(*)::int AS count FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted",
  peerGone:'SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1) AS gone'
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ensure=(condition)=>{if(!condition)throw Error('QUALIFICATION_CHECK_FAILED');};
export function verifiedTls(client,host){
  const socket=client.connection?.stream;
  ensure(socket?.encrypted===true && socket.authorized===true);
  const certificate=socket.getPeerCertificate();ensure(!checkServerIdentity(host,certificate));
  return {encrypted:true,chainAuthorized:true,hostnameVerified:true,certificateFingerprint:certificate.fingerprint256,protocol:socket.getProtocol(),caFingerprint:databaseCaFingerprint};
}

// Injectable dependencies are for offline tests only; the operator entry supplies pg.Client.
export async function qualifyRoute(secret,{Client=pg.Client,tlsCheck=verifiedTls,record=()=>{}}={}){
  const config=developmentConnectionOptions(secret);
  Object.assign(config,{ssl:databaseTls(config.host),options:'-c default_transaction_read_only=on',statement_timeout:10000,query_timeout:12000,application_name:'vega-admin-route-qualification-v1'});
  const result={status:'stopped',stage:'configuration',target:{environment:'development',project:PROJECT,database:'postgres',connectionMode:'direct',port:5432},sessions:[],locks:{},queries:[],automaticRetry:false,migrationDispatched:false,persistentWritesIssued:false,executionAuthorized:false};
  let first,second,firstClosed=false,secondClosed=false;
  async function query(c,name,args=[]){ensure(Object.hasOwn(SQL,name));result.queries.push(name);return (await c.query(SQL[name],args)).rows;}
  async function identify(c,label){
    const tls=tlsCheck(c,config.host);const row=(await query(c,'identity'))[0];
    ensure(row.database==='postgres'&&row.role==='postgres'&&row.session_role==='postgres'&&row.schema_owner==='postgres'&&row.read_only==='on'&&row.default_read_only==='on'&&row.ssl===true&&Number.isInteger(row.pid));
    const observation={label,...row,tls};result.sessions.push(observation);record('session_verified',observation);return row;
  }
  try{
    result.stage='first_connection';first=new Client(config);first.on('error',()=>{});await first.connect();const a=await identify(first,'first');
    result.stage='second_connection';second=new Client(config);second.on('error',()=>{});await second.connect();const b=await identify(second,'competing');ensure(a.pid!==b.pid);
    result.stage='first_lock';result.locks.firstAcquired=(await query(first,'lock',[LOCK]))[0].acquired;record('first_lock',result.locks);ensure(result.locks.firstAcquired===true);
    result.stage='competing_lock';result.locks.competingAcquired=(await query(second,'lock',[LOCK]))[0].acquired;record('competing_lock',result.locks);ensure(result.locks.competingAcquired===false);
    result.stage='session_affinity';const a2=await identify(first,'first_after_lock'),b2=await identify(second,'competing_after_rejection');ensure(a.pid===a2.pid&&b.pid===b2.pid);result.sessionAffinityVerified=true;
    result.stage='close_first';await first.end();firstClosed=true;record('first_client_closed',{backendPid:a.pid});
    result.stage='release_on_close';result.locks.reacquiredAfterFirstClose=(await query(second,'lock',[LOCK]))[0].acquired;record('reacquired',result.locks);ensure(result.locks.reacquiredAfterFirstClose===true);
    result.locks.firstBackendAbsent=(await query(second,'peerGone',[a.pid]))[0].gone;ensure(result.locks.firstBackendAbsent===true);
    result.stage='release_second';result.locks.explicitRelease=(await query(second,'unlock',[LOCK]))[0].released;ensure(result.locks.explicitRelease===true);result.locks.remainingOwnLocks=(await query(second,'locks'))[0].count;ensure(result.locks.remainingOwnLocks===0);
    const b3=await identify(second,'competing_after_release');ensure(b3.pid===b.pid);
    await second.end();secondClosed=true;result.status='PASS';result.stage='complete';
  }catch{
    result.status='STOPPED_RECONCILIATION_REQUIRED';record('stopped',{stage:result.stage});
  }finally{
    for(const [client,closed,label]of [[first,firstClosed,'first'],[second,secondClosed,'competing']]){
      if(client&&!closed){try{await client.end();result[label+'Cleanup']='client_end_completed';}catch{result[label+'Cleanup']='termination_unverified';}}
    }
    config.password=undefined;secret=undefined;
    result.completedAt=new Date().toISOString();result.databaseStateStatement='Only allowlisted metadata SELECTs and temporary session advisory locks; both sessions default read-only. No persistent application/schema write issued. Server logging/statistics and unrelated concurrent activity are not claimed unchanged.';
  }
  return result;
}

// Diagnostic classification only. The closed connection validator remains the authority.
// No value from the private payload or an exception is copied into these diagnostics.
export async function qualifyPrivateInput(raw,{qualify=qualifyRoute,validateConnection=developmentConnectionOptions,record=()=>{}}={}){
  const diagnostic={parsingCompleted:false,authorizationBindingMatched:null,expectedMode:'direct',endpointClassification:'unknown'};
  const fail=(reasonCode,stage)=>({status:'STOPPED_RECONCILIATION_REQUIRED',stage,reasonCode,diagnostic:{...diagnostic},automaticRetry:false,migrationDispatched:false,persistentWritesIssued:false,executionAuthorized:false});
  let input;
  try{if(typeof raw!=='string'||raw.length>32768)throw Error();input=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{return fail('PRIVATE_INPUT_PARSE_FAILED','private_input_parse');}
  diagnostic.parsingCompleted=true;
  if(!input||typeof input!=='object'||Array.isArray(input))return fail('CONNECTION_CONFIGURATION_INVALID','private_input_shape');
  diagnostic.authorizationBindingMatched=input.authorizationRef===AUTHORIZATION;
  if(!diagnostic.authorizationBindingMatched)return fail('AUTHORIZATION_REFERENCE_MISMATCH','authorization_binding');
  if(typeof input.adminDatabaseUrl!=='string')return fail('CONNECTION_CONFIGURATION_INVALID','connection_configuration');
  let u;
  try{u=new URL(input.adminDatabaseUrl);}catch{return fail('CONNECTION_CONFIGURATION_INVALID','connection_configuration');}
  if(!['postgres:','postgresql:'].includes(u.protocol))return fail('CONNECTION_CONFIGURATION_INVALID','connection_configuration');
  const directHost=`db.${PROJECT}.supabase.co`;
  const pooledHost=/\.pooler\.supabase\.com$/.test(u.hostname);
  if(pooledHost||(u.hostname===directHost&&u.port==='6543')){
    diagnostic.endpointClassification='pooled';return fail('POOLED_ENDPOINT_REJECTED','endpoint_classification');
  }
  if(u.hostname===directHost)diagnostic.endpointClassification='direct';
  if(u.hostname!==directHost)return fail('ENDPOINT_POLICY_REJECTED','endpoint_policy');
  try{
    decodeURIComponent(u.password);
    if(!['','5432'].includes(u.port)||u.pathname!=='/postgres'||decodeURIComponent(u.username)!=='postgres'||!u.password||u.search||u.hash)return fail('CONNECTION_CONFIGURATION_INVALID','connection_configuration');
  }catch{return fail('CONNECTION_CONFIGURATION_INVALID','connection_configuration');}
  try{
    // Invoke the original validator unchanged; classification never grants acceptance.
    validateConnection(input.adminDatabaseUrl);
    const result=await qualify(input.adminDatabaseUrl,{record});
    return {...result,diagnostic:{...diagnostic}};
  }catch{return fail('HELPER_VALIDATION_FAILED','helper_validation');}
  finally{delete input.adminDatabaseUrl;raw=undefined;u=undefined;}
}

async function operator(){
  if(process.argv.length!==3||process.argv[2]!=='--operator-read-only')throw Error('EXPLICIT_OPERATOR_MODE_REQUIRED');
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||process.env.NODE_OPTIONS)throw Error('UNSAFE_RUNTIME_OPTIONS');
  const proposal=new URL('../db/proposals/authorization-lifecycle-v1.sql',import.meta.url);ensure(sha(fs.readFileSync(proposal))===PROPOSAL_HASH);
  fs.mkdirSync(JOURNAL_ROOT,{recursive:true});ensure(!fs.lstatSync(JOURNAL_ROOT).isSymbolicLink());
  const attemptId='admin-route-'+crypto.randomUUID(),journalPath=path.join(JOURNAL_ROOT,attemptId+'.jsonl'),receiptPath=path.join(JOURNAL_ROOT,attemptId+'-receipt.json');
  const fd=fs.openSync(journalPath,'wx',0o600);let prior=null,sequence=0;
  const record=(state,detail)=>{const body={contract:'development-admin-route/1',attemptId,authorizationRef:AUTHORIZATION,targetProject:PROJECT,proposalHash:PROPOSAL_HASH,sequence:sequence++,previousDigest:prior,state,timestamp:new Date().toISOString(),detail};prior=sha(JSON.stringify(body));fs.writeFileSync(fd,JSON.stringify({...body,digest:prior})+'\n');fs.fsyncSync(fd);};
  let receipt={status:'STOPPED_RECONCILIATION_REQUIRED',stage:'private_input'};
  try{
    record('prepared',{journalRoot:JOURNAL_ROOT,helperHash:sha(fs.readFileSync(fileURLToPath(import.meta.url))),migrationDisabled:true});
    let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)break;}
    receipt=await qualifyPrivateInput(raw,{record});raw='';
    if(receipt.reasonCode)record('stopped',{stage:receipt.stage,reasonCode:receipt.reasonCode,diagnostic:receipt.diagnostic});
  }catch{
    receipt={status:'STOPPED_RECONCILIATION_REQUIRED',stage:'helper_validation',reasonCode:'HELPER_VALIDATION_FAILED',diagnostic:{parsingCompleted:false,authorizationBindingMatched:null,expectedMode:'direct',endpointClassification:'unknown'}};
    record('stopped',{stage:receipt.stage,reasonCode:receipt.reasonCode,diagnostic:receipt.diagnostic});
  }
  finally{
    Object.assign(receipt,{attemptId,authorizationRef:AUTHORIZATION,journalPath,proposalHash:PROPOSAL_HASH,developmentMigrationDisabled:true,revisionBaseline:127,revisionReobserved:false,provider:'provider_unknown',policyBlocks:['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED'],executionAuthorized:false,workerSettingsChanged:false,productionAccess:false});
    record('receipt',{status:receipt.status,stage:receipt.stage,...(receipt.reasonCode?{reasonCode:receipt.reasonCode,diagnostic:receipt.diagnostic}:{})});fs.closeSync(fd);
    const out=fs.openSync(receiptPath,'wx',0o600);try{fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');fs.fsyncSync(out);}finally{fs.closeSync(out);}
    console.log(JSON.stringify({status:receipt.status,receiptPath,journalPath}));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))operator().catch(()=>{console.log(JSON.stringify({status:'STOPPED_BEFORE_RECEIPT',automaticRetry:false}));process.exitCode=1;});
