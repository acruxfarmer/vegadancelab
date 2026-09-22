// Loopback-only staff support harness, synthetic identity and real domain transitions.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,visibleState,transition} from '../src/application.mjs';
const staff={role:'staff',userId:'local-desk',participantIds:[]},at=Date.now();let sequence=0,posts=0;
const terms={productType:'class_pack',categories:['Dance'],expiresAt:new Date(at+10*86400000).toISOString()};
let state={...emptyState(),participants:[{id:'p',name:'Local Support Member'},{id:'q',name:'Other Member'}],classes:['Early class','Late class','Full class','Wrong category'].map((title,i)=>({id:`c${i}`,title,category:i===3?'Other':'Dance',status:'open',startsAt:new Date(at+2*86400000).toISOString(),capacity:i===2?1:3,duration:60,instructor:'Local Instructor',location:'Development fixture',creditRequired:true,cancellationCutoffMinutes:i===1?10080:90,waitlistEnabled:true})),passes:[{id:'pack',participantId:'p',label:'Support dance pack',entitlement:terms}],creditUnits:[0,1,2].map(i=>({id:`u${i}`,participantId:'p',passId:'pack',status:'available',entitlement:terms})),reservations:[{id:'occupied',classId:'c2',participantId:'q',status:'reserved',attendanceStatus:'not_recorded'}]};
const commands=new Map(),assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
const server=createServer(async(req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
  if(req.url?.startsWith('/api/auth/'))return json(200,{accessToken:'synthetic',refreshToken:'synthetic',expiresIn:3600});
  if(req.url==='/api/app')return json(200,{...visibleState(state,staff),context:staff,mode:'development',jobs:[]});
  if(req.url==='/fixtures'){res.writeHead(200,{'Content-Type':'text/html'});res.end(`<h1>Staff fixture metrics</h1><p>POST attempts: ${posts}</p><p>Bookings: ${state.reservations.length-1}</p><p>Restorations: ${(state.creditEvents||[]).filter(e=>e.type==='restore').length}</p>`);return;}
  if(req.method==='POST'&&req.url?.startsWith('/api/')){
   posts++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),fingerprint=JSON.stringify([req.url,body]),prior=commands.get(body.requestId);
   if(prior){if(prior.fingerprint!==fingerprint)throw Error('Request changed');return json(200,prior.result);}
   const parts=req.url.split('/'),action=req.url==='/api/reservations'?'reserve':req.url==='/api/credits/issue'?'issue-credit':parts[4];
   const next=transition(state,{action,id:parts[3],body},staff,{id:()=>`fixture-${++sequence}`});state=next.state;commands.set(body.requestId,{fingerprint,result:next.result});await new Promise(r=>setTimeout(r,250));return json(200,next.result);
  }
  assets.emit('request',req,res);
 }catch(error){json(error.status||400,{error:error.message});}
});
server.listen(0,'127.0.0.1',()=>console.log(`Staff booking harness: http://127.0.0.1:${server.address().port}`));
