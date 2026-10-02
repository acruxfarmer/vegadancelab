// Loopback-only visual fixture. No credentials or provider calls.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {commerceUI} from '../public/commerce-ui.js';
import {developmentOffer} from '../src/commerce.mjs';
const offer=developmentOffer(),escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const states=['not_started','pending','unresolved','failed','cancelled','succeeded','succeeded'];
const drafts=states.map((status,n)=>({id:`synthetic-${n}`,terms:offer,totalMinor:6000,createdAt:'2026-10-01T00:00:00Z',buyerId:'synthetic-member',participantId:'synthetic-participant',paymentStatus:status,fulfillmentStatus:n===6?'issued':status==='succeeded'?'pending':'not_issued',activeAttemptId:n?`attempt-${n}`:null,validFrom:n===6?'2026-10-01T00:00:00Z':null,expiresAt:n===6?'2026-10-31T00:00:00Z':null,refundWindowStartsAt:status==='succeeded'?'2026-10-01T00:00:00Z':null,paymentSummary:{paymentId:n>4?`synthetic-payment-${n}`:null,reason:status==='unresolved'?'get_payment_unavailable':null}}));
createServer(async(req,res)=>{
 if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(new URL('../public/styles.css',import.meta.url)));return;}
 const staff=req.url==='/staff',data={context:{role:staff?'staff':'member'},commerceOffers:[],purchaseDrafts:drafts,paymentExecution:{enabled:false}};
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Vega 6.9 local status verification</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>Local ${staff?'staff':'member'} status fixture</h1><p>Synthetic states only. Payment execution disabled.</p>${commerceUI({escape,getData:()=>data}).render()}</main></body></html>`);
}).listen(0,'127.0.0.1',function(){console.log(`Payment status fixture: http://127.0.0.1:${this.address().port}`);});
