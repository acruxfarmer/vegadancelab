import test from 'node:test';
import assert from 'node:assert/strict';
import {transition,visibleState} from '../src/first-booking.mjs';
import {emptyState} from '../src/application.mjs';
import {createApplicationStore} from '../src/runtime/refund-application-database.mjs';
import {generateKeyPairSync} from 'node:crypto';
const at='2030-01-01T12:00:00Z',options={now:()=>at};
const actor=(business='vega')=>({role:'member',userId:'member',tenantId:business,businessId:business,participantIds:['self']});
function fixture(business='vega'){
 const a=actor(business),scope={tenantId:a.tenantId,businessId:a.businessId};
 return {...emptyState(),participants:[{id:'self',name:'Test member'},{id:'other',name:'Private member'}],classes:[{id:'class',title:'Published class',status:'open',startsAt:'2030-01-02T12:00:00Z',capacity:1,creditRequired:true,category:'Movement',waitlistEnabled:true}],passes:[{id:'pass',participantId:'self',label:'Existing pass'}],creditUnits:[{id:'unit',passId:'pass',participantId:'self',status:'available',entitlement:{expiresAt:'2030-02-01T00:00:00Z',categories:['Movement']}}],customerProfiles:[{...scope,accountId:a.userId,participantId:'self',revision:1,fields:{displayName:'Test member'}}],waiverVersions:[{...scope,id:'waiver',version:1,contentDigest:'digest',effectiveAt:at}],waiverAcceptances:[{...scope,accountId:a.userId,participantId:'self',waiverId:'waiver',contentDigest:'digest'}]};
}
const book=(s,a=actor(),body={})=>transition(s,{action:'reserve',body:{requestId:'first-booking',classId:'class',participantId:'self',...body}},a,options);
for(const business of ['vega','willow'])test(`${business}: first booking consumes once; member and staff history and capacity agree`,()=>{
 const a=actor(business),s=fixture(business),original=structuredClone(s),r=book(s,a),member=visibleState(r.state,a,at),staff=visibleState(r.state,{...a,role:'staff'},at);
 assert.equal(r.result.status,'reserved');assert.equal(r.state.creditEvents.filter(e=>e.type==='consume').length,1);
 assert.deepEqual(member.reservations,staff.reservations);assert.equal(member.classes[0].reservedCount,1);assert.equal(staff.creditUnits[0].status,'spent');
 assert.throws(()=>book(r.state,a),/Already booked/);assert.equal(r.state.creditEvents.filter(e=>e.type==='consume').length,1);
 for(const key of ['customerProfiles','waiverVersions','waiverAcceptances','participants','classes','orders'])assert.deepEqual(r.state[key],original[key]);
 assert.equal(member.participants.length,1);assert.deepEqual(member.activity,[]);
});
for(const [name,change,reason] of [
 ['missing profile',s=>s.customerProfiles=[],/Complete your profile/],
 ['waiver required',s=>s.waiverAcceptances=[],/current studio waiver/],
 ['new waiver',s=>s.waiverVersions.push({...s.waiverVersions[0],id:'new',version:2,contentDigest:'new'}),/current studio waiver/],
 ['ambiguous linkage',s=>s.customerProfiles.push({...s.customerProfiles[0],accountId:'someone-else'}),/Needs Staff Review/],
 ['no pass',s=>s.creditUnits=[],/No eligible/],
 ['expired credit',s=>s.creditUnits[0].entitlement.expiresAt=at,/No eligible/],
 ['ineligible category',s=>s.creditUnits[0].entitlement.categories=['Other'],/No eligible/],
 ['cancelled occurrence',s=>s.classes[0].status='cancelled',/unavailable/],
 ['stale capacity',s=>s.reservations.push({id:'competitor',classId:'class',participantId:'other',status:'reserved'}),/Class full/]
])test(name+' is checked on confirmation without mutation',()=>{const s=fixture();change(s);const before=structuredClone(s);assert.throws(()=>book(s),reason);assert.deepEqual(s,before);assert.equal(visibleState(s,actor(),at).bookingOptions[0].eligible,false);});
test('current waiver completion restores booking eligibility through existing waiver flow',()=>{const s=fixture();s.waiverAcceptances=[];const r=transition(s,{action:'waiver-accept',body:{requestId:'accept',participantId:'self',waiverId:'waiver',contentDigest:'digest',accepted:true}},actor(),options);assert.equal(book(r.state).result.status,'reserved');});
test('full class requires explicit waitlist; waitlist uses no credit and prevents duplicates',()=>{const s=fixture();s.reservations.push({id:'other',classId:'class',participantId:'other',status:'reserved'});assert.throws(()=>book(s),/Class full/);const r=book(s,actor(),{waitlistOnly:true});assert.equal(r.result.status,'waitlisted');assert.equal(r.state.creditUnits[0].status,'available');assert.equal(visibleState(r.state,actor(),at).reservations[0].waitlistPosition,1);assert.throws(()=>book(r.state,actor(),{waitlistOnly:true}),/Already booked/);});
test('waitlist intent never silently becomes a credit-consuming booking',()=>{assert.throws(()=>book(fixture(),actor(),{waitlistOnly:true}),/Waitlist unavailable/);});
test('missing credits route to existing offers; waiver routes to existing profile',()=>{const s=fixture();s.creditUnits=[];assert.equal(visibleState(s,actor(),at).bookingOptions[0].nextStep,'passes');s.waiverAcceptances=[];assert.equal(visibleState(s,actor(),at).bookingOptions[0].nextStep,'profile');});
test('foreign profile/waiver and forged participant cannot grant booking eligibility',()=>{const s=fixture('willow');assert.throws(()=>book(s,actor()),/Complete your profile/);assert.throws(()=>book(fixture(),actor(),{participantId:'other'}),/Participant authority/);});

