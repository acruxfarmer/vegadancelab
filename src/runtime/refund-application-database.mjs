import {resolveStaffAccess,hasStaffPermission,requireStaffPermission,requireStaffCommand,visibleStaffData,staffCommandResult} from '../staff-permissions.mjs';
import {DEVELOPMENT_INITIAL_OWNERS,staffManagementView,staffManagementTransition} from '../staff-role-management.mjs';
import pg from 'pg';
import {readPublicDiscovery} from './public-discovery-store.mjs';
import {onboardPublicMember} from './public-onboarding.mjs';
import { createHash } from 'node:crypto';
import { databaseTls } from './database-tls.mjs';
import { ApplicationError,transition,visibleState } from '../refund-application.mjs';
import {purchaseForPayment,canonical,digest} from '../payments.mjs';
import {resolveStoredIntegration} from './payment-integrations.mjs';
import {reviewClassEdit} from '../class-editing.mjs';
import {reviewClassDuplicate} from '../class-duplication.mjs';
import {buildRecoveryReceipt,buildRevocationReceipt,receiptKey} from '../recovery-receipt.mjs';
import {assessRefundEligibility} from '../refund-eligibility.mjs';
import {boundedRefundReadiness} from '../bounded-refund-readiness.mjs';
import {refundProgramFacts} from '../refund-program.mjs';

