import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffOperationalApplication} from '../scripts/handoff-operational-application.mjs';
const input={mode:'handoff',commit:'a'.repeat(40),renderApiKey:'synthetic',supabaseUrl:'https://cjdoczrxcjynjhgpgqop.supabase.co',supabasePublishableKey:'sb_publishable_synthetic',appDatabaseUrl:`postgresql://vega_app_runtime:${'a'.repeat(43)}@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres`,workerDatabaseUrl:`postgresql://vega_worker_runtime:${'b'.repeat(43)}@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres`};
const contracts={vega_app_runtime:{app_members:['SELECT'],app_state:['SELECT','UPDATE'],app_commands:['SELECT','INSERT'],app_provider_bindings:['SELECT'],square_webhook_inbox:['SELECT'],square_processing_journal:['SELECT']},vega_worker_runtime:{square_webhook_inbox:['SELECT'],square_processing_journal:['SELECT','INSERT'],square_financial_observations:['SELECT','INSERT']}};
function dependencies({authFailure=false,wrongService=false,badPrivileges=false,existingPassword=false}={}){
 const requests=[],sql=[],activated=new Set();
 class Client{
  constructor(options){this.role=options.user;}
  async connect(){if(authFailure&&this.role!=='postgres'&&!activated.has(this.role))throw Object.assign(Error('sensitive'),{code:'28000'});}
  async end(){}
  async query(q,args){sql.push(q);if(q.startsWith('alter role'))activated.add(q.split(' ')[2]);
   if(q.includes('from pg_authid'))return {rows:[{rolcanlogin:false,password_configured:existingPassword}]};
   if(q.includes('from pg_roles r'))return {rows:[{role:args[0],session_role:this.role,elevated:false,member:false,can_create:false}]};
   if(q.includes('from pg_class c'))return {rows:Object.entries({...contracts.vega_app_runtime,...contracts.vega_worker_runtime}).map(([relname])=>({relname,forced_rls:true,owns:false,privileges:badPrivileges?['SELECT','UPDATE']:(contracts[args[0]]?.[relname]??[])}))};
   return {rows:[]};
  }
 }
 const fetcher=async(url,options)=>{requests.push({url,...options});const worker=url.includes('srv-dao5e26gekts73av4q00');return {ok:true,status:200,json:async()=>options.method==='GET'?{id:worker?'srv-dao5e26gekts73av4q00':'srv-dao5cjbm8hqs73db51j0',name:worker?'vega-development-worker':'vega-development-web',type:worker?'background_worker':'web_service',ownerId:wrongService?'other':'tea-dand3tajnfac7387vm30',environmentId:'evm-dao55pijnfac73akca10',repo:'https://github.com/acruxfarmer/vegadancelab',serviceDetails:{url:'https://vega-development-web.onrender.com'}}:{id:'deployment-synthetic'}};};
 return {Client,fetcher,requests,sql};
}
test('handoff updates only individually scoped variables and pins deployments',async()=>{
 const d=dependencies(),r=await handoffOperationalApplication(input,d);assert.equal(r.status,'operational_deployments_requested');
 const writes=d.requests.filter(x=>x.method!=='GET');assert.equal(writes.length,8);
 assert.deepEqual(writes.filter(x=>x.method==='PUT').map(x=>x.url.split('/').at(-1)),['APP_DATABASE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','WORKER_DATABASE_URL','VEGA_ENV','VEGA_EXTERNAL_EFFECTS']);
 for(const request of writes.filter(x=>x.method==='POST'))assert.equal(JSON.parse(request.body).commitId,input.commit);
 assert.ok(!d.sql.some(q=>q.includes('alter role')));
});
test('login probe requests activation without operator access or mutations',async()=>{
 const d=dependencies({authFailure:true}),r=await handoffOperationalApplication({...input,mode:'probe'},d);assert.equal(r.status,'activation_required');assert.equal(r.roles.length,2);assert.ok(d.requests.every(r=>r.method==='GET'));assert.equal(d.sql.length,0);
});
test('wrong Render identity or unexpected database authority blocks all mutations',async()=>{
 for(const settings of [{wrongService:true},{badPrivileges:true}]){const d=dependencies(settings),r=await handoffOperationalApplication(input,d);assert.equal(r.status,'incomplete');assert.ok(d.requests.every(r=>r.method==='GET'));}
});
test('activation never overwrites a preexisting password',async()=>{
 const d=dependencies({authFailure:true,existingPassword:true});
 const r=await handoffOperationalApplication({...input,adminDatabaseUrl:`postgresql://postgres:${'c'.repeat(43)}@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres`},d);
 assert.equal(r.status,'incomplete');assert.equal(r.stage,'restricted_role_activation_preflight');assert.ok(!d.sql.some(q=>q.includes('alter role')));assert.ok(d.requests.every(r=>r.method==='GET'));
});
test('new login activation inspects metadata without SET ROLE or membership grants',async()=>{
 const d=dependencies({authFailure:true});
 const r=await handoffOperationalApplication({...input,adminDatabaseUrl:`postgresql://postgres:${'c'.repeat(43)}@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres`},d);
 assert.equal(r.status,'operational_deployments_requested');
 assert.deepEqual(r.activatedRoles,['vega_app_runtime','vega_worker_runtime']);
 assert.equal(d.sql.filter(q=>q.startsWith('alter role')).length,2);
 assert.ok(!d.sql.some(q=>/^(?:set|reset|grant|revoke)\b/i.test(q)));
 assert.ok(d.sql.includes('commit'));
});
