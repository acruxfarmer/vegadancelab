import fs from 'node:fs/promises';
import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {developmentOffer} from '../src/commerce.mjs';
import {mediaAccessTarget,attachMediaOffer,mediaOfferSummary} from '../src/media-commerce.mjs';
import {buildRecoveryReceipt} from '../src/recovery-receipt.mjs';
const diagnostic=process.argv.includes('--diagnostic');
const dir=new URL('../docs/layer-6/',import.meta.url),placementId='19a43581-f18c-4ec8-b040-149a54a1664f';
const a={userId:'4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',tenantId:'vega-development',businessId:'vega-dance-lab',role:'staff'};
const requestId='l6-s8b-paid-offer-fixture-v1',report={status:'preflight',stage:'input',placementId,payments:0,uploads:0,productionUntouched:true};
let pool,c,acquired=false;
const save=()=>fs.writeFile(new URL(diagnostic?'l6-s8b-paid-offer-diagnostic.local.json':'l6-s8b-paid-offer.local.json',dir),JSON.stringify(report,null,2));
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error();}const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 const r=await fetch('https://vega-development-web.onrender.com/api/config',{redirect:'error'}),config=await r.json();
 if(!r.ok||config.environment!=='development'||config.squareEnabled!==false||config.paymentMode!=='disabled'||config.externalEffects!=='disabled')throw Error();
 pool=new pg.Pool(applicationDatabaseOptions(input.appDatabaseUrl));c=await pool.connect();
 await c.query('begin');await c.query("select set_config('vega.receipt_discovery','v1',true)");await c.query("select set_config('vega.actor_id',$1,true)",[a.userId]);
 if((await c.query('select current_user as role')).rows[0].role!=='vega_app_runtime')throw Error();
 const row=(await c.query('select state,revision,md5(state::text) as digest from vega_private.app_state where tenant_id=$1 and business_id=$2 for update',[a.tenantId,a.businessId])).rows[0];
 if(String(row?.revision)!=='189'||row.digest!=='ec6a3cbc4a395bc350244c228ec85cac')throw Error();
 const placement=(await c.query('select document from media_private.placements where id=$1',[placementId])).rows[0]?.document;
 const resource=(await c.query('select document from media_private.resources where id=$1',[placement?.resourceId])).rows[0]?.document;
 if(resource?.id!=='3d170055-f7e0-4a94-a7d9-24fcdcfd81a4'||placement.revision!==2)throw Error();
 const state=structuredClone(row.state),offer={...developmentOffer(),id:'l6-s8b-paid-media-usd1-v1',productId:'l6-s8b-paid-media-product-v1',productName:'Development disposable media access',productType:'digital_access',quantity:1,validDays:null,categories:[],classIds:[],priceMinor:100,fulfillmentPlan:{version:1,actions:[{id:'placement-access',type:'DURABLE_ACCESS',target:mediaAccessTarget(placement)}]}};
 const product={id:offer.productId,name:offer.productName,type:offer.productType,quantity:1,validDays:null,categories:[],classIds:[]};
 (state.commerceProducts??=[]).push(product);(state.commerceOffers??=[]).push(offer);(state.commerceOfferAvailability??=[]).push({offerId:offer.id,offerVersion:1,tenantId:a.tenantId,businessId:a.businessId,active:true});
 const command={action:'development-paid-media-fixture',body:{requestId,placementId,offerId:offer.id,expectedRevision:2}};
 attachMediaOffer(state,command.body,a,{placement,resource},{id:randomUUID,now:()=>new Date().toISOString()},()=>{throw Error();});
 const result=mediaOfferSummary(state,placement);if(result?.priceMinor!==100||result.currency!=='USD')throw Error();
 const receipt=buildRecoveryReceipt({before:row.state,after:state,revision:row.revision,authority:a,command,result,occurredAt:new Date().toISOString(),publicKey:input.receiptPublicKey});
 await fs.writeFile(new URL(diagnostic?'l6-s8b-paid-offer-discovery-diagnostic-attempted.local.json':'l6-s8b-paid-offer-discovery-attempted.local.json',dir),JSON.stringify({requestId,placementId}),{flag:'wx'});acquired=true;report.stage='atomic-fixture-and-recovery-receipt';await save();
 report.stage='state-update';await save();
 await c.query('update vega_private.app_state set state=$1,revision=revision+1,updated_at=now() where tenant_id=$2 and business_id=$3',[JSON.stringify(state),a.tenantId,a.businessId]);
 report.stage='command-journal';await save();
 await c.query('insert into vega_private.app_commands(tenant_id,business_id,actor_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5,$6)',[a.tenantId,a.businessId,a.userId,requestId,createHash('sha256').update(JSON.stringify(command)).digest('hex'),JSON.stringify(result)]);
 report.stage='recovery-outbox';await save();
 await c.query('insert into vega_private.recovery_outbox(event_id,tenant_id,business_id,actor_id,request_id,previous_revision,revision,payload,payload_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[receipt.eventId,a.tenantId,a.businessId,a.userId,requestId,receipt.previousRevision,receipt.revision,receipt.payload,receipt.payloadDigest]);
 report.stage='deferred-integrity-check';await save();await c.query('set constraints all immediate');
 await c.query(diagnostic?'rollback':'commit');report.status=diagnostic?'diagnostic-passed-rolled-back':'offer-created-awaiting-hosted-lock-proof';report.offer=result;report.recoveryEventId=receipt.eventId;report.revision=190;await save();
}catch(error){report.sqlState=/^[0-9A-Z]{5}$/.test(error.code||'')?error.code:null;report.rolledBack=true;await c?.query('rollback').catch(()=>{});if(acquired){report.status='stopped-reconcile-before-retry';await save();}}
finally{c?.release();await pool?.end().catch(()=>{});console.log(JSON.stringify({status:report.status,stage:report.stage,instruction:'Tell Astra done; do not rerun.'}));}


