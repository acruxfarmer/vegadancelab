import pg from 'pg';
import { createHash } from 'node:crypto';
import { databaseTls } from './database-tls.mjs';
import { ApplicationError,transition,visibleState } from '../application.mjs';
import {reviewClassEdit} from '../class-editing.mjs';

export function applicationDatabaseOptions(value){
 const u=new URL(value),ref='cjdoczrxcjynjhgpgqop';
 const direct=u.hostname===`db.${ref}.supabase.co`,pooler=/^aws-\d+-us-west-1\.pooler\.supabase\.com$/.test(u.hostname);
 if(!['postgres:','postgresql:'].includes(u.protocol)||(!direct&&!pooler)||u.pathname!=='/postgres'||!['','5432','6543'].includes(u.port)||decodeURIComponent(u.username)!==(direct?'vega_app_runtime':`vega_app_runtime.${ref}`)||!u.password)throw new Error('Invalid application database configuration');
 return {host:u.hostname,port:Number(u.port||5432),database:'postgres',user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:databaseTls(u.hostname),connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'vega-development-application'};
}
export function createApplicationStore(pool){
 async function transaction(userId,fn){
  const client=await pool.connect();
  try{
   await client.query('begin');
   await client.query("select set_config('vega.actor_id',$1,true)",[userId]);
   const {rows}=await client.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[userId]);
   if(rows.length!==1)throw new ApplicationError('No unambiguous Vega access assignment',403);
   const m=rows[0], authority={userId,tenantId:m.tenant_id,businessId:m.business_id,role:m.role,participantIds:m.participant_ids};
   const result=await fn(client,authority);await client.query('commit');return result;
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
 }
 async function stateRow(client,a,lock=false){
  const {rows}=await client.query(`select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2${lock?' for update':''}`,[a.tenantId,a.businessId]);
  if(rows.length!==1)throw new ApplicationError('Studio application data is not initialized',503);return rows[0];
 }
 return {
  check:async()=>{const {rows}=await pool.query(`select current_user as role,
   not r.rolsuper and not r.rolbypassrls as restricted,
   has_table_privilege(current_user,'vega_private.app_state','SELECT') and has_table_privilege(current_user,'vega_private.app_state','UPDATE')
   and has_table_privilege(current_user,'vega_private.app_members','SELECT')
   and has_table_privilege(current_user,'vega_private.app_commands','SELECT') and has_table_privilege(current_user,'vega_private.app_commands','INSERT') as state_access,
   has_table_privilege(current_user,'vega_private.app_members','INSERT,UPDATE,DELETE') as can_assign,
   (select count(*)=3 and bool_and(c.relrowsecurity and c.relforcerowsecurity and c.relowner<>r.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='vega_private' and c.relname in ('app_state','app_members','app_commands')) as isolated
   from pg_roles r where r.rolname=current_user`);if(rows[0]?.role!=='vega_app_runtime'||!rows[0].restricted||!rows[0].isolated||!rows[0].state_access||rows[0].can_assign)throw new Error('Application identity not ready');return true;},
  read:userId=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);let jobs=[];
   if(a.role==='staff'){
    const result=await c.query(`select i.event_id as id,i.event_type as type,coalesce(j.status,'pending') as status,j.reason as "lastError",i.received_at as "createdAt" from vega_private.square_webhook_inbox i left join vega_private.square_processing_journal j using(event_id) order by i.received_at desc limit 100`);
    jobs=result.rows;
   }
   return {mode:'development',context:{name:'Vega Dance Lab',...a},revision:row.revision,...visibleState(row.state,a),jobs,squareEnabled:false};
  }),
  reviewClassEdit:(userId,body)=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);
   return reviewClassEdit(row.state,body,a,new Date().toISOString(),(message,status)=>{throw new ApplicationError(message,status);});
  }),
  command:(userId,command)=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a,true),requestId=command.body?.requestId;
   // A command may wait behind another transaction. Recheck authority after the wait.
   const assigned=await c.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[userId]);
   const latest=assigned.rows[0];
   if(assigned.rows.length!==1||latest.tenant_id!==a.tenantId||latest.business_id!==a.businessId||latest.role!==a.role||JSON.stringify(latest.participant_ids)!==JSON.stringify(a.participantIds))throw new ApplicationError('Access changed. Reload your account before continuing.',403);
   if(typeof requestId!=='string'||!requestId.trim()||requestId.length>128)throw new ApplicationError('A request identifier is required');
   const fingerprint=createHash('sha256').update(JSON.stringify(command)).digest('hex');
   const {rows}=await c.query('select fingerprint,response from vega_private.app_commands where tenant_id=$1 and business_id=$2 and actor_id=$3 and request_id=$4',[a.tenantId,a.businessId,userId,requestId]);
   if(rows.length){if(rows[0].fingerprint!==fingerprint)throw new ApplicationError('Request identifier already used for another operation',409);return rows[0].response;}
   const next=transition(row.state,command,a);
   await c.query('update vega_private.app_state set state=$1,revision=revision+1,updated_at=now() where tenant_id=$2 and business_id=$3',[JSON.stringify(next.state),a.tenantId,a.businessId]);
   await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[a.tenantId,a.businessId,userId,requestId,fingerprint,JSON.stringify(next.result)]);
   return next.result;
  }),
  close:()=>pool.end()
 };
}
export function createApplicationDatabase(value){const pool=new pg.Pool({...applicationDatabaseOptions(value),max:5});pool.on('error',()=>{});return createApplicationStore(pool);}
