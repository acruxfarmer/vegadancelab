import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createRentalPlaybackWorkflow} from '../src/runtime/rental-playback-workflow.mjs';
import {createRentalPlaybackStore} from '../src/runtime/rental-playback-store.mjs';
import {createRentalTerms} from '../src/rental-policy.mjs';
import {correctRentalEntitlement} from '../src/rental-entitlement.mjs';
const at='2026-10-09T12:00:00.000Z',deviceId='d'.repeat(48),context={kind:'business',tenantId:'t',businessId:'b'};
const capabilities={protectedHls:true,rentalAccessVerified:true,evidenceReference:'synthetic-test-only'};
function fixture(){
 let currentTime=at;
 const binding={id:'binding',provider:'fake',state:'ready',assetRef:'file.mp4',revision:4,durationSeconds:60,durationAssetRef:'file.mp4',readyAt:at};
 const material={binding,placement:{id:'p',context,authorized:true,visible:true,resourceId:'r',policy:{kind:'pay_on_demand'}},resource:{id:'r',lifecycle:'active'}};
 const entitlement={id:'e',principalId:'viewer',state:'active',tenantId:'t',businessId:'b',createdAt:at,target:{kind:'media_placement',id:'p',tenantId:'t',businessId:'b'},rental:createRentalTerms({},{grantedAt:at,availableAt:at}),provenance:{kind:'staff_grant',actorId:'staff',reason:'test'}};
 let state={accessEntitlements:[entitlement],activity:[{action:'rental-complimentary-grant',subjectId:'e',actorId:'staff',tenantId:'t',businessId:'b'}]},tail=Promise.resolve();
 const store={mutate(actorId,placementId,operation,input,work){const p=tail.then(async()=>{const next=structuredClone(state);const result=await work({state:next,entitlement:next.accessEntitlements[0],session:next.rentalPlaybackSessions?.find(s=>s.id===input.sessionId),material,authority:{userId:actorId,...context},at:currentTime});state=next;return structuredClone(result);});tail=p.catch(()=>{});return p;}};
 return {material,setTime(value){currentTime=value;},get state(){return state;},store};
}
function adapter(overrides={}){let calls=0;return {rentalCapabilities:capabilities,get calls(){return calls;},async authorize(binding,{rental}){calls++;return {kind:'hls',url:'https://synthetic.invalid/playlist?secret=test',expiresAt:new Date(Date.parse(at)+120000).toISOString(),inheritQuery:true,ticket:{key:'key'}};},async revoke(){return {revoked:true};},...overrides};}
test('concurrent requests reserve once, provider network outside transaction, persisted ticket survives workflow restart',async()=>{
 const f=fixture();let release,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r),a=adapter({async authorize(binding,input){entered();await wait;return {kind:'hls',url:'https://synthetic.invalid/video?token=x',expiresAt:new Date(Date.parse(at)+120000).toISOString(),ticket:{key:'key'}};}});
 const workflow=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}}),first=workflow.start('viewer','p',{deviceId});await ready;
 await assert.rejects(workflow.start('viewer','p',{deviceId}),/requires reconciliation/);
 assert.equal(f.state.rentalPlaybackSessions.length,1);assert.equal(f.state.accessEntitlements[0].rental.activation.confirmedAt,null);
 release();const result=await first;assert.equal(result.source.ticket,undefined);
 const restarted=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:adapter({authorize(){throw Error('Must reuse persisted ticket');}})}});
 const resumed=await restarted.start('viewer','p',{deviceId});assert.deepEqual(resumed,result);
 await assert.rejects(restarted.start('viewer','p',{deviceId:'x'.repeat(48),sessionId:result.rental.sessionId}),/original device/);
});
test('uncertain provider issuance cannot duplicate ticket or consume another window',async()=>{
 const f=fixture(),a=adapter({async authorize(){throw Error('Network outcome unknown');}}),workflow=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}});
 await assert.rejects(workflow.start('viewer','p',{deviceId}),/unknown/);
 await assert.rejects(workflow.start('viewer','p',{deviceId}),/reconciliation/);
 assert.equal(f.state.rentalPlaybackSessions.length,1);assert.equal(f.state.accessEntitlements[0].rental.expiresAt,null);
});
test('browser confirmation cannot fabricate provider evidence; trusted observation settles once',async()=>{
 const f=fixture(),a=adapter(),workflow=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}}),start=await workflow.start('viewer','p',{deviceId}),input={...start.rental,deviceId,evidence:{kind:'provider_authorization_plus_player_ack'}};
 assert.equal((await workflow.confirm('viewer','p',input)).pending,true);assert.equal(f.state.accessEntitlements[0].rental.expiresAt,null);
 a.observePlayback=async(ticket,attemptId)=>({kind:'provider_authorization_plus_player_ack',ticketKey:ticket.key,attemptId,reference:'server-observed'});
 const confirmed=await workflow.confirm('viewer','p',input);assert.equal(confirmed.rental.status,'active');assert.deepEqual(await workflow.confirm('viewer','p',input),confirmed);
 await workflow.finish('viewer','p',input);assert.equal(f.state.rentalPlaybackTickets[0].state,'revoked');assert.equal(f.state.rentalPlaybackTickets[0].source,undefined);
});
function poolFixture(f){
 let state=structuredClone(f.state),revision=1;const calls=[];
 return {calls,get state(){return state;},async connect(){let staged=null;return {release(){},async query(sql,args=[]){calls.push(sql);if(sql==='begin'){staged=structuredClone(state);return {rows:[]};}if(sql==='commit'){state=staged;return {rows:[]};}if(sql==='rollback'){staged=null;return {rows:[]};}if(sql.includes('native_viewer_material'))return {rows:[{material:f.material}]};if(sql.includes('from vega_private.app_members'))return {rows:[{role:'member',participant_ids:[]}]};if(sql.includes('select state,revision'))return {rows:[{state:staged,revision}]};if(sql.startsWith('update vega_private.app_state')){staged=JSON.parse(args[0]);revision++;}return {rows:[]};}};}};
}
const key=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
test('real store contract locks aggregate, writes receipt atomically, rolls back unavailable receipt and failures',async()=>{
 const f=fixture(),pool=poolFixture(f),store=createRentalPlaybackStore(pool,{receiptPublicKey:key,now:()=>at});
 await store.mutate('viewer','p','test',{},({state})=>{state.marker='committed';return {ok:true};});
 assert.equal(pool.state.marker,'committed');assert.ok(pool.calls.some(s=>s.includes('for update')));assert.ok(pool.calls.some(s=>s.includes('insert into vega_private.recovery_outbox')));
 await assert.rejects(store.mutate('viewer','p','test',{},({state})=>{state.marker='not committed';throw Error('Failure');}),/Failure/);assert.equal(pool.state.marker,'committed');
 const noKey=createRentalPlaybackStore(pool,{receiptPublicKey:null,now:()=>at});await assert.rejects(noKey.mutate('viewer','p','test',{},({state})=>{state.marker='not committed';}),/capture unavailable/);assert.equal(pool.state.marker,'committed');
});
test('persisted entitlement changes invalidate staff revision; no-op and session-only writes preserve it',async()=>{
 const f=fixture(),pool=poolFixture(f),store=createRentalPlaybackStore(pool,{receiptPublicKey:key,now:()=>at});
 await store.mutate('viewer','p','activation',{},({entitlement})=>{entitlement.rental.activation={id:'activation',confirmedAt:at};entitlement.rental.expiresAt='2026-10-11T12:00:00.000Z';});
 assert.equal(pool.state.accessEntitlements[0].revision,2);
 assert.throws(()=>correctRentalEntitlement(structuredClone(pool.state),{entitlementId:'e',operation:'extend',hours:1,expectedRevision:1,reason:'Staff form opened before playback',requestId:'stale-form'},{userId:'staff',role:'staff',tenantId:'t',businessId:'b'},{id:()=> 'correction',now:()=>at},message=>{throw Error(message);}),/Current revision/);
 const writes=pool.calls.filter(s=>s.startsWith('update vega_private.app_state')).length;
 await store.mutate('viewer','p','activation-replay',{},()=>({ok:true}));
 assert.equal(pool.state.accessEntitlements[0].revision,2);assert.equal(pool.calls.filter(s=>s.startsWith('update vega_private.app_state')).length,writes);
 await store.mutate('viewer','p','session-only',{},({state})=>{state.rentalPlaybackSessions=[{id:'session'}];});
 assert.equal(pool.state.accessEntitlements[0].revision,2);
 await store.mutate('viewer','p','recovery',{},({entitlement})=>{entitlement.rental.recoveryUsedMs=120000;});
 assert.equal(pool.state.accessEntitlements[0].revision,3);
});

