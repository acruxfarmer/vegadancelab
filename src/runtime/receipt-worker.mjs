import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {databaseTls} from './database-tls.mjs';
import {createReceiptArchive} from './receipt-archive.mjs';
export function receiptDatabaseOptions(value){
 const u=new URL(value),ref='cjdoczrxcjynjhgpgqop',direct=u.hostname===`db.${ref}.supabase.co`;
 if(!['postgres:','postgresql:'].includes(u.protocol)||!(direct||/^aws-\d+-us-west-1\.pooler\.supabase\.com$/.test(u.hostname))||u.pathname!=='/postgres'||!['','5432','6543'].includes(u.port)||decodeURIComponent(u.username)!==(direct?'vega_receipt_runtime':`vega_receipt_runtime.${ref}`)||!u.password)throw new Error('Restricted Development receipt identity required');
 return {host:u.hostname,port:Number(u.port||5432),database:'postgres',user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:databaseTls(u.hostname),max:2,connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'vega-development-receipts'};
}
export async function checkReceiptWorker(pool){
 const {rows}=await pool.query(`select current_user as role,
 not (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls) as restricted,
 not exists(select 1 from pg_auth_members where member=r.oid) as no_inherited_role,
 not has_schema_privilege(current_user,'vega_private','CREATE') as no_schema_create,
 has_table_privilege(current_user,'vega_private.recovery_outbox','SELECT') as can_read,
 has_column_privilege(current_user,'vega_private.recovery_outbox','state','UPDATE') as can_deliver,
 not has_column_privilege(current_user,'vega_private.recovery_outbox','payload','UPDATE') as immutable_payload,
 not has_table_privilege(current_user,'vega_private.recovery_outbox','INSERT,DELETE,TRUNCATE') as cannot_replace,
 not exists(select 1 from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname='vega_private' and t.relkind in ('r','p') and t.relname<>'recovery_outbox' and has_table_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as no_other_data,
 c.relrowsecurity and c.relforcerowsecurity and c.relowner<>r.oid as isolated
 from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
 where r.rolname=current_user and n.nspname='vega_private' and c.relname='recovery_outbox'`);
 const row=rows[0];if(rows.length!==1||row.role!=='vega_receipt_runtime'||Object.entries(row).some(([key,value])=>key!=='role'&&value!==true))throw new Error('Restricted receipt worker authority not verified');
 return true;
}
export async function deliverReceiptBatch(pool,archive){
 const lease=randomUUID();
 // Claim commits before provider I/O. A crashed worker's lease expires, leaving
 // durable intent and exactly the same encrypted payload for the next worker.
 const {rows}=await pool.query(`with candidate as (
 select o.event_id from vega_private.recovery_outbox o
 where o.state<>'acknowledged' and o.available_at<=now()
 and (o.lease_until is null or o.lease_until<now())
 and not exists(select 1 from vega_private.recovery_outbox p where p.tenant_id=o.tenant_id and p.business_id=o.business_id and p.revision<o.revision and p.state<>'acknowledged')
 order by o.created_at,o.event_id for update skip locked limit 1)
 update vega_private.recovery_outbox o set state='delivering',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '120 seconds'
 from candidate c where o.event_id=c.event_id returning o.*`,[lease]);
 if(!rows.length)return {processed:0};
 const row=rows[0];
 try{
  const ack=await archive.deliver(row);
  if(ack.payloadDigest!==row.payload_digest||!ack.objectName||!ack.objectVersion||typeof ack.capturedAt!=='string'||!Number.isFinite(Date.parse(ack.capturedAt)))throw new Error('Receipt acknowledgment invalid');
  const saved=await pool.query(`update vega_private.recovery_outbox set state='acknowledged',object_name=$1,object_version=$2,provider_captured_at=$5,acknowledged_at=now(),lease_token=null,lease_until=null,last_error=null where event_id=$3 and lease_token=$4 and state='delivering'`,[ack.objectName,ack.objectVersion,row.event_id,lease,ack.capturedAt]);
  return {processed:saved.rowCount===1?1:0,acknowledgmentRecorded:saved.rowCount===1};
 }catch{
  // Includes accepted uploads whose responses were lost and failed local ACK
  // commits. Never repeat a business transition or claim the provider failed.
  await pool.query(`update vega_private.recovery_outbox set state='retry',last_error='delivery_or_acknowledgment_unconfirmed',available_at=now()+least(attempts*5,300)*interval '1 second',lease_token=null,lease_until=null where event_id=$1 and lease_token=$2 and state='delivering'`,[row.event_id,lease]);
  return {processed:0,pending:true};
 }
}
export function createReceiptWorker(env){
 const archive=createReceiptArchive(env),pool=new pg.Pool(receiptDatabaseOptions(env.RECEIPT_DATABASE_URL));pool.on('error',()=>{});
 return {check:()=>checkReceiptWorker(pool),process:()=>deliverReceiptBatch(pool,archive),close:()=>pool.end()};
}
