import fs from 'node:fs/promises';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
let pool,client;
const library=process.argv.slice(2).length===1&&process.argv[2]==='--external-library';
const report={status:'stopped',stage:'private-input',providerCalls:0,committedFixtureWrites:0,productionUntouched:true};
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)throw Error();}
 const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));client=await pool.connect();
 report.stage='restricted-role-rollback-proof';
 if(process.argv.length>2&&!library)throw Error();
 const results=await client.query(await fs.readFile(new URL(library?'./verify-l6-s11-external-media.sql':'./verify-l6-s10-connections.sql',import.meta.url),'utf8'));
 if(library){
  if(!results.some(r=>r.rows?.[0]?.verification?.startsWith('PASS: hidden,')))throw Error();
  report.status='passed';report.stage='complete';report.baselineRestored=true;report.checks=['hidden','explicit_publication','unsupported_paid_denial','duplicate_constraint','metadata_deleted','resource_preserved','publication_preserved','expired_source_denial','outsider_cache_isolation','browser_denial'];
 }else{
 const result=Array.isArray(results)?results.at(-1):results;
 if(result.rows[0]?.restricted_role_rollback_proof!=='passed'||Number(result.rows[0].remaining_connections)!==0||result.rows[0].audit_read_denied!==true)throw Error();
 report.status='passed';report.stage='complete';report.baselineRestored=true;
 report.checks=['restricted_runtime_role','no_runtime_delete_or_audit_update_delete','no_browser_role_read','owner_insert_update_and_audit','scope_column_mutation_denied','foreign_actor_read_hidden','foreign_actor_update_noop','foreign_actor_insert_denied','forged_audit_actor_denied','rollback_leaves_zero_business_connections','runtime_cannot_read_audit_history'];
 }
}catch(error){await client?.query('rollback').catch(()=>{});report.errorCategory=/^[0-9A-Z]{5}$/.test(error.code||'')?'database_rejection':'verification_unavailable';if(/^[0-9A-Z]{5}$/.test(error.code||''))report.sqlState=error.code;process.exitCode=1;}
finally{client?.release();await pool?.end();await fs.writeFile(new URL(library?'../docs/layer-6/l6-s11-postgres.local.json':'../docs/layer-6/l6-s10-postgres.local.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log((library?'S11':'S10')+' restricted-role verification '+report.status+'. Safe report saved; no credentials printed.');}