test('persisted ticket and new session cannot bypass expiry; late provider response is revoked',async()=>{
 const f=fixture(),a=adapter(),workflow=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}});
 const first=await workflow.start('viewer','p',{deviceId});
 const e=f.state.accessEntitlements[0];e.rental.activation.confirmedAt=at;e.rental.expiresAt=new Date(Date.parse(at)+60000).toISOString();
 f.setTime(e.rental.expiresAt);
 for(const input of [{deviceId},{deviceId,sessionId:first.rental.sessionId},{deviceId:'x'.repeat(48)}])await assert.rejects(workflow.start('viewer','p',input),/expired/);
 assert.equal(a.calls,1);
 const g=fixture();let revoked=0;
 const b=adapter({async authorize(){g.setTime('2027-01-01T00:00:00Z');return {kind:'hls',ticket:{key:'late'},expiresAt:'2027-01-01T00:02:00Z'};},async revoke(){revoked++;}});
 await assert.rejects(createRentalPlaybackWorkflow({store:g.store,adapters:{fake:b}}).start('viewer','p',{deviceId}),/expired/);
 assert.equal(revoked,1);assert.equal(g.state.rentalPlaybackTickets,undefined);
});

test('ambiguous startup evidence does not reset entitlement or recovery budget',async()=>{
 const f=fixture(),workflow=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:adapter()}});
 const start=await workflow.start('viewer','p',{deviceId});const before=structuredClone(f.state.accessEntitlements[0].rental);
 assert.deepEqual(await workflow.recover('viewer','p',{...start.rental,deviceId}),{recovered:false,reason:'startup_outcome_unresolved'});
 assert.deepEqual(f.state.accessEntitlements[0].rental,before);
});

