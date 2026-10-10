import fs from 'node:fs/promises';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {rentalVerification as p} from '../src/runtime/rental-verification-control.mjs';
const report={status:'preflight',observedAt:new Date().toISOString(),mutations:0,providerRequests:0,secretsPersisted:false};let pool,c;
try{
 let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>65536)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));input.appDatabaseUrl=null;
 c=await pool.connect();await c.query('begin read only');await c.query("select set_config('vega.actor_id',$1,true)",[p.actorId]);
 const row=(await c.query('select state,revision,now() as observed_at from vega_private.app_state where tenant_id=$1 and business_id=$2',[p.tenantId,p.businessId])).rows[0];if(!row)throw Error();
 const e=row.state.accessEntitlements?.find(e=>e.id===p.entitlementId);if(!e||e.principalId!==p.actorId||e.target.id!==p.placementId)throw Error();
 const sessions=(row.state.rentalPlaybackSessions||[]).filter(s=>s.entitlementId===e.id);
 report.serverTime=row.observed_at;report.businessRevision=row.revision;
 report.entitlement={id:e.id,state:e.state,revision:e.revision,provenanceKind:e.provenance?.kind,rental:{policy:e.rental.policy,availableAt:e.rental.availableAt,startBy:e.rental.startBy,expiresAt:e.rental.expiresAt,recoveryUsedMs:e.rental.recoveryUsedMs,activation:e.rental.activation?{id:e.rental.activation.id,sessionId:e.rental.activation.sessionId,attemptId:e.rental.activation.attemptId,confirmedAt:e.rental.activation.confirmedAt,state:e.rental.activation.state,evidenceKind:e.rental.activation.evidence?.kind,evidenceReference:e.rental.activation.evidence?.reference}:null},correctionCount:e.corrections?.length||0};
 report.sessions=sessions.map(s=>({id:s.id,state:s.state,createdAt:s.createdAt,startedAt:s.startedAt,endedAt:s.endedAt,attemptId:s.attemptId,verificationReference:s.verificationReference,ticketIssuance:s.ticketIssuance,recovery:s.recovery}));
 report.tickets=(row.state.rentalPlaybackTickets||[]).filter(t=>t.entitlementId===e.id).map(t=>({provider:t.provider,sessionId:t.sessionId,attemptId:t.attemptId,state:t.state,issuedAt:t.issuedAt,expiresAt:t.expiresAt,revokedAt:t.revokedAt}));
 await c.query('rollback');report.status='read-only-rental-evidence-saved';
}catch{await c?.query('rollback').catch(()=>{});report.status='stopped';process.exitCode=1;}finally{c?.release();await pool?.end();const dir=new URL('../docs/layer-6/',import.meta.url);await fs.writeFile(new URL('vod-rental-hosted-state-'+Date.now()+'.local.json',dir),JSON.stringify(report,null,2)+'\n');await fs.writeFile(new URL('vod-rental-hosted-state.local.json',dir),JSON.stringify(report,null,2)+'\n');console.log(report.status);}
