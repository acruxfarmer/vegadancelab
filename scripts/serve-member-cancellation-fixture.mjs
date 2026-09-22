// Local-only UI harness: synthetic authentication/state, real member transitions.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,visibleState,transition} from '../src/application.mjs';
const actor={role:'member',userId:'local-member',participantIds:['p']};
const initial=Date.now();let at=initial,posts=0,sequence=0;
const stamp=ms=>new Date(ms).toISOString();
const stateFor=()=>({...emptyState(),participants:[{id:'p',name:'Local Member'},{id:'other',name:'Private Other Member'}],classes:['Early class','Late class','Past class','Attendance recorded','No-credit class'].map((title,i)=>({id:`c${i}`,title,startsAt:stamp(initial+(i===2?-3600000:7200000)),status:'open',duration:60,instructor:'Test Instructor',location:'Local test studio',capacity:5,cancellationCutoffMinutes:i===1?10080:90})),passes:[{id:'pass',participantId:'p',label:'Local Test Pack',entitlement:{expiresAt:stamp(initial+86400000)}}],reservations:[0,1,2,3,4].map(i=>({id:`r${i}`,classId:`c${i}`,participantId:'p',status:'reserved',attendanceStatus:i===3?'present':'not_recorded',...(i!==4?{creditConsumption:{unitId:`u${i}`,passId:'pass'}}:{})})),creditUnits:[0,1,2,3].map(i=>({id:`u${i}`,passId:'pass',participantId:'p',status:'spent',spentByBookingId:`r${i}`,entitlement:{expiresAt:stamp(initial+86400000)}}))});
let state=stateFor();const commands=new Map();
const assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
const server=createServer(async(req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
  if(req.url==='/fixtures'){
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(`<h1>Local cancellation test controls</h1><p>POST attempts: ${posts}</p><p>Restorations: ${(state.creditEvents||[]).filter(e=>e.type==='restore').length}</p><form method="post" action="/fixture-cutoff"><button>Advance past early cutoff</button></form><form method="post" action="/fixture-reset"><button>Reset synthetic state</button></form>`);return;
  }
  if(req.method==='POST'&&req.url?.startsWith('/fixture-')){if(req.url==='/fixture-cutoff')at=initial+30*60000+1000;else {state=stateFor();at=initial;posts=0;commands.clear();}res.writeHead(303,{Location:'/fixtures'});res.end();return;}
  if(req.url?.startsWith('/api/auth/')){json(200,{accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresIn:3600});return;}
  if(req.url==='/api/app'){json(200,{...visibleState(state,actor,stamp(at)),context:actor,mode:'development',jobs:[]});return;}
  if(req.method==='POST'&&req.url?.startsWith('/api/reservations/')){
   posts++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),id=req.url.split('/')[3],fingerprint=JSON.stringify([id,body]);
   const previous=commands.get(body.requestId);if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Request changed');json(200,previous.result);return;}
   const next=transition(state,{action:'cancel',id,body},actor,{now:()=>stamp(at),id:()=>`test-${++sequence}`});state=next.state;commands.set(body.requestId,{fingerprint,result:next.result});
   await new Promise(r=>setTimeout(r,300));json(200,next.result);return;
  }
  assets.emit('request',req,res);
 }catch(error){json(error.status||503,{error:error.message});}
});
server.listen(0,'127.0.0.1',()=>console.log(`Local cancellation harness: http://127.0.0.1:${server.address().port}`));