test('confirmed no-ticket rejection recovers once and cumulative ten-minute budget stops retry',async()=>{
 const f=fixture();let count=0;
 const a=adapter({async authorize(){count++;f.setTime(new Date(Date.parse(at)+(count===1?120000:600000)).toISOString());const error=Error('Denied');error.code='RENTAL_TICKET_REJECTED';throw error;}});
 const workflow=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}});
 const one=await workflow.start('viewer','p',{deviceId});assert.equal(one.recovered,true);
 const activation=f.state.accessEntitlements[0].rental.activation.id;
 assert.equal(f.state.accessEntitlements[0].rental.recoveryUsedMs,120000);
 const two=await workflow.start('viewer','p',{deviceId});assert.equal(two.recovered,false);assert.equal(two.reason,'startup_recovery_exhausted');
 assert.equal(f.state.accessEntitlements[0].rental.activation.id,activation);assert.equal(f.state.accessEntitlements[0].rental.activation.confirmedAt,null);
 assert.equal(f.state.accessEntitlements[0].rental.recoveryUsedMs,600000);
 await assert.rejects(workflow.start('viewer','p',{deviceId}),/exhausted/);assert.equal(count,2);
});

test('scoped verification rechecks saved tickets, expiry during issuance and existing entitlement eligibility',async()=>{
 let enabled=true;
 const f=fixture(),a=adapter({rentalCapabilities:{...capabilities,rentalAccessVerified:false},rentalCapabilitiesFor(scope){return {...capabilities,rentalAccessVerified:enabled&&scope?.actorId==='viewer'&&scope?.placementId==='p'&&scope?.entitlementId==='e'};}});
 const w=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}});
 await assert.rejects(w.start('other','p',{deviceId}));assert.equal(a.calls,0);
 const result=await w.start('viewer','p',{deviceId});enabled=false;
 await assert.rejects(w.start('viewer','p',{deviceId,sessionId:result.rental.sessionId}));assert.equal(a.calls,1);
 enabled=true;f.setTime('2037-01-01T00:00:00.000Z');await assert.rejects(w.start('viewer','p',{deviceId,sessionId:result.rental.sessionId}));assert.equal(a.calls,1);
 const g=fixture();let revoked=false;
 const b=adapter({rentalCapabilitiesFor(){return {...capabilities,rentalAccessVerified:enabled};},async authorize(){enabled=false;return {kind:'hls',expiresAt:new Date(Date.parse(at)+120000).toISOString(),ticket:{key:'late'}};},async revoke(){revoked=true;}});
 enabled=true;await assert.rejects(createRentalPlaybackWorkflow({store:g.store,adapters:{fake:b}}).start('viewer','p',{deviceId}));assert.equal(revoked,true);
});

