// Exercises the deployed runtime role and deferred receipt constraints, then
// rolls back every fixture change. This is not provider/email verification.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {onboardPublicMember} from '../src/runtime/public-onboarding.mjs';
if(process.env.VEGA_ENV!=='development'||process.env.VEGA_EXTERNAL_EFFECTS!=='disabled'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Development service required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
try{
 for(const studio of ['vega','willow']){
  const actor=randomUUID();let checked=false;
  const rollbackPool={connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{
   if(sql==='commit'){
    await c.query('set constraints all immediate');
    const members=await c.query('select role,participant_ids from vega_private.app_members where user_id=$1',[actor]);
    assert.equal(members.rows.length,1);assert.equal(members.rows[0].role,'member');assert.equal(members.rows[0].participant_ids.length,1);
    checked=true;return c.query('rollback');
   }
   const result=await c.query(sql,args);
   if(sql.startsWith('select vega_private.onboard')){
    const r=result.rows[0].result;assert.equal(r.created,true);
    for(const key of ['classes','reservations','purchaseDrafts','refundHistory','entitlements','commerceOffers','waiverVersions','waiverAcceptances'])assert.deepEqual(r._after[key],r._before[key],key+' changed');
    const retry=await c.query(sql,args);assert.equal(retry.rows[0].result.created,false);assert.equal(retry.rows[0].result.participantId,r.participantId);
   }
   return result;
  }};}};
  const result=await onboardPublicMember(rollbackPool,actor,{studio,displayName:'Layer 3 rollback fixture '+actor},process.env.RECEIPT_PUBLIC_KEY,actor+'@example.invalid');
  assert.equal(result.status,'ready');assert.ok(result.independentReceipt.operationId);assert.ok(checked);
  console.log(JSON.stringify({studio,confirmedSelfLinkAndReceiptConstraints:true,idempotentRetry:true,unrelatedRecordsUnchanged:true,rolledBack:true,providerEmailVerification:false}));
 }
}finally{await pool.end();}
