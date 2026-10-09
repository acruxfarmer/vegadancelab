import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {proveScaleEngineExactScope} from '../src/runtime/providers/scaleengine-exact-scope-proof.mjs';
import {requireReadyMediaBinding} from '../src/media-provider-binding.mjs';
const dir=new URL('../docs/layer-6/',import.meta.url);
const resourceId='dcb5f610-23a2-43be-af39-706a17be8a92',owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let pool,c,acquired=false,original;
const report={status:'pending',resourceId,stage:'prerequisites',uploads:0,payments:0,bindingMutations:false,databaseReadOnly:true,productionUntouched:true,automaticRetries:0,secretsPersisted:false,events:[]};
const save=()=>fs.writeFile(new URL('l6-s8b-approved-guard-proof.local.json',dir),JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
async function readBinding(){
 await c.query('begin read only');
 try{
  await c.query("select set_config('vega.actor_id',$1,true)",[owner]);
  const rows=(await c.query("select r.document as resource,b.document as binding from media_private.resources r join media_private.provider_bindings b on b.resource_id=r.id where r.id=$1 and b.document->>'state'<>'deleted'",[resourceId])).rows;
  if(rows.length!==1)throw Error();
  requireReadyMediaBinding(rows[0].resource,rows[0].binding);return rows[0];
 }finally{await c.query('rollback');}
}
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)throw Error();}
 const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 const denial=JSON.parse((await fs.readFile(new URL('l6-s5-no-ticket.local.json',dir),'utf8')).replace(/^\uFEFF/,''));
 const inventory=JSON.parse((await fs.readFile(new URL('l6-s5-storage-tree.local.json',dir),'utf8')).replace(/^\uFEFF/,''));
 if(denial.httpStatus!==403||denial.ticketSupplied!==false||!denial.denialConfirmed)throw Error();
 // This file name comes from captured provider inventory, not a fabricated URL.
 const candidates=inventory.structure?.tree?.filter(f=>f.type==='file'&&f.name==='1.mp4'&&f.path==='1.mp4');
 if(candidates?.length!==1)throw Error();
 pool=new pg.Pool({...applicationDatabaseOptions(input.appDatabaseUrl),max:1});pool.on('error',()=>{});
 c=await pool.connect();if((await c.query('select current_user as role')).rows[0]?.role!=='vega_app_runtime')throw Error();
 original=await readBinding();
 if(original.binding.id!=='439dc92e-5036-41b8-b77c-d2f080594a9d'||original.binding.revision!==4||original.binding.playbackRef!==denial.endpoint)throw Error();
 report.bindingId=original.binding.id;report.bindingRevision=original.binding.revision;report.canonicalBaselineHash=hash(original);report.assetANoTicket={httpStatus:403,reusedEvidence:'l6-s5-no-ticket.local.json',samePlaybackMapping:true};
 await fs.writeFile(new URL('l6-s8b-approved-guard-proof-attempted.local.json',dir),JSON.stringify({resourceId,createdAt:new Date().toISOString()}),{flag:'wx'});acquired=true;
 await save();
 report.proof=await proveScaleEngineExactScope({environment:'development',cdnId:input.cdnId,apiSecret:input.apiSecret,...original,otherFile:candidates[0].name,observe:async event=>{report.events.push(event);report.stage=event.stage;await save();}});
 report.status='provider-isolation-proven-pending-adapter-update';
}catch(e){report.status='stopped';report.errorCategory=e.safeCategory||'private-prerequisite-or-invariant-failed';}
finally{
 if(c&&original&&acquired){try{report.canonicalAndBindingUnchanged=hash(await readBinding())===hash(original);if(!report.canonicalAndBindingUnchanged)report.status='stopped';}catch{report.status='stopped';report.baselineVerificationPending=true;}}
 c?.release();await pool?.end().catch(()=>{});
 if(acquired)await save();
 console.log(acquired?'Exact-asset proof finished. Review saved evidence; do not rerun.':'Exact-asset proof stopped before provider requests. No secret details printed.');
}
