import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessRefundEligibility} from '../src/refund-eligibility.mjs';
import {digest} from '../src/payments.mjs';
const original=JSON.parse(readFileSync(new URL('./fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
// A materially different synthetic business; never written to a hosted database.
function secondBusiness(){
 let raw=JSON.stringify(original);
 for(const [from,to] of [['vega-development','tenant-workshops'],['vega-dance-lab','business-ceramics'],['vega-member-test-joe','participant-ceramics'],['3609b576-10f1-4d16-94df-e46e10ec7a96','10000000-0000-4000-8000-000000000001'],['sandbox_purchase','owned_purchase']])raw=raw.replaceAll(from,to);
 const s=JSON.parse(raw),d=s.purchaseDrafts[0],a=s.paymentAttempts[0],g=s.entitlementIssuances[0],p=s.passes[0];
 Object.assign(d.terms,{priceMinor:12500,currency:'EUR',quantity:7,validDays:45,productId:'ceramics-seven-workshops',productType:'workshop_bundle',productName:'Seven workshops',categories:['Ceramics'],classIds:[]});
 d.terms.tax.amountMinor=1250;d.terms.refundPolicy.requestWithinDays=14;
 Object.assign(d,{currency:'EUR',subtotalMinor:12500,taxMinor:1250,totalMinor:13750,expiresAt:new Date(Date.parse(d.validFrom)+45*86400000).toISOString()});
 Object.assign(a.financialIntent,{amountMinor:d.totalMinor,currency:d.currency});Object.assign(a.evidence,{amount:d.totalMinor,currency:d.currency});a.offerDigest=digest(d.terms);
 const o=d.terms;g.productSnapshot={id:o.productId,name:o.productName,type:o.productType,quantity:o.quantity,validDays:o.validDays,categories:o.categories,classIds:o.classIds};
 Object.assign(g,{productId:o.productId,quantity:o.quantity,expiresAt:d.expiresAt});p.quantity=o.quantity;
 Object.assign(p.entitlement,{productId:o.productId,productName:o.productName,productType:o.productType,expiresAt:d.expiresAt,categories:o.categories,classIds:o.classIds});
 s.creditUnits=Array.from({length:o.quantity},(_,i)=>({...structuredClone(s.creditUnits[0]),id:`ceramics-credit-${i}`,entitlement:structuredClone(p.entitlement)}));
 s.creditEvents=s.creditUnits.map((u,i)=>({...structuredClone(s.creditEvents[0]),id:`ceramics-event-${i}`,unitId:u.id}));
 return s;
}
function input(s){const d=s.purchaseDrafts[0];return {state:s,authority:{role:'staff',tenantId:d.tenantId,businessId:d.businessId,userId:'staff-reviewer'},purchaseId:d.id,at:'2026-10-03T00:00:00Z',refundRecords:[]};}
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
for(const [label,make] of [['original',()=>structuredClone(original)],['second business',secondBusiness]]){
 for(const [name,change,status,code] of [
  ['eligible',()=>{},'eligible','WHOLLY_UNUSED_ENTITLEMENT'],
  ['missing inventory',x=>delete x.refundRecords,'blocked','REFUND_STATE_UNRESOLVED'],
  ['cross business',x=>x.authority.businessId='unrelated','denied','OWNERSHIP_SCOPE_DENIED'],
  ['cross tenant',x=>x.authority.tenantId='unrelated','denied','OWNERSHIP_SCOPE_DENIED'],
  ['cutoff',x=>x.at=new Date(Date.parse(x.state.purchaseDrafts[0].refundWindowStartsAt)+x.state.purchaseDrafts[0].terms.refundPolicy.requestWithinDays*86400000).toISOString(),'blocked','REFUND_CUTOFF_POLICY_UNRESOLVED'],
  ['expired',x=>x.at=new Date(Date.parse(x.state.purchaseDrafts[0].refundWindowStartsAt)+x.state.purchaseDrafts[0].terms.refundPolicy.requestWithinDays*86400000+1).toISOString(),'ineligible','REFUND_WINDOW_EXPIRED'],
  ['restored',x=>x.state.creditEvents.push({...x.state.creditEvents[0],type:'restore'}),'blocked','RESTORED_USAGE_POLICY_UNRESOLVED'],
  ['consumed',x=>x.state.creditUnits[0].status='spent','ineligible','ENTITLEMENT_CONSUMED'],
  ['tampered amount',x=>x.state.purchaseDrafts[0].totalMinor++,'blocked','FROZEN_TERMS_UNSUPPORTED'],
  ['tampered quantity',x=>x.state.creditUnits.pop(),'blocked','FULFILLMENT_STATE_INCONSISTENT'],
  ['tampered provenance',x=>x.state.creditEvents[0].source='different','blocked','USAGE_HISTORY_INCOMPLETE'],
 ])test(`${label}: generic ${name}`,()=>{const x=input(make());change(x);const before=structuredClone(x);freeze(x);const r=assessRefundEligibility(x);assert.equal(r.status,status);assert.ok(r.reasonCodes.includes(code));assert.equal(r.contractVersion,2);assert.equal(r.executionAuthorized,false);assert.deepEqual(x,before);if(status==='eligible')assert.deepEqual(r.refundAmount,{amountMinor:x.state.purchaseDrafts[0].totalMinor,currency:x.state.purchaseDrafts[0].currency});});
}
test('different frozen windows produce different decisions at the same time',()=>{const a=input(structuredClone(original)),b=input(secondBusiness());a.at=b.at='2026-10-20T00:00:00Z';assert.equal(assessRefundEligibility(a).status,'eligible');assert.equal(assessRefundEligibility(b).status,'ineligible');});
test('generic evaluator contains no fixture literals or legacy reason aliases',()=>{const source=readFileSync(new URL('../src/refund-eligibility.mjs',import.meta.url),'utf8');for(const forbidden of ['vega','6000','USD','sandbox_purchase','THREE_CREDITS','30_DAY_WINDOW'])assert.ok(!source.includes(forbidden),forbidden);});