test('confirmed rejection retries successfully without a second activation record or clock consumption',async()=>{
 const f=fixture();let calls=0;
 const a=adapter({async authorize(){calls++;if(calls===1){f.setTime(new Date(Date.parse(at)+5000).toISOString());const e=Error('Synthetic provider rejection');e.code='RENTAL_TICKET_REJECTED';throw e;}return {kind:'hls',url:'https://synthetic.invalid/rental',expiresAt:new Date(Date.parse(at)+125000).toISOString(),ticket:{key:'recovered-ticket'}};},async observePlayback(ticket,attemptId){return {kind:'provider_authorization_plus_player_ack',ticketKey:ticket.key,attemptId,reference:'synthetic-recovered-playback'};}});
 const w=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}});
 assert.equal((await w.start('viewer','p',{deviceId})).recovered,true);
 const activationId=f.state.accessEntitlements[0].rental.activation.id;
 assert.equal(f.state.accessEntitlements[0].rental.expiresAt,null);
 const recovered=await w.start('viewer','p',{deviceId});
 f.setTime(new Date(Date.parse(at)+10000).toISOString());
 await w.confirm('viewer','p',{...recovered.rental,deviceId});
 const rental=f.state.accessEntitlements[0].rental;
 assert.equal(rental.activation.id,activationId);assert.equal(rental.activation.attempts.length,2);
 assert.equal(rental.recoveryUsedMs,5000);assert.equal(rental.activation.confirmedAt,new Date(Date.parse(at)+10000).toISOString());
 assert.equal(Date.parse(rental.expiresAt)-Date.parse(rental.activation.confirmedAt),rental.policy.viewingHours*3600000);
 assert.equal(f.state.rentalPlaybackTickets.length,1);
});
test('saved active session survives workflow restart and ticket renewal without extending purchased expiry',async()=>{
 const f=fixture();let current=Date.parse(at),calls=0;
 const a=adapter({async authorize(){calls++;return {kind:'hls',url:'https://synthetic.invalid/rental',expiresAt:new Date(current+120000).toISOString(),ticket:{key:'ticket-'+calls}};},async observePlayback(ticket,attemptId){return {kind:'provider_authorization_plus_player_ack',ticketKey:ticket.key,attemptId,reference:'synthetic-active-session'};}});
 const w=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}}),first=await w.start('viewer','p',{deviceId});
 await w.confirm('viewer','p',{...first.rental,deviceId});
 const before=structuredClone(f.state.accessEntitlements[0].rental);
 const restarted=createRentalPlaybackWorkflow({store:f.store,adapters:{fake:a}});
 await restarted.start('viewer','p',{deviceId,sessionId:first.rental.sessionId});assert.equal(calls,1);
 current+=130000;f.setTime(new Date(current).toISOString());
 const renewed=await restarted.start('viewer','p',{deviceId,sessionId:first.rental.sessionId});assert.equal(calls,2);
 assert.equal(renewed.rental.sessionId,first.rental.sessionId);assert.deepEqual(f.state.accessEntitlements[0].rental,before);
 await assert.rejects(restarted.start('viewer','p',{deviceId:'other-device',sessionId:first.rental.sessionId}));assert.equal(calls,2);
 f.setTime(before.expiresAt);await assert.rejects(restarted.start('viewer','p',{deviceId,sessionId:first.rental.sessionId}),/expired/);assert.equal(calls,2);
});
