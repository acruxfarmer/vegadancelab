// Read-only report verification against the closed business checkpoint.
import pg from 'pg';
import assert from 'node:assert/strict';
import {applicationDatabaseOptions,createApplicationStore} from '../../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../../src/staff-role-management.mjs';
import {digest} from '../../src/payments.mjs';
import {attendanceReport,reportAllowed} from '../../public/attendance-report.js';
const owner=DEVELOPMENT_INITIAL_OWNERS[0];
assert.equal(process.env.VEGA_ENV,'development');assert.equal(process.env.VEGA_EXTERNAL_EFFECTS,'disabled');assert.equal(process.env.VEGA_SANDBOX_PAYMENT_EXECUTION,'disabled');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
try{
 const store=createApplicationStore(pool,{initialOwners:DEVELOPMENT_INITIAL_OWNERS}),staff=await store.read(owner),report=attendanceReport(staff,{timeZone:'America/Los_Angeles'});
 assert.equal(report.error,'');assert.equal(reportAllowed(await store.read('e5946b40-9839-4a96-99d5-93262d9573f0')),false);
 await assert.rejects(store.read({...owner,businessId:'foreign-business'}),e=>e.status===403);
 const c=await pool.connect();let stateDigest,revision;
 try{await c.query('begin isolation level repeatable read read only');await c.query("select set_config('vega.actor_id',$1,true)",[owner.userId]);
 const row=(await c.query('select state,revision from vega_private.app_state where tenant_id=$1 and business_id=$2',[owner.tenantId,owner.businessId])).rows[0];revision=Number(row.revision);stateDigest=digest(row.state);
 assert.equal(revision,155);assert.equal(stateDigest,'e8f54bb7504d8cbfa76a32e5753defdd8995110ba0c7e1fc7c26b5ceba7a5b69');await c.query('commit');}finally{c.release();}
 console.log(JSON.stringify({build:process.env.RENDER_GIT_COMMIT,revision,stateDigest,summary:report.summary,classes:report.rows.length,instructors:report.instructors.length,days:report.trends.length,memberManagementReportDenied:true,foreignBusinessDenied:true,unchangedBusinessState:true,paymentExecutionDisabled:true}));
}finally{await pool.end();}
