// One bounded Development fixture, using existing authoritative commands and
// recovery receipts. Never an application route or a production seed.
import {createApplicationDatabase} from '../src/runtime/refund-application-database.mjs';
import {DEVELOPMENT_INITIAL_OWNERS} from '../src/staff-role-management.mjs';
import {createHash} from 'node:crypto';
if(process.env.VEGA_ENV!=='development'||process.env.VEGA_EXTERNAL_EFFECTS!=='disabled'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Development service required');
const store=createApplicationDatabase(process.env.APP_DATABASE_URL),actor=DEVELOPMENT_INITIAL_OWNERS[0];
const fingerprint=view=>createHash('sha256').update(JSON.stringify({purchases:view.purchaseDrafts,refunds:view.refundHistory,reservations:view.reservations,participants:view.participants})).digest('hex');
try{
 const before=await store.read(actor),baseline=fingerprint(before);
 const definitions=[['Movement foundations — preview','2026-10-10T17:00:00-07:00','Movement',false],['Practice & flow — preview','2026-10-11T18:00:00-07:00','Pack verification',true],['Stretch & restore — preview','2026-10-12T18:00:00-07:00','Movement',false]];
 const ids=[];
 for(let i=0;i<definitions.length;i++){
  const [title,startsAt,category,creditRequired]=definitions[i];
  const r=await store.command(actor,{action:'class',body:{requestId:'layer3-public-class-'+i,title,startsAt,category,creditRequired,instructor:'Studio teaching team — preview',location:'Vega studio — preview',duration:60,capacity:12,waitlistEnabled:true,cancellationCutoffMinutes:90}});ids.push(r.id);
 }
 const view=await store.read(actor),c=view.classes.find(c=>c.id===ids[2]);
 if(c.status!=='cancelled')await store.command(actor,{action:'cancel-class',body:{requestId:'layer3-public-cancelled-class',classId:c.id,reason:'Development public cancellation display fixture',impactToken:view.classCancellationOptions.find(o=>o.classId===c.id).impactToken}});
 const after=await store.read(actor);
 if(fingerprint(after)!==baseline)throw Error('Unrelated business records changed');
 console.log(JSON.stringify({fixture:'layer3-public-discovery',classIds:ids,revision:after.revision,unrelatedBusinessRecordsUnchanged:true}));
}finally{await store.close();}
