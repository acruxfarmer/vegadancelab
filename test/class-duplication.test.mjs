import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,transition,visibleState,ApplicationError} from '../src/application.mjs';
import {classDuplicateOption,reviewClassDuplicate} from '../src/class-duplication.mjs';
import {classEditOption,reviewClassEdit} from '../src/class-editing.mjs';
const staff={role:'staff',userId:'staff',tenantId:'t',businessId:'b',participantIds:[]},member={...staff,role:'member',userId:'member',participantIds:['p']};
const at='2030-01-01T00:00:00.000Z',clock={now:()=>at};
const details={title:'Ballet',instructor:'Teacher',location:'Studio',capacity:10,duration:60,startsAt:'2030-02-01T12:00:00.000Z',category:'Dance',creditRequired:false,waitlistEnabled:true,cancellationCutoffMinutes:90};
const seed=()=>({...emptyState(),classes:[{...details,id:'c',status:'open'}],participants:[{id:'p'}]});
const fail=(m,s)=>{throw new ApplicationError(m,s);};
const request=(s,patch={})=>({classId:'c',versionToken:classDuplicateOption(s.classes[0],at).versionToken,details:{startsAt:'2030-02-02T12:00:00.000Z',...patch}});
const review=(s,b,a=staff)=>reviewClassDuplicate(s,b,a,at,fail);
const apply=(s,b,a=staff)=>transition(s,{action:'duplicate-class',body:{...b,requestId:'copy-request'}},a,clock);
const confirm=(s,b)=>apply(s,{...b,reviewToken:review(s,b).reviewToken});

