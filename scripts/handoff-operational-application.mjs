import pg from 'pg';
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {applicationDatabaseOptions} from '../src/runtime/application-database.mjs';
import {workerDatabaseOptions} from '../src/runtime/worker.mjs';
import {databaseOptions} from '../src/runtime/database.mjs';
import {connectionFailure} from '../src/database-diagnostic.mjs';

const services={web:{id:'srv-dao5cjbm8hqs73db51j0',name:'vega-development-web',type:'web_service'},worker:{id:'srv-dao5e26gekts73av4q00',name:'vega-development-worker',type:'background_worker'}};
const contracts={
 vega_app_runtime:{app_members:['SELECT'],app_state:['SELECT','UPDATE'],app_commands:['SELECT','INSERT'],app_provider_bindings:['SELECT'],square_webhook_inbox:['SELECT'],square_processing_journal:['SELECT']},
 vega_worker_runtime:{square_webhook_inbox:['SELECT'],square_processing_journal:['SELECT','INSERT'],square_financial_observations:['SELECT','INSERT']}
};
export async function verifyOperationalRole(client,role,{operatorInspection=false}={}){
 const expected=contracts[role];
 if(!expected)throw Error('Unknown role');
 const {rows}=await client.query(`select rolname as role,current_user as session_role,rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls as elevated,
 exists(select 1 from pg_auth_members where member=r.oid) as member,
 has_schema_privilege(r.oid,'vega_private','CREATE') as can_create
 from pg_roles r where rolname=$1`,[role]);
 if(rows.length!==1||rows[0].role!==role||rows[0].session_role!==(operatorInspection?'postgres':role)||rows[0].elevated||rows[0].member||rows[0].can_create)throw Error('Restricted role required');
 const tables=await client.query(`select c.relname,c.relrowsecurity and c.relforcerowsecurity as forced_rls,c.relowner=(select oid from pg_roles where rolname=$1) as owns,
 array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege($1::name,c.oid,p)) as privileges
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vega_private' and c.relkind in ('r','p')`,[role]);
 for(const name of Object.keys(expected))if(!tables.rows.some(r=>r.relname===name))throw Error('Required table missing');
 for(const row of tables.rows){
  const allowed=expected[row.relname]??[];
  if(row.owns||(allowed.length&&!row.forced_rls)||row.privileges.length!==allowed.length||row.privileges.some(p=>!allowed.includes(p)))throw Error('Unexpected table authority');
 }
}
function verifier(password){
 if(!/^[A-Za-z0-9_-]{43}$/.test(password))throw Error('Unexpected stored password format');
 const salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
 const client=createHmac('sha256',salted).update('Client Key').digest();
 return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(client).digest('base64')}:${createHmac('sha256',salted).update('Server Key').digest('base64')}`;
}
export async function handoffOperationalApplication(input,{Client=pg.Client,fetcher=fetch}={}){
 let stage='configuration',operator,transaction=false;
 const activated=[];
 const report={squareSubscriptionChanged:false,ingestionCredentialsChanged:false,existingPasswordsReset:false};
 async function render(kind,path='',method='GET',body){
  const response=await fetcher(`https://api.render.com/v1/services/${services[kind].id}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${input.renderApiKey}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('Render request failed');
  if(response.status===204)return {};
  return response.json();
 }
 async function runtimeCheck(role,options){
  let client;
  try{client=new Client(options);await client.connect();await verifyOperationalRole(client,role);return true;}
  catch(error){if(['28000','28P01'].includes(error.code))return false;throw error;}
  finally{try{await client?.end();}catch{}}
 }
 try{
  if(!['probe','handoff'].includes(input.mode)||!input.renderApiKey||!/^[a-f0-9]{40}$/.test(input.commit)||input.supabaseUrl!=='https://cjdoczrxcjynjhgpgqop.supabase.co'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(input.supabasePublishableKey))throw Error('Invalid configuration');
  const roles={vega_app_runtime:applicationDatabaseOptions(input.appDatabaseUrl),vega_worker_runtime:workerDatabaseOptions(input.workerDatabaseUrl)};
  stage='Render_development_service_identity';
  for(const kind of ['web','worker']){
   const service=await render(kind),expected=services[kind];
   if(service.id!==expected.id||service.name!==expected.name||service.type!==expected.type||service.ownerId!=='tea-dand3tajnfac7387vm30'||service.environmentId!=='evm-dao55pijnfac73akca10'||service.repo?.replace(/\.git$/,'')!=='https://github.com/acruxfarmer/vegadancelab'||(kind==='web'&&service.serviceDetails?.url!=='https://vega-development-web.onrender.com'))throw Error('Wrong service');
  }
  stage='restricted_login_preflight';
  const missing=[];
  for(const [role,options] of Object.entries(roles))if(!await runtimeCheck(role,options))missing.push(role);
  if(missing.length&&input.mode==='probe')return {...report,status:'activation_required',roles:missing};
  if(missing.length){
   stage='operator_activation_connection';
   operator=new Client(databaseOptions(input.adminDatabaseUrl,{operator:true}));await operator.connect();await operator.query('begin');transaction=true;
   await operator.query("select pg_advisory_xact_lock(hashtext('vega_operational_runtime_activation'))");
   for(const role of missing){
    stage='restricted_role_activation_preflight';
    const {rows}=await operator.query('select rolcanlogin,(rolpassword is not null) as password_configured from pg_authid where rolname=$1',[role]);
    if(rows.length!==1||rows[0].rolcanlogin||rows[0].password_configured)throw Error('Existing credentials must not be replaced');
    // Inspect the named role without SET ROLE or changing operator memberships.
    await verifyOperationalRole(operator,role,{operatorInspection:true});
    stage='restricted_role_activation';
    await operator.query(`alter role ${role} login password '${verifier(roles[role].password)}'`);activated.push(role);
   }
   stage='activation_commit';await operator.query('commit');transaction=false;await operator.end();operator=null;
   stage='activated_login_verification';
   for(const role of missing)if(!await runtimeCheck(role,roles[role]))throw Error('Activated login unavailable');
  }
  if(input.mode==='probe')return {...report,status:'restricted_logins_verified'};
  stage='Render_individual_environment_updates';
  const vars={web:{APP_DATABASE_URL:input.appDatabaseUrl,SUPABASE_URL:input.supabaseUrl,SUPABASE_PUBLISHABLE_KEY:input.supabasePublishableKey},worker:{WORKER_DATABASE_URL:input.workerDatabaseUrl,VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'}};
  for(const [kind,values] of Object.entries(vars))for(const [name,value] of Object.entries(values))await render(kind,`/env-vars/${name}`,'PUT',{value});
  stage='Render_deployment_request';
  const deployments={};
  for(const kind of ['web','worker'])deployments[kind]=(await render(kind,'/deploys','POST',{commitId:input.commit})).id;
  return {...report,status:'operational_deployments_requested',commit:input.commit,deployments,activatedRoles:activated};
 }catch(error){
  if(transaction)try{await operator.query('rollback');}catch{}
  return {...report,status:'incomplete',stage,activatedRoles:activated,...(stage.includes('connection')||stage.includes('verification')?connectionFailure(error):{}),...(stage==='activation_commit'?{commitOutcome:'uncertain_retry_preserves_existing_passwords'}:{})};
 }finally{try{await operator?.end();}catch{}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>65536)throw Error('Input too large');}const report=await handoffOperationalApplication(JSON.parse(input));input='';console.log(JSON.stringify(report));if(report.status==='incomplete')process.exitCode=2;}
 catch{console.log(JSON.stringify({status:'incomplete',stage:'local_handoff'}));process.exitCode=2;}
}
