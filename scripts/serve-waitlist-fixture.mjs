// Loopback-only fixture. Real domain commands/projections, synthetic local authentication.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,transition,visibleState} from '../src/application.mjs';
const staff={role:'staff',userId:'local-desk',tenantId:'local',businessId:'local',participantIds:[]},member={...staff,role:'member',userId:'local-member',participantIds:['p']};
let state={...emptyState(),participants:[{id:'p',name:'Waiting Test Member'},{id:'holder',name:'Seat Holder'}],classes:[{id:'c',title:'Full Waitlist Test Class',instructor:'Test Instructor',location:'Test Studio',duration:60,startsAt:new Date(Date.now()+86400000).toISOString(),status:'open',capacity:1,waitlistEnabled:true,creditRequired:true}]};
function run(action,body,id){const next=transition(state,{action,id,body:{requestId:crypto.randomUUID(),...body}},staff);state=next.state;return next.result;}
for(const participantId of ['p','holder'])run('issue-credit',{participantId,quantity:2,reason:'Local fixture'});
run('reserve',{participantId:'holder',classId:'c'});
const assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'}),receipts=new Map();
const server=createServer(async(req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 let raw='';if(req.method==='POST')for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
 if(req.url?.startsWith('/api/auth/')){const role=body.email?.startsWith('member')||body.refreshToken==='member'?'member':'staff';return json(200,{accessToken:role,refreshToken:role,expiresIn:3600});}
 const actor=req.headers.authorization==='Bearer member'?member:staff;
 if(req.url==='/api/app')return json(200,{...visibleState(state,actor),context:actor,mode:'development',jobs:[]});
 const match=req.url?.match(/^\/api\/reservations\/([^/]+)\/(cancel|promote|attendance)$/),action=req.url==='/api/reservations'?'reserve':match?.[2];
 if(action&&req.method==='POST')try{const key=actor.userId+body.requestId,signature=JSON.stringify({url:req.url,body});if(receipts.has(key)){const prior=receipts.get(key);if(prior.signature!==signature)return json(409,{error:'Request conflict'});return json(200,prior.result);}const next=transition(state,{action,id:match?.[1],body},actor);state=next.state;receipts.set(key,{signature,result:next.result});return json(200,next.result);}catch(e){return json(e.status||500,{error:e.message});}
 if(req.method!=='GET')return json(405,{error:'Waitlist fixture only'});assets.emit('request',req,res);
});
server.listen(0,'127.0.0.1',()=>console.log(`Waitlist fixture http://127.0.0.1:${server.address().port}`));
