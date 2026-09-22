// Read-only loopback browser harness, seeded through existing domain operations.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,visibleState,transition} from '../src/application.mjs';
const staff={role:'staff',userId:'local-desk',participantIds:[]};let actor=staff,n=0;
const at=Date.now(),stamp=()=>new Date(at+n*1000).toISOString();
let state={...emptyState(),participants:[{id:'p',name:'Audit Member'},{id:'other',name:'Other Member'}],classes:['Audit class A','Audit class B'].map((title,i)=>({id:`c${i}`,title,category:'Dance',startsAt:new Date(at+86400000*2).toISOString(),duration:60,instructor:'Test instructor',location:'Local studio',capacity:3,status:'open',creditRequired:true}))};
const run=(action,body={},id)=>{const next=transition(state,{action,id,body:{requestId:`request-${++n}`,...body}},staff,{id:()=>`record-${++n}`,now:stamp});state=next.state;return next.result;};
run('issue-credit',{participantId:'p',quantity:1,reason:'Audit courtesy fixture'});
const a=run('reserve',{participantId:'p',classId:'c0'});run('cancel',{classification:'early',reason:'Early fixture'},a.id);
const b=run('reserve',{participantId:'p',classId:'c1'});run('correct-cancellation',{classification:'late',reason:'Spent-restoration blocked fixture'},a.id);run('cancel',{classification:'late',reason:'Late fixture'},b.id);run('correct-cancellation',{classification:'early',reason:'Reviewed fixture'},b.id);run('correct-cancellation',{classification:'late',reason:'Reverse available restoration'},b.id);run('correct-cancellation',{classification:'late',reason:'Unchanged repeat'},b.id);
const product=run('entitlement-product',{name:'Expired membership fixture',type:'membership',quantity:2,validDays:1});run('issue-entitlement',{productId:product.id,participantId:'p',issuanceRef:'local-membership',membershipRef:'local-period',periodStart:new Date(at-86400000*10).toISOString(),reason:'Expired membership audit fixture'});
state.reservations.push({id:'legacy',participantId:'other',classId:'c0',status:'cancelled'});
const assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
const server=createServer(async(req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url==='/api/auth/sign-in'){let raw='';for await(const chunk of req)raw+=chunk;actor=JSON.parse(raw).email.startsWith('member')?{role:'member',userId:'local-member',participantIds:['p']}:staff;return json(200,{accessToken:'synthetic',refreshToken:'synthetic',expiresIn:3600});}
 if(req.url?.startsWith('/api/auth/'))return json(200,{accessToken:'synthetic',refreshToken:'synthetic',expiresIn:3600});
 if(req.url==='/api/app')return json(200,{...visibleState(state,actor),context:actor,mode:'development',jobs:[]});
 if(req.method!=='GET')return json(405,{error:'Read-only audit fixture'});
 assets.emit('request',req,res);
});
server.listen(0,'127.0.0.1',()=>console.log(`Audit fixture: http://127.0.0.1:${server.address().port}`));
