import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {staffRuntimeFixture,staffIds as ids,scopes} from './helpers/staff-runtime-fixture.mjs';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
const denied=e=>e.status===403;
const enroll=h=>h.command(ids.worker,'staff-register',{name:'Staff fixture'});
test('existing staff membership has no business powers; self registration grants none and cannot register another identity',async()=>{
 const h=staffRuntimeFixture();assert.equal((await h.store.read(h.identity(ids.worker))).staffAccess.role,null);
 await assert.rejects(h.command(ids.worker,'participant',{name:'Unauthorized'}),denied);
 await assert.rejects(h.command(ids.worker,'staff-register',{name:'Spoof',userId:ids.owner}));
 await enroll(h);assert.equal((await h.store.read(h.identity(ids.worker))).staffAccess.role,null);
 await assert.rejects(h.command(ids.member,'staff-register',{name:'Member'}),denied);
 await assert.rejects(h.role('unknown'));
 assert.equal(h.records.get('studio-a').state.participants.length,1);
});
test('owner assigns roles through audited atomic commands; manager has operational access but no refund or role powers',async()=>{
 const h=staffRuntimeFixture();await enroll(h);const r=await h.role('manager');assert.equal(r.independentReceipt.state,'pending');
 const v=await h.store.read(h.identity(ids.worker));assert.equal(v.staffAccess.role,'manager');assert.equal(v.staffManagement,undefined);
 await h.command(ids.worker,'participant',{name:'Managed participant'});
 await assert.rejects(h.command(ids.worker,'staff-role-set',{userId:ids.worker,role:'owner',classIds:[],expectedRevision:1}),denied);
 await assert.rejects(h.store.refundContext(h.identity(ids.worker),'purchase'),denied);
 await assert.rejects(h.store.refundCommand(h.identity(ids.worker),{action:'refund-program-intent',body:{requestId:'no',purchaseId:'purchase'}}),denied);
 assert.equal(h.providerLookups,0);
 const owner=await h.store.read(h.identity());assert.equal(owner.staffManagement.people.find(p=>p.userId===ids.worker).role,'manager');assert.equal(owner.staffManagement.history.filter(h=>h.action==='staff-role-set').length,1);
});
test('front desk can book and record attendance, but schedule, financial, waiver and refund routes deny before provider reads',async()=>{
 const h=staffRuntimeFixture();await enroll(h);await h.role('front_desk');
 await h.command(ids.worker,'attendance',{status:'present',expectedRevision:0},'booking-one');
 for(const action of ['edit-class','class','duplicate-class','cancel-class','issue-credit','waiver-publish'])await assert.rejects(h.command(ids.worker,action,{}),denied);
 await assert.rejects(h.store.reviewClassEdit(h.identity(ids.worker),{}),denied);
 await assert.rejects(h.store.reviewClassDuplicate(h.identity(ids.worker),{}),denied);
 await assert.rejects(h.store.refundContext(h.identity(ids.worker),'x',undefined,'finance.read'),denied);
 assert.equal((await h.store.assessRefund(h.identity(ids.worker),'x')).status,'denied');
 const v=await h.store.read(h.identity(ids.worker));assert.deepEqual(v.refundHistory,[]);assert.deepEqual(v.jobs,[]);assert.equal(v.reservations[0].paymentStatus,undefined);assert.ok(v.profileAdministration);assert.equal(h.providerLookups,0);
});
test('instructor only sees assigned classes and attendance; replies and replay do not disclose payment data',async()=>{
 const h=staffRuntimeFixture();await enroll(h);await h.role('instructor',['class-one']);
 const cmd={action:'attendance',id:'booking-one',body:{requestId:'attendance',status:'present',expectedRevision:0}};
 for(let i=0;i<2;i++){const r=await h.store.command(h.identity(ids.worker),cmd);assert.equal(r.attendanceStatus,'present');assert.equal(r.paymentStatus,undefined);}
 const v=await h.store.read(h.identity(ids.worker));assert.deepEqual(v.classes.map(c=>c.id),['class-one']);assert.equal(v.reservations.length,1);assert.equal(v.frontDesk,undefined);assert.equal(v.profileAdministration,undefined);
 await assert.rejects(h.command(ids.worker,'attendance',{status:'present'},'booking-two'),denied);
 await assert.rejects(h.command(ids.worker,'reserve',{classId:'class-one',participantId:'person-one'}),denied);
 await h.role('instructor',['class-two']);await assert.rejects(h.store.command(h.identity(ids.worker),cmd),denied);
});
test('latest role blocks replay and old sensitive receipts; last owner and stale role updates are protected',async()=>{
 const h=staffRuntimeFixture();await enroll(h);await h.role('manager');
 const command={action:'participant',body:{requestId:'old-command',name:'Added'}};
 const r=await h.store.command(h.identity(ids.worker),command);await h.role('instructor',[]);
 await assert.rejects(h.store.command(h.identity(ids.worker),command),denied);
 const ack=await h.store.operation(h.identity(ids.worker),r.independentReceipt.operationId);assert.equal(ack.confirmed,true);assert.equal(ack.name,undefined);
 await assert.rejects(h.command(ids.owner,'staff-role-set',{userId:ids.owner,role:'manager',classIds:[],expectedRevision:0}),/at least one/);
 await assert.rejects(h.command(ids.owner,'staff-role-set',{userId:ids.worker,role:'manager',classIds:[],expectedRevision:0}),/changed/);
});
test('same authenticated account selects two businesses with different roles; foreign selection fails; member behavior stays unchanged',async()=>{
 const h=staffRuntimeFixture();await enroll(h);await h.command(ids.worker,'staff-register',{name:'Second studio staff'},undefined,scopes[1]);await h.role('manager');await h.role('instructor',['class-two'],scopes[1]);
 assert.equal((await h.store.memberships(ids.worker)).length,2);
 await assert.rejects(h.store.read(ids.worker),/Select an authorized business/);
 assert.equal((await h.store.read(h.identity(ids.worker))).staffAccess.role,'manager');
 assert.equal((await h.store.read(h.identity(ids.worker,scopes[1]))).staffAccess.role,'instructor');
 await assert.rejects(h.store.read({...h.identity(ids.worker),businessId:'foreign'}),denied);
 const before=structuredClone(h.records.get('studio-b'));await h.command(ids.worker,'participant',{name:'First studio only'});assert.deepEqual(h.records.get('studio-b'),before);
 const member=await h.store.read(h.identity(ids.member));assert.equal(member.staffAccess,undefined);assert.equal(member.customerProfile.status,'ready');assert.equal(member.staffManagement,undefined);
 await h.command(ids.member,'profile-update',{participantId:'person-one',expectedRevision:0,displayName:'Member name',phone:'',contactEmail:''});
 assert.equal((await h.store.read(h.identity(ids.member))).customerProfile.fields.displayName,'Member name');
});
test('role assignment and audit roll back together if recovery capture fails; duplicate assignments deny',async()=>{
 const h=staffRuntimeFixture();await enroll(h);const before=structuredClone(h.records);h.failOutbox=true;await assert.rejects(h.role('manager'),/receipt unavailable/);assert.deepEqual(h.records,before);h.failOutbox=false;
 await h.role('manager');const s=h.records.get('studio-a').state;s.staffRoleAssignments.push({...s.staffRoleAssignments[0]});assert.equal((await h.store.read(h.identity(ids.worker))).staffAccess.role,null);
 await assert.rejects(h.command(ids.worker,'participant',{name:'Denied'}),denied);
});
test('HTTP membership and business headers are validated; forged roles do not enable staff actions or provider execution',async()=>{
 const h=staffRuntimeFixture();await enroll(h);await h.role('instructor',['class-one']);
 const api=createApplicationApi({SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture'},h.store,async()=>({ok:true,json:async()=>({id:ids.worker})}));
 const request=async(path,body,headers={})=>{let status,value;const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:path,method:body?'POST':'GET',headers:{authorization:'Bearer fixture','content-type':'application/json','x-vega-tenant':scopes[0].tenantId,'x-vega-business':scopes[0].businessId,...headers}});await api(req,{writeHead:s=>status=s,end:b=>value=JSON.parse(b)});return {status,value};};
 assert.equal((await request('/api/businesses')).value.businesses.length,2);
 const view=await request('/api/app');assert.equal(view.status,200);assert.equal(view.value.refundProgram.enabled,false);assert.equal(view.value.paymentExecution.enabled,false);
 assert.equal((await request('/api/app',null,{'x-vega-business':'foreign'})).status,403);
 assert.equal((await request('/api/staff/roles',{requestId:'forge',userId:ids.worker,role:'owner',permissions:['roles.manage'],classIds:[],expectedRevision:1})).status,403);
 assert.equal((await request('/api/waivers/publish',{requestId:'forge',role:'owner'})).status,403);
});
