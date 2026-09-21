import test from 'node:test';
import assert from 'node:assert/strict';
import {workerDatabaseOptions,normalizeSquareObservation,processWorkerBatch,startWorkerPolling} from '../src/runtime/worker.mjs';
const event=()=>({event_id:'event-1',merchant_id:'merchant-1',environment:'sandbox',event_type:'payment.updated',payload:{event_id:'event-1',merchant_id:'merchant-1',type:'payment.updated',created_at:'2026-09-21T12:00:00Z',data:{id:'payment-1',object:{payment:{id:'payment-1',status:'COMPLETED',updated_at:'2026-09-21T11:59:59Z',amount_money:{amount:1500,currency:'USD'}}}}}});
function database(rows,{failReceipt=false,busy=false}={}) {
  let committed=[],pending=[],observations=[],pendingObservations=[],released=0;
  return {get receipts(){return committed;},get observations(){return observations;},get released(){return released;},pool:{connect:async()=>({query:async(sql,args)=>{
    if(sql==='begin'){pending=[...committed];pendingObservations=[...observations];}
    else if(sql.includes('pg_try_advisory'))return {rows:[{acquired:!busy}]};
    else if(sql.startsWith('select i.'))return {rows:rows.filter(r=>!committed.some(x=>x[0]===r.event_id))};
    else if(sql.includes('insert into vega_private.square_financial'))pendingObservations.push(args);
    else if(sql.includes('insert into vega_private.square_processing')){if(failReceipt){failReceipt=false;throw Error('crash');} pending.push(args);}
    else if(sql==='commit'){committed=pending;observations=pendingObservations;}
    return {rows:[]};
  },release:()=>released++})}};
}
test('worker connection is restricted and TLS remains verified despite query flags',()=>{
 const options=workerDatabaseOptions('postgresql://vega_worker_runtime:fake@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres?sslmode=disable');
 assert.equal(options.ssl.rejectUnauthorized,true);
 for(const url of ['postgresql://postgres:fake@db.cjdoczrxcjynjhgpgqop.supabase.co/postgres','postgresql://vega_worker_runtime:fake@evil.example/postgres']) assert.throws(()=>workerDatabaseOptions(url));
});
test('normalization preserves independent provider observation and rejects malformed values',()=>{
 assert.equal(normalizeSquareObservation(event()).observation.amountMinor,1500);
 for(const [field,value,reason] of [['status','PAID','invalid_status'],['updated_at','yesterday','invalid_timestamp'],['updated_at','2026-02-31T10:00:00Z','invalid_timestamp'],['id','../bad','invalid_resource_identity'],['amount_money',{amount:1.5,currency:'USD'},'invalid_money']]){
 const row=event();row.payload.data.object.payment[field]=value;assert.equal(normalizeSquareObservation(row).reason,reason);
 }
 const row=event();row.payload.merchant_id='other';assert.equal(normalizeSquareObservation(row).reason,'invalid_source_identity');
});
test('receipt replay performs no duplicate observation; source remains unchanged',async()=>{
 const row=event(),original=structuredClone(row),db=database([row]);
 assert.equal((await processWorkerBatch(db.pool)).processed,1);
 assert.equal((await processWorkerBatch(db.pool)).processed,0);
 assert.equal(db.observations.length,1);assert.deepEqual(row,original);assert.equal(db.released,2);
});
test('crash between observation and receipt rolls back, retry commits once',async()=>{
 const db=database([event()],{failReceipt:true});
 await assert.rejects(processWorkerBatch(db.pool),/crash/);assert.equal(db.observations.length,0);
 await processWorkerBatch(db.pool);assert.equal(db.observations.length,1);assert.equal(db.receipts.length,1);
});
test('malformed source has durable needs-review receipt and no financial observation',async()=>{
 const row=event();delete row.payload.data;const db=database([row]);
 assert.equal((await processWorkerBatch(db.pool)).needsReview,1);assert.equal(db.receipts[0][1],'needs_review');assert.equal(db.observations.length,0);
});
test('another active transaction prevents concurrent processing',async()=>{
 const db=database([event()],{busy:true});assert.equal((await processWorkerBatch(db.pool)).busy,true);assert.equal(db.receipts.length,0);
});
test('polling waits for prior batch and shutdown drains without starting more work',async()=>{
 let resolve,calls=0,closed=false;
 const stop=startWorkerPolling({process:()=>{calls++;return new Promise(r=>{resolve=r;});},close:async()=>{closed=true;}},{intervalMs:1});
 await new Promise(r=>setTimeout(r,15));assert.equal(calls,1);
 const finishing=stop();resolve({processed:0});await finishing;assert.equal(calls,1);assert.equal(closed,true);
});
