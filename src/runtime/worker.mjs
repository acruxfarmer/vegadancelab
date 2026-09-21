import pg from 'pg';
import { databaseTls } from './database-tls.mjs';
const ref = 'cjdoczrxcjynjhgpgqop';
export function workerDatabaseOptions(value) {
  const u = new URL(value), direct = u.hostname === `db.${ref}.supabase.co`;
  const role = direct ? 'vega_worker_runtime' : `vega_worker_runtime.${ref}`;
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !(direct || /^aws-\d+-us-west-1\.pooler\.supabase\.com$/.test(u.hostname)) || u.pathname !== '/postgres' || !['5432','6543',''].includes(u.port) || decodeURIComponent(u.username) !== role || !u.password) throw new Error('Invalid worker database configuration');
  return { host:u.hostname, port:Number(u.port || 5432), database:'postgres', user:role, password:decodeURIComponent(u.password), ssl:databaseTls(u.hostname), max:1, connectionTimeoutMillis:10000, statement_timeout:10000, query_timeout:12000, application_name:'vega-development-worker' };
}
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const time = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  // Date.parse normalizes impossible calendar dates; reject those source values.
  const [year,month,day]=v.slice(0,10).split('-').map(Number);
  const calendar=new Date(`${v.slice(0,10)}T00:00:00Z`);
  return calendar.getUTCFullYear()===year && calendar.getUTCMonth()+1===month && calendar.getUTCDate()===day && Number(v.slice(11,13))<24;
};
export function normalizeSquareObservation(r) {
  const p = r.payload;
  if (r.environment !== 'sandbox' || !id(r.event_id) || !id(r.merchant_id) || p?.event_id !== r.event_id || p?.merchant_id !== r.merchant_id || p?.type !== r.event_type) return {reason:'invalid_source_identity'};
  if (!['payment.created','payment.updated','refund.created','refund.updated'].includes(r.event_type)) return {reason:'unsupported_event'};
  const kind = r.event_type.split('.')[0], o = p.data?.object?.[kind];
  if (!o || !id(o.id) || (o.location_id != null && !id(o.location_id)) || (p.data.id != null && p.data.id !== o.id)) return {reason:'invalid_resource_identity'};
  if (kind === 'refund' && !id(o.payment_id)) return {reason:'invalid_payment_reference'};
  if (!(kind === 'payment' ? ['APPROVED','PENDING','COMPLETED','CANCELED','FAILED'] : ['PENDING','COMPLETED','REJECTED','FAILED']).includes(o.status)) return {reason:'invalid_status'};
  if (!time(p.created_at) || !time(o.updated_at ?? o.created_at)) return {reason:'invalid_timestamp'};
  if (!Number.isSafeInteger(o.amount_money?.amount) || o.amount_money.amount < 0 || !/^[A-Z]{3}$/.test(o.amount_money?.currency ?? '')) return {reason:'invalid_money'};
  return {observation:{kind,resourceId:o.id,merchantId:r.merchant_id,locationId:o.location_id ?? null,paymentId:kind === 'refund' ? o.payment_id : o.id,status:o.status,amountMinor:o.amount_money.amount,currency:o.amount_money.currency,sourceUpdatedAt:o.updated_at ?? o.created_at,eventCreatedAt:p.created_at}};
}
export async function processWorkerBatch(pool, {limit = 25} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid worker batch size');
  const c = await pool.connect();
  try {
    await c.query('begin');
    const lock = await c.query('select pg_try_advisory_xact_lock(8675309, 210921) as acquired');
    if (!lock.rows[0]?.acquired) { await c.query('commit'); return {processed:0,needsReview:0,busy:true}; }
    const {rows} = await c.query(`select i.* from vega_private.square_webhook_inbox i where not exists (select 1 from vega_private.square_processing_journal j where j.event_id=i.event_id) order by i.received_at,i.event_id limit $1`, [limit]);
    const result = {processed:0,needsReview:0,busy:false};
    for (const row of rows) {
      const {observation:o,reason} = normalizeSquareObservation(row);
      if (o) await c.query(`insert into vega_private.square_financial_observations (event_id,environment,merchant_id,resource_kind,resource_id,observation) values ($1,'sandbox',$2,$3,$4,$5::jsonb)`, [row.event_id,row.merchant_id,o.kind,o.resourceId,JSON.stringify(o)]);
      await c.query(`insert into vega_private.square_processing_journal (event_id,status,reason) values ($1,$2,$3)`, [row.event_id,o ? 'processed' : 'needs_review',reason ?? null]);
      result[o ? 'processed' : 'needsReview']++;
    }
    await c.query('commit');
    return result;
  } catch (error) { try {await c.query('rollback');} catch {} throw error; }
  finally {c.release();}
}
export function createWorkerDatabase(value) {
  const pool = new pg.Pool(workerDatabaseOptions(value));
  pool.on('error',()=>{});
  return {process:options=>processWorkerBatch(pool,options),close:()=>pool.end()};
}
// Scheduling after completion prevents overlapping batches, including during database delays.
export function startWorkerPolling(worker,{intervalMs=5000,onResult=()=>{},onError=()=>{}}={}) {
  let stopped=false,timer,running;
  const tick=async()=>{try {onResult(await worker.process());} catch {onError('Worker batch failed; retry scheduled');} if(!stopped) timer=setTimeout(()=>{running=tick();},intervalMs);};
  running=tick();
  return async()=>{stopped=true;clearTimeout(timer);await running;await worker.close();};
}
