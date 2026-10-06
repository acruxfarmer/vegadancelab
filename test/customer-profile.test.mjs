import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {Readable} from 'node:stream';
import {emptyState,transition,visibleState} from '../src/refund-application.mjs';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {customerProfileUI} from '../public/customer-profile-ui.js';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
const member={userId:'e5946b40-9839-4a96-99d5-93262d9573f0',role:'member',tenantId:'business-tenant',businessId:'dance',participantIds:['person']};
const staff={...member,userId:randomUUID(),role:'staff',participantIds:[]};
const at='2026-10-06T18:00:00.000Z',clock={id:randomUUID,now:()=>at};
const seed=()=>({...emptyState(),participants:[{id:'person',name:'Business name'},{id:'other',name:'Other person'}],purchaseDrafts:[],paymentAttempts:[],refundOperations:[]});
const update={participantId:'person',expectedRevision:0,displayName:'My display name',contactEmail:'example@example.com',phone:'+1 503 555 0100'};
const publish={title:'Development test acknowledgment',text:'Test only. No legal rights waived.',effectiveAt:at,expectedVersion:0};
const run=(s,action,body,a=member,options=clock)=>transition(s,{action,body:{requestId:randomUUID(),...body}},a,options);
const accept=(s,a=member)=>{const w=visibleState(s,a,at).customerProfile.currentWaiver;return run(s,'waiver-accept',{participantId:'person',waiverId:w.id,contentDigest:w.contentDigest,accepted:true},a);};
test('member profile persists separately without rewriting participant or business records',()=>{
 const before=seed();const {state}=run(before,'profile-update',update);const view=visibleState(state,member,at).customerProfile;
 assert.equal(view.fields.displayName,update.displayName);assert.equal(view.revision,1);assert.equal(view.businessName,'Business name');
 const stripped=structuredClone(state);delete stripped.customerProfiles;stripped.activity=[];assert.deepEqual(stripped,before);
 assert.deepEqual(state.activity[0].changedFields,['displayName','contactEmail','phone']);assert.equal(state.activity[0].actorId,member.userId);
 assert.equal(visibleState(state,staff,at).profileAdministration.participants[0].profile.fields.phone,update.phone);
});
test('profile rejects protected fields, foreign targets, staff edits and stale revisions',()=>{
 for(const key of ['buyerId','tenantId','businessId','role','credits','paymentStatus','refundStatus','attendance','email','accountId'])assert.throws(()=>run(seed(),'profile-update',{...update,[key]:'bad'}),/Unsupported/);
 assert.throws(()=>run(seed(),'profile-update',{...update,participantId:'other'}),/authority/);
 assert.throws(()=>run(seed(),'profile-update',update,staff),/Member self-service/);
 const {state}=run(seed(),'profile-update',update);assert.throws(()=>run(state,'profile-update',update),/Profile changed/);
 assert.equal(run(state,'profile-update',{...update,expectedRevision:1}).result.outcome,'unchanged');
});
test('ambiguous or conflicting linkage needs staff review and issues no changes',()=>{
 for(const ids of [[],['person','other'],['missing'],['person','person']]){const a={...member,participantIds:ids};assert.equal(visibleState(seed(),a,at).customerProfile.status,'Needs Staff Review');assert.throws(()=>run(seed(),'profile-update',update,a),/Needs Staff Review/);}
 const s=seed();s.customerProfiles=[{...member,accountId:'another-account',participantId:'person',fields:{},revision:1}];assert.equal(visibleState(s,member,at).customerProfile.status,'Needs Staff Review');
 s.customerProfiles=[];s.participants.push({...s.participants[0]});assert.equal(visibleState(s,member,at).customerProfile.status,'Needs Staff Review');
});
test('waiver acceptance binds exact current version, account, participant and effective date',()=>{
 const published=run(seed(),'waiver-publish',publish,staff);const w=published.result;
 assert.equal(visibleState(published.state,member,at).customerProfile.waiverStatus,'Acceptance required');
 const {state,result}=accept(published.state);assert.equal(result.acceptance.accountId,member.userId);assert.equal(result.acceptance.effectiveAt,at);assert.equal(result.acceptance.acceptedAt,at);assert.equal(result.acceptance.contentDigest,w.contentDigest);
 assert.equal(visibleState(state,member,at).customerProfile.waiverStatus,'Accepted');assert.equal(visibleState(state,staff,at).profileAdministration.participants[0].waiverStatus,'Accepted');
 const repeated=accept(state);assert.equal(repeated.state.waiverAcceptances.length,1);assert.equal(repeated.state.activity.length,state.activity.length);
 const v2=run(state,'waiver-publish',{...publish,expectedVersion:1,text:'Second test version'},staff);assert.equal(visibleState(v2.state,member,at).customerProfile.waiverStatus,'Acceptance required');assert.equal(v2.state.waiverAcceptances.length,1);
 assert.throws(()=>run(v2.state,'waiver-accept',{participantId:'person',waiverId:w.id,contentDigest:w.contentDigest,accepted:true}),/Waiver changed/);
 const done=accept(v2.state);assert.equal(done.state.waiverAcceptances.length,2);assert.equal(visibleState(done.state,member,at).customerProfile.acceptedVersions[0].text,publish.text);
});
test('scheduled version does not replace the effective version early; prior versions immutable',()=>{
 const one=run(seed(),'waiver-publish',publish,staff);const two=run(one.state,'waiver-publish',{...publish,expectedVersion:1,effectiveAt:'2026-10-07T18:00:00Z'},staff);
 assert.equal(visibleState(two.state,member,at).customerProfile.currentWaiver.version,1);assert.equal(visibleState(two.state,member,'2026-10-08T18:00:00Z').customerProfile.currentWaiver.version,2);assert.deepEqual(two.state.waiverVersions[0],one.result);
 assert.throws(()=>run(two.state,'waiver-publish',{...publish,expectedVersion:2},staff),/before prior versions/);
});
test('explicit consent, digest, role and publication revision are required',()=>{
 assert.throws(()=>run(seed(),'waiver-publish',publish),/Staff access/);assert.throws(()=>run(seed(),'waiver-publish',{...publish,expectedVersion:1},staff),/versions changed/);
 const {state,result:w}=run(seed(),'waiver-publish',publish,staff);const b={participantId:'person',waiverId:w.id,contentDigest:w.contentDigest,accepted:true};
 assert.throws(()=>run(state,'waiver-accept',{...b,accepted:false}),/Explicit/);assert.throws(()=>run(state,'waiver-accept',{...b,contentDigest:'forged'}),/Waiver changed/);assert.throws(()=>run(state,'waiver-accept',{...b,acceptedAt:'forged'}),/Unsupported/);assert.throws(()=>run(state,'waiver-accept',b,staff),/Member/);
});
test('same participant/account identifiers in another business do not share profiles or waivers',()=>{
 let s=run(seed(),'profile-update',update).state;s=run(s,'waiver-publish',publish,staff).state;s=accept(s).state;
 const foreign={...member,businessId:'another-business'};const v=visibleState(s,foreign,at).customerProfile;assert.equal(v.revision,0);assert.equal(v.currentWaiver,null);assert.equal(v.acceptances.length,0);
 const w=s.waiverVersions[0];assert.throws(()=>run(s,'waiver-accept',{participantId:'person',waiverId:w.id,contentDigest:w.contentDigest,accepted:true},foreign),/Waiver changed/);
 const other=run(s,'profile-update',{...update,displayName:'Other business name'},foreign).state;assert.equal(other.customerProfiles.length,2);assert.equal(visibleState(other,member,at).customerProfile.fields.displayName,update.displayName);
});
test('member view excludes another account profile and acceptance; HTML escapes member and waiver text',()=>{
 let s=run(seed(),'profile-update',{...update,displayName:'<script>bad</script>'}).state;s=run(s,'waiver-publish',{...publish,text:'<img onerror=bad>'},staff).state;
 const d={...visibleState(s,member,at),context:{name:'Test business'}};const e=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const ui=customerProfileUI({getData:()=>d,escape:e});assert.ok(ui.member().includes('&lt;img'));assert.ok(!ui.member().includes('<script>'));
 const other={...member,userId:randomUUID(),participantIds:['other']};assert.equal(visibleState(s,other,at).customerProfile.fields.displayName,'Other person');assert.equal(visibleState(s,other,at).customerProfiles,undefined);
});
test('authenticated HTTP routes use the existing command path and reject member publishing and transaction fields',async()=>{
 let state=seed();const store={command:async(userId,c)=>{const next=transition(state,c,{...member,userId},clock);state=next.state;return next.result;}};
 const api=createApplicationApi({SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'},store,async()=>({ok:true,json:async()=>({id:member.userId})}));
 async function request(path,body){let status,value;const req=Readable.from([Buffer.from(JSON.stringify({...body,requestId:randomUUID()}))]);Object.assign(req,{url:path,method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'}});await api(req,{writeHead:s=>status=s,end:b=>value=JSON.parse(b)});return {status,value};}
 assert.equal((await request('/api/profile',update)).status,200);assert.equal((await request('/api/profile',{...update,expectedRevision:1,credits:50})).status,400);assert.equal((await request('/api/waivers/publish',publish)).status,403);
});
test('existing transactional store serializes concurrent profile edits, replays receipts and rolls back interrupted saves',async()=>{
 let state=seed(),revision=0,commands=new Map(),outbox=new Map(),tail=Promise.resolve(),failWrite=false;
 const pool={async connect(){let unlock,snapshot;return {release(){},async query(sql,args=[]){
  if(sql==='begin'){const previous=tail;tail=new Promise(r=>unlock=r);await previous;snapshot=structuredClone({state,revision,commands,outbox});}
  if(sql==='commit')unlock();
  if(sql==='rollback'){({state,revision,commands,outbox}=snapshot);unlock();}
  if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:member.tenantId,business_id:member.businessId,role:member.role,participant_ids:member.participantIds}]};
  if(sql.startsWith('select state'))return {rows:[{state:structuredClone(state),revision}]};
  if(sql.startsWith('select fingerprint'))return {rows:commands.has(args[3])?[commands.get(args[3])]:[]};
  if(sql.startsWith('select event_id,discovery_state'))return {rows:[{...outbox.get(args[3]),state:'acknowledged'}]};
  if(sql.startsWith('update vega_private.app_state')){state=JSON.parse(args[0]);revision++;if(failWrite){failWrite=false;throw Error('interrupted');}}
  if(sql.startsWith('insert into vega_private.app_commands'))commands.set(args[3],{fingerprint:args[4],response:JSON.parse(args[5])});
  if(sql.startsWith('insert into vega_private.recovery_outbox'))outbox.set(args[4],{event_id:args[0]});
  return {rows:[]};
 }}}};
 const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'}),store=createApplicationStore(pool,{receiptPublicKey});
 const command={action:'profile-update',body:{...update,requestId:'one'}};
 const results=await Promise.all([store.command(member.userId,command),store.command(member.userId,command)]);
 assert.equal(revision,1);assert.equal(state.customerProfiles.length,1);assert.equal(state.activity.length,1);assert.equal(outbox.size,1);assert.equal(results[0].independentReceipt.state,'pending');assert.equal(results[1].independentReceipt.state,'acknowledged');
 await assert.rejects(store.command(member.userId,{...command,body:{...command.body,phone:'changed'}}),/Request identifier/);
 await assert.rejects(store.command(member.userId,{...command,body:{...command.body,requestId:'stale'}}),/Profile changed/);
 failWrite=true;await assert.rejects(store.command(member.userId,{...command,body:{...command.body,requestId:'interrupt',expectedRevision:1,phone:'changed'}}),/interrupted/);assert.equal(revision,1);assert.equal(state.customerProfiles[0].fields.phone,update.phone);
});