test('runtime serializes last-seat contenders, replays lost responses, and captures one receipt/debit',async()=>{
 let state=fixture(),revision=0,tail=Promise.resolve();state.classes[0].startsAt=new Date(Date.now()+86400000).toISOString();state.waiverVersions=[];
 const commands=new Map(),outbox=new Map();
 const pool={async connect(){let unlock;return {release(){},async query(sql,args=[]){
  if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:'vega',business_id:'vega',role:'member',participant_ids:['self']}]};
  if(sql.startsWith('select state')){assert.match(sql,/for update$/);const previous=tail;tail=new Promise(r=>unlock=r);await previous;return {rows:[{state:structuredClone(state),revision}]};}
  if(sql.startsWith('select fingerprint'))return {rows:commands.has(args[3])?[commands.get(args[3])]:[]};
  if(sql.startsWith('select event_id,discovery_state'))return {rows:[outbox.get(args[3])]};
  if(sql.startsWith('update vega_private.app_state')){state=JSON.parse(args[0]);revision++;}
  if(sql.startsWith('insert into vega_private.app_commands'))commands.set(args[3],{fingerprint:args[4],response:JSON.parse(args[5])});
  if(sql.startsWith('insert into vega_private.recovery_outbox'))outbox.set(args[4],{event_id:args[0],state:'pending'});
  if(sql==='commit'||sql==='rollback')unlock?.();return {rows:[]};
 }}}};
 const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'}),store=createApplicationStore(pool,{receiptPublicKey});
 const command={action:'reserve',body:{requestId:'same',classId:'class',participantId:'self'}};
 const results=await Promise.allSettled([store.command('member',command),store.command('member',command),store.command('member',{...command,body:{...command.body,requestId:'competing'}})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.deepEqual(results[0].value,results[1].value);assert.equal(results[2].status,'rejected');assert.equal(revision,1);assert.equal(outbox.size,1);assert.equal(state.reservations.length,1);assert.equal(state.creditEvents.filter(e=>e.type==='consume').length,1);
 await assert.rejects(store.command({userId:'member',tenantId:'foreign',businessId:'foreign'},command),e=>e.status===403);
});