test('read-only review and confirmation create a new isolated snapshot with historical provenance, even from occupied sources',()=>{
 const s=seed();s.classes[0].editHistory=[{id:'old-audit'}];s.classes[0].seriesId='legacy-metadata';
 s.reservations=['reserved','waitlisted','cancelled'].map((status,i)=>({id:String(i),classId:'c',participantId:'p',status,attendanceStatus:'not_recorded',attendanceHistory:[{to:'present'}],waitlistHistory:[{action:'joined'}]}));
 const before=structuredClone(s),b=request(s),r=review(s,b);assert.deepEqual(s,before);
 const {state,result}=apply(s,{...b,reviewToken:r.reviewToken});assert.notEqual(result.id,'c');assert.equal(state.classes.length,2);assert.equal(result.status,'open');
 assert.deepEqual(state.classes[0],before.classes[0]);assert.equal(state.reservations.filter(x=>x.classId===result.id).length,0);
 for(const key of Object.keys(before).filter(k=>!['classes','activity'].includes(k)))assert.deepEqual(state[key],before[key]);
 for(const key of ['editHistory','cancellationHistory','seriesId','reservedCount'])assert.equal(result[key],undefined);
 assert.equal(state.creditUnits,undefined);assert.equal(state.creditEvents,undefined);
 const p=result.creationProvenance;assert.equal(p.sourceClassId,'c');assert.equal(p.classId,result.id);assert.equal(p.actorId,'staff');assert.equal(p.actorRole,'staff');assert.equal(p.requestId,'copy-request');assert.equal(p.createdAt,at);assert.deepEqual(p.sourceDetails,details);assert.deepEqual(p.details,r.details);
 assert.equal(state.activity.at(-1).id,p.id);assert.equal(state.activity.at(-1).subjectId,result.id);
 const sv=visibleState(state,staff,at),mv=visibleState(state,member,at),{creationProvenance,...sc}=sv.classes.find(c=>c.id===result.id);assert.deepEqual(mv.classes.find(c=>c.id===result.id),sc);assert.equal(mv.classDuplicateOptions,undefined);assert.equal(mv.activity.length,0);
});
test('future source edits and new-occurrence edits never propagate or rewrite provenance',()=>{
 const s=seed(),{state,result}=confirm(s,request(s)),provenance=structuredClone(result.creationProvenance);
 function edit(input,classId,title){const c=input.classes.find(c=>c.id===classId),fields={...details,...(classId===result.id?provenance.details:{}),title};const b={classId,versionToken:classEditOption(input,c,at).versionToken,details:fields,reason:'Independent change'};return transition(input,{action:'edit-class',body:{...b,reviewToken:reviewClassEdit(input,b,staff,at,fail).reviewToken,requestId:title}},staff,clock).state;}
 const sourceChanged=edit(state,'c','Source changed');assert.equal(sourceChanged.classes[1].title,details.title);
 const newChanged=edit(sourceChanged,result.id,'New changed');assert.equal(newChanged.classes[0].title,'Source changed');assert.deepEqual(newChanged.classes[1].creationProvenance,provenance);
});
test('missing review, tampering, changed source, actor/business changes and ineligible sources reject without mutation',()=>{
 const s=seed(),b=request(s),r=review(s,b),confirmed={...b,reviewToken:r.reviewToken};
 assert.throws(()=>apply(s,b),/Review the proposed/);
 assert.throws(()=>apply(s,{...confirmed,details:{...b.details,capacity:12}}),/Review the proposed/);
 for(const authority of [{...staff,userId:'other'},{...staff,businessId:'other'},{...staff,tenantId:'other'}])assert.throws(()=>apply(s,confirmed,authority),/Review the proposed/);
 assert.throws(()=>apply(s,confirmed,member),e=>e.status===403);assert.throws(()=>review(s,b,member),e=>e.status===403);
 for(const patch of [{capacity:12},{status:'cancelled'},{startsAt:at}]){const changed=structuredClone(s);Object.assign(changed.classes[0],patch);const before=structuredClone(changed);assert.throws(()=>apply(changed,confirmed),e=>e.status===409);assert.deepEqual(changed,before);}
 assert.throws(()=>review(s,{...b,classId:'missing'}),e=>e.status===404);
 assert.throws(()=>review(s,request(s,{startsAt:at})),/new future start/);
 assert.throws(()=>review(s,request(s,{startsAt:details.startsAt})),/different from the source/);
 assert.throws(()=>review(s,{...b,details:{}}),/Choose a new/);
});
test('normal creation validation and normalization are reused at both review and confirmation',()=>{
 const invalid=[{title:''},{title:'x'.repeat(201)},{instructor:' '},{location:42},{capacity:0},{capacity:1001},{capacity:1.5},{duration:0},{duration:1441},{startsAt:'invalid'},{cancellationCutoffMinutes:-1},{cancellationCutoffMinutes:10081},{cancellationCutoffMinutes:1.5}];
 for(const patch of invalid){const s=seed(),b=request(s,patch);let message;try{transition(s,{action:'class',body:{...details,...b.details,requestId:'create'}},staff,clock);assert.fail('Creation should reject');}catch(e){message=e.message;}assert.throws(()=>review(s,b),e=>e.message===message);assert.throws(()=>apply(s,{...b,reviewToken:'invalid'}),e=>e.message===message);}
 for(const patch of [{capacity:1000,duration:1440,cancellationCutoffMinutes:10080},{category:'',creditRequired:'true',waitlistEnabled:'true'},{startsAt:'2030-02-02T04:00:00-08:00'}]){
  const s=seed(),b=request(s,patch),r=review(s,b),created=transition(s,{action:'class',body:{...details,...b.details,requestId:'create'}},staff,clock).result;
  const {id,status,...fields}=created;assert.deepEqual(r.details,fields);const {creationProvenance,id:copyId,status:copyStatus,...copied}=confirm(s,b).result;assert.deepEqual(copied,fields);
 }
});
test('identity, status, histories, recurrence and arbitrary properties cannot enter copied details',()=>{
 for(const patch of [{id:'new'},{status:'open'},{editHistory:[]},{creationProvenance:{}},{seriesId:'series'},{reservations:[]},{cancelledAt:null}])assert.throws(()=>review(seed(),request(seed(),patch)),/Unsupported/);
});
test('confirmation rechecks upcoming eligibility when time crosses the reviewed boundary',()=>{
 const s=seed(),b=request(s,{startsAt:'2030-01-01T00:01:00Z'}),r=review(s,b),before=structuredClone(s);
 assert.throws(()=>transition(s,{action:'duplicate-class',body:{...b,reviewToken:r.reviewToken,requestId:'later'}},staff,{now:()=> '2030-01-01T00:02:00Z'}),/new future start/);assert.deepEqual(s,before);
});
