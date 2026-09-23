import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState,ApplicationError} from '../src/application.mjs';
import {classEditOption,reviewClassEdit} from '../src/class-editing.mjs';
const staff={role:'staff',userId:'staff',participantIds:[]},member={role:'member',userId:'member',participantIds:['p']};
const at='2030-01-01T00:00:00.000Z',clock={now:()=>at};
const details={title:'Ballet',instructor:'Teacher',location:'Studio',capacity:10,duration:60,startsAt:'2030-02-01T12:00:00.000Z',category:'Dance',creditRequired:false,waitlistEnabled:true,cancellationCutoffMinutes:90};
const seed=()=>({...emptyState(),classes:[{...details,id:'c',status:'open'}],participants:[{id:'p'}]});
const fail=(m,s)=>{throw new ApplicationError(m,s);};
const request=(state,patch={})=>({classId:'c',versionToken:classEditOption(state,state.classes[0],at).versionToken,details:{...details,title:'Updated',...patch},reason:'Instructor requested correction'});
const review=(s,b)=>reviewClassEdit(s,b,staff,at,fail);
const apply=(s,b,a=staff)=>transition(s,{action:'edit-class',body:{...b,requestId:'edit-request'}},a,clock);
test('review is read-only; reviewed edit preserves identity, records attributable before/after and does not touch credit state',()=>{
 const s=seed(),original=structuredClone(s),b=request(s),r=review(s,b);assert.deepEqual(s,original);
 const {state,result}=apply(s,{...b,reviewToken:r.reviewToken});assert.equal(result.classId,'c');assert.equal(state.classes.length,1);assert.equal(state.classes[0].id,'c');assert.equal(state.classes[0].title,'Updated');
 const h=state.classes[0].editHistory[0];assert.equal(h.actorId,'staff');assert.equal(h.actorRole,'staff');assert.equal(h.createdAt,at);assert.equal(h.requestId,'edit-request');assert.deepEqual(h.before,details);assert.deepEqual(h.after,r.after);
 assert.equal(state.creditUnits,undefined);assert.equal(state.creditEvents,undefined);
 for(const key of Object.keys(original).filter(k=>!['classes','activity'].includes(k)))assert.deepEqual(state[key],original[key]);
 const sv=visibleState(state,staff,at),mv=visibleState(state,member,at);assert.equal(mv.classes[0].title,sv.classes[0].title);assert.equal(mv.classes[0].editHistory,undefined);assert.equal(mv.classEditOptions,undefined);
});
test('all historical rows block review and commit even after cancellation or attendance clearing',()=>{
 for(const row of [{status:'reserved'},{status:'waitlisted'},{status:'cancelled'},{status:'cancelled',waitlistHistory:[{action:'left'}]},{status:'cancelled',attendanceStatus:'not_recorded',attendanceHistory:[{to:'present'},{to:'not_recorded'}]}]){
  const s=seed(),b=request(s),r=review(s,b);s.reservations.push({id:'r',classId:'c',participantId:'p',...row});const before=structuredClone(s);
  assert.equal(classEditOption(s,s.classes[0],at).allowed,false);assert.throws(()=>review(s,b),/history exists/);assert.throws(()=>apply(s,{...b,reviewToken:r.reviewToken}),/history exists/);assert.deepEqual(s,before);
 }
});
test('stale occurrence, changed proposal/reason, missing review, wrong actor, cancelled/past and no-op edits rejected',()=>{
 const s=seed(),b=request(s),r=review(s,b),confirmed={...b,reviewToken:r.reviewToken};
 assert.throws(()=>apply(s,b),/Review the proposed/);
 assert.throws(()=>apply(s,{...confirmed,details:{...b.details,capacity:12}}),/Review the proposed/);
 assert.throws(()=>apply(s,{...confirmed,reason:'Different reason'}),/Review the proposed/);
 assert.throws(()=>apply(s,confirmed,{...staff,userId:'other'}),/Review the proposed/);
 assert.throws(()=>apply(s,confirmed,member),e=>e.status===403);
 assert.throws(()=>reviewClassEdit(s,b,member,at,fail),e=>e.status===403);
 assert.throws(()=>review(s,request(s,{title:details.title})),/No occurrence changes/);
 assert.throws(()=>review(s,request(s,{startsAt:at})),/remain upcoming/);
 for(const patch of [{capacity:12},{status:'cancelled'},{startsAt:at}]){const changed=structuredClone(s);Object.assign(changed.classes[0],patch);assert.throws(()=>apply(changed,confirmed),e=>e.status===409);}
 const next=apply(s,confirmed).state;assert.throws(()=>apply(next,confirmed),/Occurrence changed/);
});
test('creation and edit share identical field validation and normalization',()=>{
 const cases=[{title:''},{title:'x'.repeat(201)},{instructor:' '},{location:42},{capacity:0},{capacity:1001},{capacity:1.5},{duration:0},{duration:1441},{startsAt:'invalid'},{cancellationCutoffMinutes:-1},{cancellationCutoffMinutes:10081},{cancellationCutoffMinutes:1.5}];
 for(const patch of cases){const s=seed(),b=request(s,patch);let message;try{transition(s,{action:'class',body:{...b.details,requestId:'create'}},staff,clock);assert.fail('Creation should reject');}catch(e){message=e.message;}assert.throws(()=>review(s,b),e=>e.message===message);assert.throws(()=>apply(s,{...b,reviewToken:'invalid'}),e=>e.message===message);}
 for(const patch of [{capacity:1000,duration:1440,cancellationCutoffMinutes:10080},{category:'',creditRequired:'true',waitlistEnabled:'true'},{startsAt:'2030-02-01T04:00:00-08:00'}]){
  const s=seed(),b=request(s,patch),r=review(s,b);const created=transition(s,{action:'class',body:{...b.details,requestId:'create'}},staff,clock).result;const {id,status,...fields}=created;assert.deepEqual(r.after,fields);
 }
});
test('identity, status, history and recurring fields cannot be written through edit details',()=>{
 for(const patch of [{id:'new'},{status:'open'},{editHistory:[]},{seriesId:'series'},{cancelledAt:null}]){const s=seed();assert.throws(()=>review(s,request(s,patch)),/Unsupported/);}
});
