import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {createNativeMediaService} from '../src/runtime/native-media-service.mjs';
import {createNativeMediaRepository} from '../src/runtime/native-media-repository.mjs';
import {DEVELOPMENT_INITIAL_OWNERS as initialOwners} from '../src/staff-role-management.mjs';
import {paidFixtureUploadAdapter} from './l6-s8b-upload-adapter.mjs';
const dir=new URL('../docs/layer-6/',import.meta.url),receipt=new URL('l6-s8b-paid-upload.local.json',dir),marker=new URL('l6-s8b-paid-upload-attempted.local.json',dir);
const actor='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',owner={kind:'business',tenantId:'vega-development',businessId:'vega-dance-lab'};
const report={status:'preflight',stage:'private-input',owner,uploadAttempts:0,payments:0,productionUntouched:true,cleanupPending:false};
let acquired=false,pool,input;
const save=()=>fs.writeFile(receipt,JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
try{
 try{await fs.access(marker);console.log('Prior attempt exists. Reconcile evidence; do not rerun.');process.exit(2);}catch(e){if(e.code!=='ENOENT')throw e;}
 let raw='';for await(const c of process.stdin){raw+=c;if(raw.length>32768)throw Error();}input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 const deployed=JSON.parse((await fs.readFile(new URL('l6-s8b-commerce-hosted-deployment.local.json',dir),'utf8')).replace(/^\uFEFF/,''));
 if(deployed.runtimeCommit!=='6860adbf7e9e7f50940a420ea7e1a14a32adcf3a'||deployed.status!=='live-awaiting-browser-proof')throw Error();
 report.stage='hosted-safety';
 const response=await fetch('https://vega-development-web.onrender.com/api/config',{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error();const config=await response.json();
 if(config.environment!=='development'||config.squareEnabled!==false||config.paymentMode!=='disabled'||config.externalEffects!=='disabled')throw Error();
 const bytes=await fs.readFile(new URL('l6-s5-disposable.mp4',dir));
 if(bytes.length!==3578||createHash('sha256').update(bytes).digest('hex')!=='4c05e98eb5b1caede3865281ed0e591ed72054c4af6669b940ed73c647a4fc45')throw Error();
 const adapter=paidFixtureUploadAdapter(input);pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));input=null;
 report.stage='database-baseline';
 if((await pool.query('select current_user as role')).rows[0].role!=='vega_app_runtime')throw Error();
 async function baseline(){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('vega.actor_id',$1,true)",[actor]);const r=await c.query('select revision,md5(state::text) as digest from vega_private.app_state where tenant_id=$1 and business_id=$2',[owner.tenantId,owner.businessId]);if(r.rows.length!==1)throw Error();return r.rows[0];}finally{await c.query('rollback');c.release();}}
 report.baseline=await baseline();
 await fs.writeFile(marker,JSON.stringify({startedAt:new Date().toISOString(),requestId:'l6-s8b-business-paid-fixture-v1'}),{flag:'wx'});acquired=true;await save();
 const repository=createNativeMediaRepository(pool,{initialOwners});
 const service=createNativeMediaService({repository,adapter,authenticate:async id=>{if(id!==actor)throw Error();return {userId:actor};}});
 report.stage='canonical-business-resource';report.cleanupPending=true;await save();
 const p=await service.prepare(actor,{requestId:'l6-s8b-business-paid-fixture-v1',owner,title:'Disposable $1 media proof',creator:'Vega Development'});
 report.resourceId=p.resourceId;report.bindingState=p.state;await save();
 const item=await repository.mutate(actor,p.resourceId,async(_tx,item)=>item);
 if(JSON.stringify(item.resource.owner)!==JSON.stringify(owner))throw Error();
 report.bindingId=item.binding.id;report.assetRef=adapter.assetRef(item.binding.id);await save();
 if(p.state!=='pending')throw Error();
 report.stage='single-upload';report.uploadAttempts=1;await save();
 report.bindingState=(await service.upload(actor,p.resourceId,bytes)).state;await save();
 report.stage='indexed-file-inspection';
 report.bindingState=(await service.refresh(actor,p.resourceId)).state;
 report.after=await baseline();if(JSON.stringify(report.after)!==JSON.stringify(report.baseline))throw Error();
 report.status=report.bindingState==='ready'?'business-native-ready-awaiting-paid-placement':'awaiting-same-file-readiness-reconciliation';await save();
}catch{if(acquired){report.status='stopped-reconcile-before-retry';await save();}}
finally{input=null;await pool?.end().catch(()=>{});console.log(JSON.stringify({status:report.status,stage:report.stage,bindingState:report.bindingState||null,evidence:'docs/layer-6/l6-s8b-paid-upload.local.json',instruction:'Tell Astra done; do not rerun.'}));}
