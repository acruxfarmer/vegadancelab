// Only the fixed Render one-off command invokes this entrypoint. Never starts HTTP.
// No secret, SQL, raw record, assertion detail, or driver error is logged.
const watchdog=setTimeout(()=>{console.log('VEGA_COMPOSITION_STOP timeout');process.exit(1);},110000);
let pool;
try {
 const {validateEnvironment,readCheckpoint,fixedLoader,verifyReads}=await import('./refund-composition-job-checks.mjs');
 const commit=validateEnvironment(process.env,process.argv.slice(2));
 const connection=process.env.APP_DATABASE_URL;
 // Jobs inherit the service environment. Discard every secret before loading pg.
 for(const key of Object.keys(process.env))if(!['PATH','HOME','TMPDIR','LANG'].includes(key))delete process.env[key];
 const [{default:pg},{applicationDatabaseOptions}]=await Promise.all([import('pg'),import('../src/runtime/application-database.mjs')]);
 pool=new pg.Pool({...applicationDatabaseOptions(connection),max:1,
  application_name:'vega-development-refund-composition-probe',
  statement_timeout:10000,query_timeout:12000,idle_in_transaction_session_timeout:15000,
  options:'-c default_transaction_read_only=on -c default_transaction_isolation=repeatable\\ read'});
 pool.on('error',()=>{});
 const evidence=await verifyReads({read:()=>readCheckpoint(pool),load:fixedLoader(pool)});
 await pool.end();pool=null;
 console.log('VEGA_COMPOSITION_RECEIPT '+JSON.stringify({...evidence,commit}));
 clearTimeout(watchdog);
} catch {
 console.log('VEGA_COMPOSITION_STOP verification_failed');
 try{await pool?.end();}catch{}
 clearTimeout(watchdog);process.exitCode=1;
}
