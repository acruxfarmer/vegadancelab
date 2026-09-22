// Synthetic loopback-only browser fixture: first successful command loses its response.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,visibleState,transition} from '../src/application.mjs';
const actor={role:'staff',userId:'local-desk',tenantId:'local',businessId:'local',participantIds:[]};
let state={...emptyState(),participants:[{id:'p',name:'Recovery Test Member'}]},lose=true;
const receipts=new Map(),assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
const server=createServer(async(req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url?.startsWith('/api/auth/'))return json(200,{accessToken:'synthetic',refreshToken:'synthetic',expiresIn:3600});
 if(req.url==='/api/app')return json(200,{...visibleState(state,actor),context:actor,mode:'development',jobs:[]});
 if(req.url==='/api/credits/issue'&&req.method==='POST'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),prior=receipts.get(body.requestId);
  if(prior){console.log('REPLAY: original result returned; no new credit');return json(200,prior);}
  try{const next=transition(state,{action:'issue-credit',body},actor);state=next.state;receipts.set(body.requestId,next.result);console.log(`COMMIT: ${state.creditUnits.length} credit unit(s)`);if(lose){lose=false;return json(503,{error:'Synthetic response lost after commit'});}return json(200,next.result);}catch(e){return json(e.status||500,{error:e.message});}
 }
 if(req.method!=='GET')return json(405,{error:'Only synthetic courtesy recovery is enabled'});
 assets.emit('request',req,res);
});
server.listen(0,'127.0.0.1',()=>console.log(`Recovery fixture: http://127.0.0.1:${server.address().port}`));
