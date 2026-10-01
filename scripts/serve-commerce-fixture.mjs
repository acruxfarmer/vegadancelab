// Synthetic loopback-only UI fixture; never connects to hosted services.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {developmentOffer,PRODUCT_ID} from '../src/commerce.mjs';
const o=developmentOffer(),member={userId:'e5946b40-9839-4a96-99d5-93262d9573f0',tenantId:'vega-development',businessId:'vega-dance-lab',role:'member',participantIds:['vega-member-test-joe'],name:'Vega Development fixture'};
const staff={...member,userId:'synthetic-staff',role:'staff',participantIds:[]};
let state={...emptyState(),participants:[{id:'vega-member-test-joe',name:'Synthetic member'}],entitlementProducts:[{id:PRODUCT_ID,name:o.productName,type:'class_pack',quantity:3,validDays:30,categories:o.categories,classIds:[]}]};
const receipts=new Map(),assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
const server=createServer(async(req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();let body={};try{if(raw)body=JSON.parse(raw);}catch{return json(400,{error:'Invalid JSON'});}
 if(req.url==='/api/auth/sign-in'||req.url==='/api/auth/refresh'){const role=body.email?.startsWith('staff')||body.refreshToken==='staff'?'staff':'member';return json(200,{accessToken:role,refreshToken:role,expiresIn:3600});}
 const a=req.headers.authorization==='Bearer staff'?staff:member;
 if(req.url==='/api/app')return json(200,{...visibleState(state,a),context:a,mode:'development',squareEnabled:false,jobs:[]});
 if(req.url==='/api/commerce/drafts'&&req.method==='POST'){
  try{const key=a.userId+body.requestId,prior=receipts.get(key);if(prior){if(prior.body!==raw)return json(409,{error:'Request conflict'});return json(200,prior.result);}
   const next=transition(state,{action:'purchase-draft',body},a);state=next.state;receipts.set(key,{body:raw,result:next.result});return json(200,next.result);
  }catch(e){return json(e.status||500,{error:e.message});}
 }
 if(req.method!=='GET')return json(405,{error:'Fixture operation unavailable'});
 assets.emit('request',req,res);
});
server.listen(0,'127.0.0.1',()=>console.log(`Commerce fixture: http://127.0.0.1:${server.address().port}`));
