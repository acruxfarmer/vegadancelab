import {readFileSync} from 'node:fs';
import {digest} from '../../src/payments.mjs';
import {inventoryDigest,ownedInventoryCategories} from '../../src/refund-inventory.mjs';
const original=JSON.parse(readFileSync(new URL('../fixtures/refund-eligibility.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
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

export function assemblyFixture(business,processor){
 let state=business==='original'?structuredClone(original):secondBusiness();
 state=JSON.parse(JSON.stringify(state).replaceAll('"square"',JSON.stringify(processor)));
 state.refundRecords=[];
 const d=state.purchaseDrafts[0],a=state.paymentAttempts[0];
 const scope={tenantId:d.tenantId,businessId:d.businessId,purchaseId:d.id,attemptId:a.id};
 const paymentRef={provider:processor,integrationId:a.integrationRef.id,integrationVersion:a.integrationRef.version,environment:a.integrationRef.environment,resourceId:a.paymentId};
 const at='2026-10-03T00:00:00Z';
 const x={authority:{role:'staff',userId:'fixture-reviewer',tenantId:scope.tenantId,businessId:scope.businessId},context:{scope,revision:'127',stateDigest:'a'.repeat(64),at,freshnessPolicy:{id:'synthetic-policy',approvalRef:'test-only-not-operational',ownedMaxAgeMs:1000,providerMaxAgeMs:1000}},ownedSnapshot:{scope:structuredClone(scope),revision:'127',stateDigest:'a'.repeat(64),assessedAt:at,evidenceCutoff:at,state,paymentRef},frozenTermsRef:{id:d.terms.id,digest:digest(d.terms)},providerEvidence:{facts:{payment:{reference:paymentRef,amountMinor:d.totalMinor,currency:d.currency,status:'confirmed'},refunds:[],adjustments:[]}},attestations:{coverage:{owned:{},provider:{}},policyBoundaries:[],evidence:[]}};
 const record=(id,extra={})=>({id,scope:structuredClone(scope),...extra});
 x.ownedSnapshot.facts={purchase:{amountMinor:d.totalMinor,currency:d.currency,frozenTermsDigest:digest(d.terms)},confirmation:{status:'confirmed',paymentRef,confirmedAt:d.paymentConfirmedAt},refunds:[],issuance:state.entitlementIssuances.map(g=>record(g.id,{quantity:g.quantity})),consumption:[],restoration:[],reservations:[],clocks:{refundWindowStartsAt:d.refundWindowStartsAt,refundWindowEndsAt:new Date(Date.parse(d.refundWindowStartsAt)+d.terms.refundPolicy.requestWithinDays*86400000).toISOString()},ownership:structuredClone(scope),recovery:[record('fixture-receipt',{state:'acknowledged'})],audit:[record('fixture-audit')]};
 const basis={source:'synthetic-history',method:'exhaustive-scoped-fixture',exhaustive:true,paginationComplete:true,exclusions:[]};
 for(const c of ownedInventoryCategories)x.attestations.coverage.owned[c]={state:'complete',cutoff:at,coverageBasis:structuredClone(basis),evidenceRefs:[c]};
 x.attestations.coverage.provider={state:'complete_as_of',cutoff:at,coverageBasis:structuredClone(basis),evidenceRefs:['provider_activity']};
 attestAssembly(x);return x;
}
export function attestAssembly(x){
 const s=x.ownedSnapshot;
 x.attestations.snapshot={verified:true,scope:structuredClone(s.scope),revision:s.revision,stateDigest:s.stateDigest,payloadDigest:inventoryDigest({state:s.state,facts:s.facts}),source:'synthetic-owned-snapshot',schemaVersion:'1'};
 x.attestations.evidence=ownedInventoryCategories.map(c=>({id:c,origin:'owned',category:c,verified:true,schemaVersion:'1',source:'synthetic-owned-store',scope:structuredClone(s.scope),observedAt:s.assessedAt,revision:s.revision,payloadDigest:inventoryDigest(s.facts[c]),coverageBasis:structuredClone(x.attestations.coverage.owned[c].coverageBasis),cutoff:x.attestations.coverage.owned[c].cutoff}));
 const p=x.attestations.coverage.provider;
 x.attestations.evidence.push({id:'provider_activity',origin:'provider',category:'provider_activity',verified:true,authentication:'authenticated',schemaVersion:'1',source:'synthetic-normalized-adapter',scope:structuredClone(s.scope),observedAt:s.assessedAt,paymentRef:structuredClone(s.paymentRef),payloadDigest:inventoryDigest(x.providerEvidence.facts),coverageBasis:structuredClone(p.coverageBasis),cutoff:p.cutoff});
}

