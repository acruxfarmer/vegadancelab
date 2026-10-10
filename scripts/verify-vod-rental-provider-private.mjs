import fs from 'node:fs/promises';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {requireReadyMediaBinding} from '../src/media-provider-binding.mjs';
import {probeRentalProvider} from './vod-rental-provider-probe.mjs';
const dir=new URL('../docs/layer-6/',import.meta.url),resourceId='dcb5f610-23a2-43be-af39-706a17be8a92',owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';
const report={status:'preflight',stage:'private-input',productionUntouched:true,databaseReadOnly:true,uploads:0,payments:0,refunds:0,protectedRentalPlaybackEnabled:false,events:[]};
let pool,c,original,attempted=false;const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const save=()=>fs.writeFile(new URL('vod-rental-provider.local.json',dir),JSON.stringify(report,null,2)+'\n');
async function read(){await c.query('begin read only');try{await c.query("select set_config('vega.actor_id',$1,true)",[owner]);const rows=(await c.query("select r.document as resource,b.document as binding from media_private.resources r join media_private.provider_bindings b on b.resource_id=r.id where r.id=$1 and b.document->>'state'<>'deleted'",[resourceId])).rows;if(rows.length!==1)throw Error();requireReadyMediaBinding(rows[0].resource,rows[0].binding);return rows[0];}finally{await c.query('rollback');}}
try{
 let raw='';for await(const x of process.stdin){raw+=x;if(raw.length>32768)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';pool=new pg.Pool({...applicationDatabaseOptions(input.appDatabaseUrl),max:1});input.appDatabaseUrl=null;c=await pool.connect();if((await c.query('select current_user as role')).rows[0].role!=='vega_app_runtime')throw Error();original=await read();
 await fs.writeFile(new URL('vod-rental-provider-attempted.local.json',dir),JSON.stringify({resourceId,at:new Date().toISOString()}),{flag:'wx'});attempted=true;
 report.result=await probeRentalProvider({binding:original.binding,cdnId:input.cdnId,apiSecret:input.apiSecret,observe:async event=>{report.events.push(event);report.stage=event.stage;await save();console.log('VOD provider check: '+event.stage);}});report.status=report.result.status;
}catch(e){report.status='stopped';report.errorCategory=e.code==='EEXIST'?'prior-attempt-requires-reconciliation':e.safeCategory||'private-prerequisite-or-invariant-failed';process.exitCode=1;}
finally{if(c&&original)try{report.resourceAndBindingUnchanged=hash(await read())===hash(original);}catch{report.resourceAndBindingUnchanged=false;}c?.release();await pool?.end();if(attempted)await save();console.log('VOD provider verification '+report.status+'. Review safe report; do not rerun automatically.');}
