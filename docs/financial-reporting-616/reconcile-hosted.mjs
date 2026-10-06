// Read-only report verification against the closed business checkpoint.
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions,createApplicationStore} from '../../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../../src/staff-role-management.mjs';
import {digest} from '../../src/payments.mjs';
import {financialReport,financialReportAllowed} from '../../public/financial-report.js';
const owner=DEVELOPMENT_INITIAL_OWNERS[0];
assert.equal(process.env.VEGA_ENV,'development');assert.equal(process.env.VEGA_EXTERNAL_EFFECTS,'disabled');assert.equal(process.env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
try{
 const store=createApplicationStore(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS}),staff=await store.read(owner),report=financialReport(staff,{timeZone:'America/Los_Angeles'});
 assert.equal(report.error,'');assert.equal(financialReportAllowed(await store.read('e5946b40-9839-4a96-99d5-93262d9573f0')),false);
 await assert.rejects(store.read({...owner,businessId:'foreign-business'}),e=>e.status===403);
 const c=await pool.connect();let stateDigest,revision;
 try{await c.query('begin isolation level repeatable read read only');await c.query("select set_config('vega.actor_id',$1,true)",[owner.userId]);
 const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',[owner.tenantId,owner.businessId])).rows[0];revision=Number(row.revision);stateDigest=digest(row.state);
 const ps=(row.state.purchaseDrafts||[]).filter(p=>p.tenantId===owner.tenantId&&p.businessId===owner.businessId&&p.paymentStatus==='succeeded'); const rs=(row.state.refundOperations||[]).filter(r=>r.tenantId===owner.tenantId&&r.businessId===owner.businessId&&r.status==='completed'); for(const currency of new Set([...ps,...rs].map(x=>x.currency))){const s=report.currencies.find(x=>x.currency===currency);assert.equal(s.gross,ps.filter(x=>x.currency===currency).reduce((n,p)=>n+p.totalMinor,0));assert.equal(s.refunded,rs.filter(x=>x.currency===currency).reduce((n,r)=>n+r.amountMinor,0));assert.equal(s.net,s.gross-s.refunded);} assert.equal(revision,155);assert.equal(stateDigest,'e8f54bb7504d8cbfa76a32e5753defdd8995110ba0c7e1fc7c26b5ceba7a5b69');await c.query('commit');}finally{c.release();}
 console.log(JSON.stringify({build:process.env.RENDER_GIT_COMMIT,revision,stateDigest,currencies:report.currencies,purchaseCount:report.purchaseCount,paymentStatuses:report.paymentStatuses,refundStatuses:report.refundStatuses,needsReviewCount:report.needsReviewCount,missingDates:report.missingDates,trendPeriods:report.trends.length,memberManagementReportDenied:true,foreignBusinessDenied:true,unchangedBusinessState:true,paymentExecutionDisabled:true}));
}finally{await pool.end();}
