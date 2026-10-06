import {developmentOffer,productMatches,createOwnedPurchaseDraft} from './commerce.mjs';

// Existing approved Development account/participant binding. This configuration
// is not an identity directory and grants no login or profile-control authority.
export function developmentFrontDeskPolicy(){
 const offer=developmentOffer();
 return {tenantId:offer.tenantId,businessId:offer.businessId,offers:[offer],customers:[{
  id:'development-member-joe',buyerId:'e5946b40-9839-4a96-99d5-93262d9573f0',participantId:'vega-member-test-joe'
 }]};
}
function scoped(a,p){return a.role==='staff'&&a.tenantId===p.tenantId&&a.businessId===p.businessId;}
function customers(state,p){return p.customers.filter(c=>c.buyerId&&c.participantId&&p.customers.filter(x=>x.id===c.id).length===1&&state.participants.filter(x=>x.id===c.participantId).length===1);}
function offers(state,p){return p.offers.filter(o=>o.tenantId===p.tenantId&&o.businessId===p.businessId&&o.productType==='class_pack'&&productMatches(state,o));}
export function frontDeskView(state,a,policy=developmentFrontDeskPolicy()){
 if(!scoped(a,policy))return {};
 return {frontDesk:{customers:customers(state,policy).map(c=>({...c,name:state.participants.find(x=>x.id===c.participantId).name||c.participantId})),offers:structuredClone(offers(state,policy))}};
}
export function createFrontDeskSale(state,body,a,clock,fail,policy=developmentFrontDeskPolicy()){
 if(!scoped(a,policy))fail('Front-desk staff access required',403);
 if(Object.keys(body).some(k=>!['requestId','customerId','offerId','offerVersion'].includes(k)))fail('Sale terms and identity are server-controlled',400);
 if(typeof body.requestId!=='string'||!body.requestId.trim()||body.requestId.length>128)fail('A request identifier is required',400);
 const customer=customers(state,policy).find(c=>c.id===body.customerId);
 if(!customer)fail('Eligible existing customer unavailable',403);
 const terms=offers(state,policy).find(o=>o.id===body.offerId&&o.version===body.offerVersion);
 if(!terms)fail('Offer changed or unavailable. Review current terms.',409);
 return createOwnedPurchaseDraft(state,body,a,clock,fail,terms,{...customer,customerId:customer.id,saleChannel:'front_desk'});
}
