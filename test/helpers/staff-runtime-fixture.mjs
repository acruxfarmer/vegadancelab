import {generateKeyPairSync} from 'node:crypto';
import {emptyState} from '../../src/application.mjs';
import {createApplicationStore} from '../../src/runtime/refund-application-database.mjs';
const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
export const staffIds={owner:'11111111-1111-4111-8111-111111111111',worker:'22222222-2222-4222-8222-222222222222',member:'33333333-3333-4333-8333-333333333333'};
export const scopes=[{tenantId:'tenant-a',businessId:'studio-a'},{tenantId:'tenant-b',businessId:'studio-b'}];
export function staffRuntimeFixture(){
 const initialOwners=scopes.map(s=>({...s,userId:staffIds.owner,name:'Owner fixture'}));
 const records=new Map(scopes.map(s=>[s.businessId,{state:{...emptyState(),classes:[{id:'class-one',title:'Class one',capacity:8,status:'open',startsAt:'2099-01-01T18:00:00Z',duration:60},{id:'class-two',title:'Class two',capacity:8,status:'open',startsAt:'2099-01-02T18:00:00Z',duration:60}],participants:[{id:'person-one',name:'Person One'}],reservations:[{id:'booking-one',classId:'class-one',participantId:'person-one',status:'reserved',paymentStatus:'sensitive',attendanceStatus:'not_recorded'},{id:'booking-two',classId:'class-two',participantId:'person-one',status:'reserved',attendanceStatus:'not_recorded'}]},revision:1}]));
 const memberships=new Map(Object.entries(staffIds).map(([role,userId])=>[userId,scopes.map(s=>({...s,role:role==='member'?'member':'staff',participantIds:role==='member'?['person-one']:[]}))]));
 let commands=new Map(),outbox=new Map(),tail=Promise.resolve();const h={queries:[],providerLookups:0,failOutbox:false};
 const key=(a)=>JSON.stringify(a);
 const pool={async connect(){let actor,unlock,snapshot;return {release(){unlock?.();unlock=null;},async query(sql,args=[]){
  h.queries.push(sql);
  if(sql.startsWith('begin')){const previous=tail;tail=new Promise(r=>unlock=r);await previous;snapshot=structuredClone({records,commands,outbox});return {rows:[]};}
  if(sql==='rollback'){records.clear();for(const [k,v] of snapshot.records)records.set(k,v);commands=snapshot.commands;outbox=snapshot.outbox;return {rows:[]};}
  if(sql==='commit')return {rows:[]};
  if(sql.startsWith('select set_config')){actor=args[0];return {rows:[]};}
  if(sql.startsWith('select tenant_id')){if(actor!==args[0])throw Error('Actor boundary');return {rows:(memberships.get(actor)||[]).map(m=>({tenant_id:m.tenantId,business_id:m.businessId,role:m.role,participant_ids:m.participantIds}))};}
  if(sql.startsWith('select state')){if(!(memberships.get(actor)||[]).some(m=>m.tenantId===args[0]&&m.businessId===args[1]))return {rows:[]};return {rows:[structuredClone(records.get(args[1]))]};}
  if(sql.startsWith('select count'))return {rows:[{count:0}]};
  if(sql.startsWith('select fingerprint'))return {rows:commands.has(key(args))?[commands.get(key(args))]:[]};
  if(sql.startsWith('select event_id,discovery_state'))return {rows:outbox.has(key(args))?[{event_id:outbox.get(key(args)),state:'acknowledged'}]:[]};
  if(sql.startsWith('select o.event_id')){const entry=[...outbox.entries()].find(([k,v])=>v===args[0]&&k===key([args[1],args[2],args[3],JSON.parse(k)[3]]));return {rows:entry?[{state:'acknowledged',response:commands.get(entry[0]).response}]:[]};}
  if(sql.startsWith('update vega_private.app_state')){const r=records.get(args[2]);r.state=JSON.parse(args[0]);r.revision++;return {rows:[]};}
  if(sql.startsWith('insert into vega_private.app_commands')){commands.set(key(args.slice(0,4)),{fingerprint:args[4],response:JSON.parse(args[5])});return {rows:[]};}
  if(sql.startsWith('insert into vega_private.recovery_outbox')){if(h.failOutbox)throw Error('receipt unavailable');outbox.set(key(args.slice(1,5)),args[0]);return {rows:[]};}
  throw Error('Unexpected query '+sql);
 }}}};
 const store=createApplicationStore(pool,{initialOwners,receiptPublicKey,resolveIntegration:async()=>{h.providerLookups++;throw Error('Provider access must not occur in a denial test');}});
 const identity=(userId=staffIds.owner,scope=scopes[0])=>({userId,...scope});
 let sequence=0;
 const command=(userId,action,body={},id,scope=scopes[0])=>store.command(identity(userId,scope),{action,id,body:{requestId:'test-'+(++sequence),...body}});
 return Object.assign(h,{store,records,memberships,initialOwners,identity,command,role:async(role,classIds=[],scope=scopes[0])=>{
  const record=records.get(scope.businessId).state.staffRoleAssignments?.find(r=>r.userId===staffIds.worker);
  return command(staffIds.owner,'staff-role-set',{userId:staffIds.worker,role,classIds,expectedRevision:record?.revision||0},undefined,scope);
 }});
}
