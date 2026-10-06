// Local synthetic UI verification only; never connects to a provider or database.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {emptyState,transition,visibleState} from '../src/refund-application.mjs';
import {developmentFrontDeskPolicy} from '../src/front-desk.mjs';
import {qualifiedTransaction} from '../src/payment-contract.mjs';
const policy=developmentFrontDeskPolicy(),o=policy.offers[0],c=policy.customers[0];
const staff={userId:randomUUID(),tenantId:policy.tenantId,businessId:policy.businessId,role:'staff',participantIds:[]};
const member={...staff,userId:c.buyerId,role:'member',participantIds:[c.participantId]};
let state={...emptyState(),participants:[{id:c.participantId,name:'Synthetic existing customer'}],entitlementProducts:[{id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds}]},revision=0;
const commands=new Map(),ref={id:'fixture',version:1,provider:'fixture',environment:'sandbox',tenantId:staff.tenantId,businessId:staff.businessId};
const server=createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 try{
  if(req.url==='/api/config')return send(200,{environment:'development',authenticationConfigured:true,applicationConfigured:true});
  if(req.url==='/api/auth/sign-in'){let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);return send(200,{accessToken:b.email.startsWith('member')?'fixture-member':'fixture-staff',refreshToken:'fixture',expiresIn:3600});}
  const a=req.headers.authorization?.includes('fixture-member')?member:staff;
  if(req.url==='/api/app')return send(200,{...visibleState(state,a),context:{...a,name:'SYNTHETIC UI FIXTURE'},mode:'development',revision,jobs:[],recovery:{pendingCount:0},paymentExecution:{enabled:true,purchaseId:state.purchaseDrafts?.at(-1)?.id}});
  if(req.url==='/fixture/member')return send(200,visibleState(state,member));
  if(req.url.startsWith('/api/')&&req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),key=JSON.stringify([a.userId,req.url,body]);
   if(commands.has(key))return send(200,commands.get(key));
   const run=(action,b)=>{const next=transition(state,{action,body:b},a,{trustedPayment:action.startsWith('payment-'),integrationRef:ref});state=next.state;revision++;return next.result;};
   let result;
   if(req.url==='/api/commerce/front-desk/sales')result=run('front-desk-sale',body);
   else if(req.url.startsWith('/api/commerce/payments')){
    const attempt=run('payment-prepare',{...body,sourceDigest:'a'.repeat(64)}),paymentId=randomUUID();
    run('payment-observe',{...body,attemptId:attempt.attemptId,evidence:{status:'succeeded',verified:true,normalizationVersion:1,integrationRef:ref,referenceId:attempt.attemptId,paymentId,transactionRef:qualifiedTransaction(ref,paymentId),amount:6000,currency:'USD',verification:{method:'authenticated_lookup',observedAt:new Date().toISOString(),evidenceDigest:'b'.repeat(64)}}});
    result=run('payment-fulfill',{...body,attemptId:attempt.attemptId});
   }else return send(404,{error:'Fixture action unavailable'});
   commands.set(key,result);return send(200,result);
  }
  const path=req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0].slice(1);
  if(!/^[a-z0-9.-]+$/.test(path))return send(404,{});
  const bytes=await readFile(new URL(`../public/${path}`,import.meta.url));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});res.end(bytes);
 }catch(error){send(error.status||500,{error:error.message});}
});
server.listen(43116,'127.0.0.1',()=>console.log('Synthetic front-desk fixture: http://127.0.0.1:43116'));