export function applicationDatabaseOptions(value){
 const u=new URL(value),ref='cjdoczrxcjynjhgpgqop';
 const direct=u.hostname===`db.${ref}.supabase.co`,pooler=/^aws-\d+-us-west-1\.pooler\.supabase\.com$/.test(u.hostname);
 if(!['postgres:','postgresql:'].includes(u.protocol)||(!direct&&!pooler)||u.pathname!=='/postgres'||!['','5432','6543'].includes(u.port)||decodeURIComponent(u.username)!==(direct?'vega_app_runtime':`vega_app_runtime.${ref}`)||!u.password)throw new Error('Invalid application database configuration');
 return {host:u.hostname,port:Number(u.port||5432),database:'postgres',user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:databaseTls(u.hostname),connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'vega-development-application'};
}
export function createApplicationStore(pool,{initialOwners=[],receiptPublicKey=process.env.RECEIPT_PUBLIC_KEY,resolveIntegration=resolveStoredIntegration,refundInventory=()=>undefined,assessmentNow=()=>new Date().toISOString(),refundNow=()=>new Date().toISOString()}={}){
 const paymentCapability=Symbol('server payment command');
 const refundCapability=Symbol('server refund command');
 const fail=(message,status=403)=>{throw new ApplicationError(message,status);};
 const access=(s,a)=>resolveStaffAccess(s,a,{initialOwners});
 const requirePermission=(s,a,p)=>{if(a.role==='staff')requireStaffPermission(access(s,a),a,p,fail);};
 const requirePayment=(s,a,purchaseId)=>{
  requirePermission(s,a,'sales.manage');
  if(a.role==='staff'&&!hasStaffPermission(access(s,a),a,'finance.read')){
   const p=s.purchaseDrafts?.find(p=>p.id===purchaseId&&p.tenantId===a.tenantId&&p.businessId===a.businessId);
   if(!p||p.saleChannel!=='front_desk'||p.createdByStaffId!==a.userId)fail('You can only complete your own front-desk sales.',403);
  }
 };
 async function transaction(identity,fn,readOnly=false){
  const userId=typeof identity==='string'?identity:identity?.userId;
  const requested=typeof identity==='object'?identity:null;
  const client=await pool.connect();
  try{
   await client.query(readOnly?'begin isolation level repeatable read read only':'begin');
   await client.query("select set_config('vega.actor_id',$1,true),set_config('vega.receipt_discovery','v1',true)",[userId]);
   const {rows}=await client.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[userId]);
   const matches=requested?rows.filter(m=>m.tenant_id===requested.tenantId&&m.business_id===requested.businessId):rows;
   if(matches.length!==1)throw new ApplicationError('No unambiguous business access assignment. Select an authorized business.',403);
   const m=matches[0], authority={userId,tenantId:m.tenant_id,businessId:m.business_id,role:m.role,participantIds:m.participant_ids};
   const result=await fn(client,authority);await client.query('commit');return result;
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
 }
 async function stateRow(client,a,lock=false){
  const {rows}=await client.query(`select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2${lock?' for update':''}`,[a.tenantId,a.businessId]);
  if(rows.length!==1)throw new ApplicationError('Studio application data is not initialized',503);return rows[0];
 }
 const store={
  publicDiscovery:slug=>readPublicDiscovery(pool,slug),
  onboard:(userId,body,verifiedEmail)=>onboardPublicMember(pool,userId,body,receiptPublicKey,verifiedEmail),
  memberships:async identity=>{
   const userId=typeof identity==='string'?identity:identity.userId,c=await pool.connect();
   try{await c.query('begin isolation level repeatable read read only');await c.query("select set_config('vega.actor_id',$1,true)",[userId]);
    const {rows}=await c.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[userId]);
    await c.query('commit');return rows.map(m=>({tenantId:m.tenant_id,businessId:m.business_id,name:m.business_id==='vega-dance-lab'?'Vega Dance Lab':m.business_id}));
   }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
  },
  refundContext:(userId,purchaseId,operationId,permission='refunds.manage')=>transaction(userId,async(c,a)=>{
   if(a.role!=='staff')throw new ApplicationError('Staff access required',403);
   const row=await stateRow(c,a),state=row.state;
   requirePermission(state,a,permission);
   const p=state.purchaseDrafts?.find(p=>p.id===purchaseId&&p.tenantId===a.tenantId&&p.businessId===a.businessId);
   if(!p)throw new ApplicationError('Purchase unavailable',404);
   const attempt=state.paymentAttempts?.find(x=>x.id===p.activeAttemptId&&x.purchaseId===p.id);
   if(!attempt)throw new ApplicationError('Payment evidence unavailable',409);
   const registered=await resolveIntegration(c,a,attempt);
   if(digest(registered)!==digest(attempt.integrationRef))throw new ApplicationError('Refund integration changed',409);
   const businessReadiness=boundedRefundReadiness({state,authority:a,purchaseId:p.id,at:refundNow()});
   const operation=state.refundOperations?.find(o=>o.purchaseId===p.id&&o.tenantId===a.tenantId&&o.businessId===a.businessId&&(!operationId||o.id===operationId));
   const programFacts=refundProgramFacts(state,a,p.id,refundNow(),operation?.origin==='external'?{holdingOperationId:operation.id,dispositionOnly:true}:{});
   const operations=(state.refundOperations??[]).filter(o=>o.purchaseId===p.id&&o.tenantId===a.tenantId&&o.businessId===a.businessId);
   return {stateDigest:digest(state),revision:row.revision,businessReadiness,programFacts,operations:structuredClone(operations),operation:operation?structuredClone(operation):null,purchase:{purchaseId:p.id,tenantId:a.tenantId,businessId:a.businessId,paymentId:attempt.paymentId,attemptId:attempt.id,integrationRef:attempt.integrationRef,amountMinor:p.totalMinor,currency:p.currency,quantity:p.terms.quantity}};
  },true),
  refundCommand:(userId,command,evidence)=>store.command(userId,command,refundCapability,evidence),
  assessRefund:(userId,purchaseId)=>transaction(userId,async(c,a)=>{
   const assessedAt=assessmentNow();
   const denied=()=>({contractVersion:2,purchaseId,status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],assessedAt,revision:null,staffApprovalRequired:true,executionAuthorized:false});
   // Deny non-staff before loading any business or purchase data.
   if(a.role!=='staff')return denied();
   const row=await stateRow(c,a);
   if(!hasStaffPermission(access(row.state,a),a,'finance.read'))return denied();
   const purchase=row.state.purchaseDrafts?.find(d=>d.id===purchaseId&&d.tenantId===a.tenantId&&d.businessId===a.businessId);
   // Missing and out-of-scope purchases have identical responses.
   if(!purchase)return denied();
   // Only a server-configured inventory source may assert completeness. No
   // source is installed by default: today's missing refund ledger stays blocked.
   const inventory=await refundInventory({state:structuredClone(row.state),authority:{...a},revision:row.revision,purchaseId});
   const complete=inventory?.complete===true&&inventory.tenantId===a.tenantId&&inventory.businessId===a.businessId&&inventory.purchaseId===purchaseId&&String(inventory.revision)===String(row.revision)&&Array.isArray(inventory.records)&&inventory.records.every(r=>r&&typeof r==='object'&&r.purchaseId===purchaseId);
   return {purchaseId,...assessRefundEligibility({state:row.state,authority:a,purchaseId,at:assessedAt,refundRecords:complete?inventory.records:undefined}),assessedAt,revision:row.revision};
  },true),
  paymentContext:(userId,purchaseId)=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);
   requirePayment(row.state,a,purchaseId);
   const draft=purchaseForPayment(row.state,a,purchaseId,(m,s)=>{throw new ApplicationError(m,s);});
   const attempt=(row.state.paymentAttempts||[]).find(p=>p.purchaseId===draft.id&&!['failed','cancelled'].includes(p.status));
   return {draft,integrationRef:await resolveIntegration(c,a,attempt)};
  }),
  paymentRead:(userId,purchaseId,attemptId)=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);
   requirePayment(row.state,a,purchaseId);
   const draft=purchaseForPayment(row.state,a,purchaseId,(m,s)=>{throw new ApplicationError(m,s);});
   const attempt=(row.state.paymentAttempts||[]).find(p=>p.id===attemptId&&p.purchaseId===draft.id);
   if(!attempt)throw new ApplicationError('Payment attempt unavailable',404);
   const integrationRef=await resolveIntegration(c,a,attempt);
   return {draft,attempt,integrationRef};
  }),
  paymentCommand:(userId,command)=>store.command(userId,command,paymentCapability),
  recordRevocation:({userId,sessionId,outcome})=>transaction(userId,async(c,a)=>{
   const receipt=buildRevocationReceipt({authority:a,sessionId,outcome,occurredAt:new Date().toISOString(),publicKey:receiptPublicKey});
   // Duplicate sign-out must retain the original encrypted payload, not reseal it.
   await c.query("insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,event_kind,payload,payload_digest) values($1,$2,$3,$4,'security',$5,$6) on conflict(event_id) do nothing",[receipt.eventId,a.tenantId,a.businessId,a.userId,receipt.payload,receipt.payloadDigest]);
   return {state:'pending',operationId:receipt.eventId};
  }),
  operation:(userId,eventId)=>transaction(userId,async(c,a)=>{
   const {rows}=await c.query('select o.event_id,o.discovery_state as state,j.response from vega_private.recovery_outbox o join vega_private.app_commands j using(tenant_id,business_id,actor_id,request_id) where o.event_id=$1 and o.tenant_id=$2 and o.business_id=$3 and o.actor_id=$4',[eventId,a.tenantId,a.businessId,a.userId]);
   if(rows.length!==1)throw new ApplicationError('Operation unavailable',404);
   return rows[0].state==='acknowledged'?{confirmed:true,independentReceipt:{operationId:eventId,state:'acknowledged'}}:{pending:true,independentReceipt:{operationId:eventId,state:rows[0].state}};
  }),
  check:async()=>{receiptKey(receiptPublicKey);const {rows}=await pool.query(`select current_user as role,
   not r.rolsuper and not r.rolbypassrls as restricted,
   has_table_privilege(current_user,'vega_private.app_state','SELECT') and has_table_privilege(current_user,'vega_private.app_state','UPDATE')
   and has_table_privilege(current_user,'vega_private.app_members','SELECT')
   and has_table_privilege(current_user,'vega_private.app_commands','SELECT') and has_table_privilege(current_user,'vega_private.app_commands','INSERT')
   and has_table_privilege(current_user,'vega_private.recovery_outbox','SELECT') and has_column_privilege(current_user,'vega_private.recovery_outbox','payload','INSERT') and has_column_privilege(current_user,'vega_private.recovery_outbox','discovery_sequence','SELECT') as state_access,
   has_table_privilege(current_user,'vega_private.app_members','INSERT,UPDATE,DELETE') as can_assign,
   (select count(*)=4 and bool_and(c.relrowsecurity and c.relforcerowsecurity and c.relowner<>r.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='vega_private' and c.relname in ('app_state','app_members','app_commands','recovery_outbox')) as isolated
   from pg_roles r where r.rolname=current_user`);if(rows[0]?.role!=='vega_app_runtime'||!rows[0].restricted||!rows[0].isolated||!rows[0].state_access||rows[0].can_assign)throw new Error('Application identity not ready');return true;},
  read:userId=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);let jobs=[];
   if(a.role==='staff'&&hasStaffPermission(access(row.state,a),a,'finance.read')){
    // Unscoped provider processing records are not business-owned staff history.
    jobs=[];
   }
   const outstanding=await c.query("select count(*)::int as count from vega_private.recovery_outbox where tenant_id=$1 and business_id=$2 and event_kind='business' and discovery_state<>'acknowledged'",[a.tenantId,a.businessId]);
   const raw={mode:'development',context:{name:a.businessId==='vega-dance-lab'?'Vega Dance Lab':a.businessId,...a},revision:row.revision,...visibleState(row.state,a),jobs,squareEnabled:false,recovery:{pendingCount:outstanding.rows[0]?.count??0}};
   return a.role==='staff'?{...visibleStaffData(raw,a,access(row.state,a)),...staffManagementView(row.state,a,initialOwners)}:raw;
  }),
  reviewClassDuplicate:(userId,body)=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);
   requirePermission(row.state,a,'schedule.edit');
   return reviewClassDuplicate(row.state,body,a,new Date().toISOString(),(message,status)=>{throw new ApplicationError(message,status);});
  }),
  reviewClassEdit:(userId,body)=>transaction(userId,async(c,a)=>{
   const row=await stateRow(c,a);
   requirePermission(row.state,a,'schedule.edit');
   return reviewClassEdit(row.state,body,a,new Date().toISOString(),(message,status)=>{throw new ApplicationError(message,status);});
  }),
  command:(userId,command,capability,refundEvidence)=>transaction(userId,async(c,a)=>{
   const trustedPayment=capability===paymentCapability;
   const trustedRefund=capability===refundCapability;
   if(command.action.startsWith('refund-')&&(!trustedRefund||a.role!=='staff'))throw new ApplicationError('Internal staff refund operation only',403);
   if(command.action.startsWith('payment-')){
    if(!trustedPayment)throw new ApplicationError('Internal payment operation only',403);
   }
   const row=await stateRow(c,a,true),requestId=command.body?.requestId;
   // A command may wait behind another transaction. Recheck authority after the wait.
   const assigned=await c.query('select tenant_id,business_id,role,participant_ids from vega_private.app_members where user_id=$1',[a.userId]);
   const current=assigned.rows.filter(m=>m.tenant_id===a.tenantId&&m.business_id===a.businessId);
   const latest=current[0];
   if(current.length!==1||latest.tenant_id!==a.tenantId||latest.business_id!==a.businessId||latest.role!==a.role||JSON.stringify(latest.participant_ids)!==JSON.stringify(a.participantIds))throw new ApplicationError('Access changed. Reload your account before continuing.',403);
   if(command.action==='staff-register'&&a.role!=='staff')fail('Staff membership required',403);
   if(command.action!=='staff-register')requireStaffCommand(row.state,command,a,access(row.state,a),fail);
   if(command.action.startsWith('payment-'))requirePayment(row.state,a,command.body?.purchaseId);
   if(typeof requestId!=='string'||!requestId.trim()||requestId.length>128)throw new ApplicationError('A request identifier is required');
   const fingerprint=createHash('sha256').update(trustedPayment?canonical(command):JSON.stringify(command)).digest('hex');
   const {rows}=await c.query('select fingerprint,response from vega_private.app_commands where tenant_id=$1 and business_id=$2 and actor_id=$3 and request_id=$4',[a.tenantId,a.businessId,a.userId,requestId]);
   if(rows.length){
    if(rows[0].fingerprint!==fingerprint)throw new ApplicationError('Request identifier already used for another operation',409);
    const delivered=await c.query('select event_id,discovery_state as state from vega_private.recovery_outbox where tenant_id=$1 and business_id=$2 and actor_id=$3 and request_id=$4',[a.tenantId,a.businessId,a.userId,requestId]);
    if(!delivered.rows.length)throw new ApplicationError('This historical operation predates independent receipt capture. Review its existing record; do not repeat it with a new identifier.',409);
    return {...staffCommandResult(rows[0].response,a,access(row.state,a)),independentReceipt:{operationId:delivered.rows[0].event_id,state:delivered.rows[0].state}};
   }
   if(!receiptPublicKey)throw new ApplicationError('Independent recovery capture is unavailable. No change was committed.',503);
   const paymentAttempt=trustedPayment?(row.state.paymentAttempts||[]).find(p=>p.purchaseId===command.body.purchaseId&&(command.body.attemptId?p.id===command.body.attemptId:!['failed','cancelled'].includes(p.status))):null;
   if(trustedRefund){
    const p=row.state.purchaseDrafts?.find(p=>p.id===command.body.purchaseId&&p.tenantId===a.tenantId&&p.businessId===a.businessId);
    const attempt=row.state.paymentAttempts?.find(x=>x.purchaseId===p?.id&&x.id===p.activeAttemptId);
    if(!attempt)throw new ApplicationError('Purchase unavailable',404);
    if(digest(await resolveIntegration(c,a,attempt))!==digest(attempt.integrationRef))throw new ApplicationError('Refund integration changed',409);
   }
   const integrationRef=trustedPayment?await resolveIntegration(c,a,paymentAttempt):undefined;
   const legacyIntegrationRefs={};
   if(trustedPayment)for(const old of row.state.paymentAttempts||[]){if(!old.integrationRef)legacyIntegrationRefs[old.id]=await resolveIntegration(c,a,old);}
   const next=['staff-register','staff-role-set'].includes(command.action)?staffManagementTransition(row.state,command,a,{initialOwners},fail):transition(row.state,command,a,{trustedPayment,trustedRefund,refundEvidence,integrationRef,legacyIntegrationRefs,...(trustedRefund?{now:refundNow}:{})});
   if(trustedRefund&&canonical(next.state)===canonical(row.state))return next.result;
   if(['refund-intent','refund-program-intent'].includes(command.action)){
    const op=next.state.refundOperations.find(o=>o.id===next.result.refund.id);
    op.intentReceiptId=createHash('sha256').update(canonical(['vega-independent-receipt-v1',{tenantId:a.tenantId,businessId:a.businessId,actorId:a.userId,requestId:command.body.requestId}])).digest('hex');
    next.result.refund=structuredClone(op);
   }
   const receipt=buildRecoveryReceipt({before:row.state,after:next.state,revision:row.revision,authority:a,command,result:next.result,occurredAt:new Date().toISOString(),publicKey:receiptPublicKey});
   await c.query('update vega_private.app_state set state=$1,revision=revision+1,updated_at=now() where tenant_id=$2 and business_id=$3',[JSON.stringify(next.state),a.tenantId,a.businessId]);
   await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[a.tenantId,a.businessId,a.userId,requestId,fingerprint,JSON.stringify(next.result)]);
   await c.query('insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[receipt.eventId,a.tenantId,a.businessId,a.userId,requestId,receipt.previousRevision,receipt.revision,receipt.payload,receipt.payloadDigest]);
   return {...staffCommandResult(next.result,a,access(next.state,a)),independentReceipt:{operationId:receipt.eventId,state:'pending'}};
  }),
  close:()=>pool.end()
 };
 return store;
}
export function createApplicationDatabase(value){const pool=new pg.Pool({...applicationDatabaseOptions(value),max:5});pool.on('error',()=>{});return createApplicationStore(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS});}
