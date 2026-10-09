import fs from 'node:fs/promises';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {createNativeMediaService} from '../src/runtime/native-media-service.mjs';
import {createNativeMediaRepository} from '../src/runtime/native-media-repository.mjs';
import {createMediaPlacementService} from '../src/runtime/media-placement-service.mjs';
import {createMediaPlacementRepository} from '../src/runtime/media-placement-repository.mjs';
import {DEVELOPMENT_INITIAL_OWNERS as initialOwners} from '../src/staff-role-management.mjs';
import {paidFixtureUploadAdapter} from './l6-s8b-upload-adapter.mjs';
const dir=new URL('../docs/layer-6/',import.meta.url),resourceId='3d170055-f7e0-4a94-a7d9-24fcdcfd81a4',bindingId='774b5968-16fb-427b-a3c6-16ffe431fa5d';
const placementId='19a43581-f18c-4ec8-b040-149a54a1664f',actor='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',context={kind:'business',tenantId:'vega-development',businessId:'vega-dance-lab'};
const report={status:'preflight',stage:'input',resourceId,bindingId,placementId,uploads:0,payments:0,productionUntouched:true};
let pool,acquired=false;
const save=()=>fs.writeFile(new URL('l6-s8b-paid-placement.local.json',dir),JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 const evidence=JSON.parse(await fs.readFile(new URL('l6-s8b-paid-file-inspection.local.json',dir),'utf8'));
 if(evidence.httpStatus!==200||evidence.hasProviderError||!Object.values(evidence.identity).every(Boolean)||!Object.values(evidence.metadata).every(Boolean)||evidence.playbackMappingMatches!==true)throw Error();
 const response=await fetch('https://vega-development-web.onrender.com/api/config',{redirect:'error',signal:AbortSignal.timeout(30000)});const config=await response.json();
 if(!response.ok||config.environment!=='development'||config.squareEnabled!==false||config.paymentMode!=='disabled'||config.externalEffects!=='disabled')throw Error();
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));
 if((await pool.query('select current_user as role')).rows[0].role!=='vega_app_runtime')throw Error();
 const authenticate=async id=>{if(id!==actor)throw Error();return {userId:actor};};
 const repository=createNativeMediaRepository(pool,{initialOwners});
 const current=await repository.mutate(actor,resourceId,async(_tx,item)=>item);
 if(current.binding.id!==bindingId||current.binding.state!=='uploading'||current.binding.revision!==2||current.resource.owner.kind!=='business'||current.resource.owner.tenantId!==context.tenantId||current.resource.owner.businessId!==context.businessId)throw Error();
 await fs.writeFile(new URL('l6-s8b-paid-placement-attempted.local.json',dir),JSON.stringify({resourceId,bindingId,placementId}),{flag:'wx'});acquired=true;
 report.stage='same-file-readiness-reconciliation';await save();
 const service=createNativeMediaService({authenticate,repository,adapter:paidFixtureUploadAdapter(input)});
 const ready=await service.refresh(actor,resourceId);report.bindingState=ready.state;report.bindingRevision=ready.revision;await save();
 if(ready.state!=='ready')throw Error();
 report.stage='paid-placement';await save();
 const placements=createMediaPlacementService({authenticate,repository:createMediaPlacementRepository(pool,{initialOwners}),id:()=>placementId});
 const p=await placements.authorize(actor,resourceId,context,{kind:'pay_on_demand'});
 if(p.id!==placementId)throw Error();
 const published=await placements.configure(actor,p.id,p.revision,{visible:true,policy:{kind:'pay_on_demand'},categoryIds:[],collectionIds:[]});
 report.placementRevision=published.revision;report.status='ready-paid-placement-awaiting-offer';await save();
}catch{if(acquired){report.status='stopped-reconcile-before-retry';await save();}}
finally{await pool?.end().catch(()=>{});console.log(JSON.stringify({status:report.status,stage:report.stage,instruction:'Tell Astra done; do not rerun.'}));}
