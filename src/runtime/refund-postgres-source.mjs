import {ownedInventoryCategories} from '../refund-inventory.mjs';

const identifier=x=>{if(typeof x!=='string'||! /^[a-z_][a-z0-9_]*$/.test(x))throw new Error('Invalid SQL identifier');return `"${x}"`;};
const text=x=>typeof x==='string'&&x.length>0;
const clone=x=>structuredClone(x);

// Trusted server configuration only. executeTransaction must execute this entire
// batch on ONE connection to the pinned Development database, and return the
// single SELECT envelope. It must discard/rollback a connection after any error.
// No user-supplied SQL, connection selection, role or schema is accepted.
export function createPostgresRefundSource({environment,connectionIdentity,expectedConnectionIdentity,schema,runtimeRole,actorSetting,scope,executeTransaction,verifyPrincipal}){
 if(environment!=='development'||!text(connectionIdentity)||connectionIdentity!==expectedConnectionIdentity)throw new Error('Pinned Development connection required');
 const ns=identifier(schema),role=identifier(runtimeRole);
 if(!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(actorSetting)||!['tenantId','businessId','purchaseId','attemptId'].every(k=>text(scope?.[k]))||typeof executeTransaction!=='function'||typeof verifyPrincipal!=='function')throw new Error('Trusted source configuration required');
 const bound=clone(scope);
 return Object.freeze({environment:'development',async withSnapshot(options,fn){
  if(options?.isolation!=='repeatable read'||options?.readOnly!==true)throw new Error('Read-only repeatable-read required');
  let envelope,authority,active=true,resolved=false;
  const ensure=()=>{if(!active)throw new Error('Snapshot reader expired');};
  const reader={
   async resolveAuthority(principal){
    ensure();if(resolved)throw new Error('Authority already resolved');resolved=true;
    const verified=await verifyPrincipal(principal);
    if(!text(verified?.userId))return null;
    const input={userId:verified.userId,tenantId:bound.tenantId,businessId:bound.businessId,purchaseId:bound.purchaseId,attemptId:bound.attemptId};
    const hex=Buffer.from(JSON.stringify(input),'utf8').toString('hex');
    const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL ROLE ${role};
SELECT set_config('${actorSetting}',(convert_from(decode('${hex}','hex'),'UTF8')::jsonb->>'userId'),true);
WITH request AS MATERIALIZED (SELECT convert_from(decode('${hex}','hex'),'UTF8')::jsonb AS j),
identity AS MATERIALIZED (
 SELECT current_user AS role,current_database() AS database,
 current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,
 NOT r.rolsuper AND NOT r.rolbypassrls AS restricted,
 (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner<>r.oid)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='${schema}' AND c.relname IN ('app_members','app_state','recovery_outbox')) AS isolated
 FROM pg_roles r WHERE r.rolname=current_user),
members AS MATERIALIZED (
 SELECT m.user_id,m.tenant_id,m.business_id,m.role FROM ${ns}.app_members m,request q
 WHERE m.user_id::text=q.j->>'userId'),
authority AS MATERIALIZED (
 SELECT m.* FROM members m,request q,identity i WHERE (SELECT count(*) FROM members)=1
 AND m.tenant_id=q.j->>'tenantId' AND m.business_id=q.j->>'businessId'
 AND i.restricted AND i.isolated AND i.read_only='on' AND i.isolation='repeatable read'),
owned AS MATERIALIZED (
 SELECT CASE WHEN EXISTS(SELECT 1 FROM authority WHERE role='staff') THEN
 (SELECT jsonb_build_object('tenantId',s.tenant_id,'businessId',s.business_id,'revision',s.revision::text,
 'state',s.state,'historicalMd5',md5(s.state::text),'observedAt',transaction_timestamp())
 FROM ${ns}.app_state s JOIN authority a ON a.tenant_id=s.tenant_id AND a.business_id=s.business_id)
 ELSE NULL END AS row)
SELECT jsonb_build_object('identity',(SELECT to_jsonb(i) FROM identity i),
 'authority',(SELECT jsonb_build_object('userId',user_id,'tenantId',tenant_id,'businessId',business_id,'role',role) FROM authority),
 'row',(SELECT row FROM owned),
 'recovery',CASE WHEN (SELECT row FROM owned) IS NOT NULL THEN
 (SELECT jsonb_agg(jsonb_build_object('id',o.event_id,'actorId',o.actor_id,'requestId',o.request_id,
 'tenantId',o.tenant_id,'businessId',o.business_id,'revision',o.revision::text,
 'previousRevision',o.previous_revision::text,'state',o.discovery_state,'payloadDigest',o.payload_digest) ORDER BY o.revision)
 FROM ${ns}.recovery_outbox o JOIN authority a ON a.tenant_id=o.tenant_id AND a.business_id=o.business_id
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce((SELECT row->'state'->'activity' FROM owned),'[]'::jsonb)) e
 WHERE e->>'requestId'=o.request_id AND e->>'actorId'=o.actor_id::text
 AND e->>'tenantId'=o.tenant_id AND e->>'businessId'=o.business_id
 AND e->>'subjectId'=(SELECT j->>'purchaseId' FROM request)
 AND (NOT e ? 'attemptId' OR e->>'attemptId'=(SELECT j->>'attemptId' FROM request)))) ELSE NULL END) AS envelope;
ROLLBACK;`;
    envelope=clone(await executeTransaction(sql));
    const i=envelope?.identity;
    if(i?.role!==runtimeRole||i.read_only!=='on'||i.isolation!=='repeatable read'||i.restricted!==true||i.isolated!==true)throw new Error('Database transaction/identity guarantees not established');
    authority=envelope.authority;
    if(authority&&(authority.userId!==verified.userId||authority.tenantId!==bound.tenantId||authority.businessId!==bound.businessId))throw new Error('Authority scope mismatch');
    return clone(authority);
   },
   async readOwnedState(request){
    ensure();if(!resolved||authority?.role!=='staff'||request.tenantId!==authority.tenantId||request.businessId!==authority.businessId)return null;
    const row=envelope.row;if(!row)return null;
    if(row.tenantId!==authority.tenantId||row.businessId!==authority.businessId)throw new Error('State scope mismatch');
    return {...clone(row),source:`postgres:${connectionIdentity}:${schema}.app_state`,schemaVersion:'1'};
   },
   async readOwnedEvidence(request){
    ensure();if(authority?.role!=='staff'||request.tenantId!==authority.tenantId||request.businessId!==authority.businessId||request.purchaseId!==bound.purchaseId||request.attemptId!==bound.attemptId)throw new Error('Evidence scope denied');
    const state=envelope.row?.state;
    const purchase=state?.purchaseDrafts?.find(p=>p.id===request.purchaseId&&p.tenantId===request.tenantId&&p.businessId===request.businessId);
    if(!purchase||purchase.activeAttemptId!==request.attemptId)throw new Error('Evidence purchase scope denied');
    const activities=Array.isArray(state.activity)?state.activity.filter(e=>e.subjectId===request.purchaseId&&(e.attemptId===undefined||e.attemptId===request.attemptId)):undefined;
    // The transaction observation is the cutoff of this bounded read only,
    // never a claim that history through that time was acquired completely.
    const result={evidenceCutoff:envelope.row.observedAt,evidence:[],coverage:Object.fromEntries(ownedInventoryCategories.map(c=>[c,{state:'incomplete'}])),
     policyBoundaries:['REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED']};
    // Retain raw owned scope; the closed loader detects contradictory records.
    if(activities?.length)result.audit=activities.map(e=>({id:e.id,tenantId:e.tenantId,businessId:e.businessId,purchaseId:e.subjectId,attemptId:e.attemptId,actorId:e.actorId,requestId:e.requestId,action:e.action,createdAt:e.createdAt}));
    const recovery=envelope.recovery?.filter(r=>activities?.some(e=>e.requestId===r.requestId&&e.actorId===r.actorId));
    if(recovery?.length)result.recovery=clone(recovery);
    // No completeness assertion, freshness policy or provider attestation.
    return result;
   }
  };
  try{return await fn(reader);}finally{active=false;envelope=undefined;}
 }});
}

// Dedicated pg pool only. The pool's TLS/host/database pinning belongs to the
// trusted Development composition, never caller-controlled request data.
export function postgresBatchExecutor(pool){
 return async sql=>{
  const client=await pool.connect();let failed=false;
  try{
   const results=await client.query(sql);
   const rows=(Array.isArray(results)?results:[results]).flatMap(r=>r.rows??[]).filter(r=>Object.hasOwn(r,'envelope'));
   if(rows.length!==1)throw new Error('Expected one snapshot envelope');return rows[0].envelope;
  }catch(error){failed=true;await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release(failed);}
 };
}
