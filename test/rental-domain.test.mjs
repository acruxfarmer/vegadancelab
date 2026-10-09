import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRentalPolicy,createRentalTerms} from '../src/rental-policy.mjs';
import {rentalStatus,grantComplimentaryRental,correctRentalEntitlement} from '../src/rental-entitlement.mjs';
import {hasDurableAccess,durableFulfillmentComplete} from '../src/fulfillment.mjs';
import {configureMediaRentalOffer,mediaAccessTarget,mediaOffer} from '../src/media-commerce.mjs';
import {createPurchaseDraft} from '../src/commerce.mjs';
import {assertQuotePayable} from '../src/payments.mjs';
import {fixture} from './helpers/fulfillment-fixture.mjs';
import {transition,visibleState} from '../src/application.mjs';
import {assessRefundEligibility} from '../src/refund-eligibility.mjs';
const at='2026-10-09T00:00:00.000Z',fail=m=>{throw Error(m);};let serial=0;const clock={id:()=>`rental-test-${++serial}`,now:()=>at};
function setup(){const h=fixture(),placement={id:'rental-placement',resourceId:'rental-resource',revision:1,context:{kind:'business',tenantId:h.a.tenantId,businessId:h.a.businessId},authorized:true,visible:true,policy:{kind:'pay_on_demand'}},resource={id:placement.resourceId,owner:{...placement.context},lifecycle:'active'};
 const o={...structuredClone(h.state.purchaseDrafts[0].terms),productType:'digital_access',fulfillmentPlan:{version:1,actions:[{id:'media-access',type:'DURABLE_ACCESS',target:mediaAccessTarget(placement)}]}};
 h.state.commerceOffers=[o];h.state.commerceOfferAvailability=[{offerId:o.id,offerVersion:o.version,...h.a,active:true}];h.state.mediaCommerceLinks=[{placementId:placement.id,offerId:o.id,offerVersion:o.version,...h.a}];return {...h,placement,resource};}
test('policy rejects unknown/version/unsafe duration values and freezes normalized defaults',()=>{
 assert.equal(normalizeRentalPolicy({}).startupRecoveryMinutes,10);
 for(const input of [{unknown:true},{version:3},{activationDays:0},{viewingHours:1.5},{graceCapHours:25},{startupRecoveryMinutes:11},{releaseAt:'bad'},{replayAllowed:'yes'}])assert.throws(()=>normalizeRentalPolicy(input));
});
test('actual late availability controls full allowance and clock boundaries',()=>{
 const policy=normalizeRentalPolicy({releaseAt:'2026-10-10T00:00:00Z',activationDays:2});
 const e={state:'active',rental:createRentalTerms(policy,{grantedAt:at})};assert.equal(rentalStatus(e,at),'scheduled');
 e.rental=createRentalTerms(policy,{grantedAt:at,availableAt:'2026-10-15T00:00:00Z'});assert.equal(e.rental.startBy,'2026-10-17T00:00:00.000Z');assert.equal(rentalStatus(e,'2026-10-16'),'ready_to_start');assert.equal(rentalStatus(e,'2026-10-17'),'expired');
 e.rental.activation={confirmedAt:'2026-10-16T23:00:00Z'};e.rental.expiresAt='2026-10-18T23:00:00Z';assert.equal(rentalStatus(e,'2026-10-18'),'active');assert.equal(rentalStatus(e,'2026-10-18T23:00:00Z'),'expired');
});
test('expired or staff-revoked paid rental remains historically fulfilled; provenance corruption does not',()=>{
 const h=setup(),p=h.state.purchaseDrafts[0];p.terms.rentalPolicy=normalizeRentalPolicy({});p.terms.fulfillmentPlan.actions[0].target=mediaAccessTarget(h.placement);h.sync();h.fulfill();
 const e=h.state.accessEntitlements[0];e.rental=createRentalTerms(p.terms.rentalPolicy,{grantedAt:at,availableAt:at});
 assert.equal(hasDurableAccess(h.state,{principalId:e.principalId,tenantId:e.tenantId,businessId:e.businessId,target:e.target,at:'2027-01-01'}),false);assert.equal(durableFulfillmentComplete(h.state,h.state.purchaseDrafts[0]),true);
 e.state='revoked';assert.equal(durableFulfillmentComplete(h.state,h.state.purchaseDrafts[0]),true);e.purchaseId='wrong';assert.equal(durableFulfillmentComplete(h.state,h.state.purchaseDrafts[0]),false);
});
test('complimentary grants need no purchase and audited correction preserves snapshot and revokes sessions',()=>{
 const h=setup(),body={requestId:'grant',principalId:h.a.userId,target:mediaAccessTarget(h.placement),reason:'Customer assistance',rentalPolicy:{},availableAt:at};
 const before=structuredClone(h.state.purchaseDrafts),e=grantComplimentaryRental(h.state,body,h.staff,clock,fail);assert.equal(grantComplimentaryRental(h.state,body,h.staff,clock,fail).id,e.id);assert.deepEqual(h.state.purchaseDrafts,before);
 assert.equal(hasDurableAccess(h.state,{principalId:e.principalId,tenantId:e.tenantId,businessId:e.businessId,target:e.target,at}),true);
 h.state.rentalPlaybackSessions=[{id:'s',entitlementId:e.id,state:'active'}];correctRentalEntitlement(h.state,{entitlementId:e.id,expectedRevision:1,requestId:'extend',action:'extend',hours:24,reason:'Compensation'},h.staff,clock,fail);assert.equal(e.revision,2);assert.equal(e.corrections.length,1);assert.throws(()=>correctRentalEntitlement(h.state,{entitlementId:e.id,expectedRevision:1,requestId:'stale',action:'reset',reason:'Retry'},h.staff,clock,fail));
 const replacement=correctRentalEntitlement(h.state,{entitlementId:e.id,expectedRevision:2,requestId:'replace',action:'replace',reason:'Replacement'},h.staff,clock,fail);assert.equal(e.state,'revoked');assert.equal(replacement.provenance.relatedEntitlementId,e.id);assert.equal(h.state.rentalPlaybackSessions[0].state,'revoked');assert.deepEqual(h.state.purchaseDrafts,before);
});
test('owner policy revisions preserve purchased and unfinished quote terms and sale withdrawal is separate',()=>{
 const h=setup(),body={requestId:'offer1',placementId:h.placement.id,expectedRevision:1,expectedOfferVersion:1,title:'Rental',priceMinor:1200,currency:'USD',rentalPolicy:{viewingHours:48}};
 configureMediaRentalOffer(h.state,body,h.staff,h,clock,fail);const o=mediaOffer(h.state,h.placement);const d=createPurchaseDraft(h.state,{requestId:'quote',offerId:o.id},h.a,clock,fail,h);d.quoteExpiresAt='2026-10-10T00:00:00Z';const frozen=structuredClone(d.terms);
 assert.throws(()=>configureMediaRentalOffer(h.state,{...body,requestId:'stale'},h.staff,h,clock,fail),/Offer changed/);
 configureMediaRentalOffer(h.state,{...body,expectedOfferVersion:2,requestId:'offer2',priceMinor:2400,rentalPolicy:{viewingHours:24}},h.staff,h,clock,fail);assert.deepEqual(d.terms,frozen);assert.equal(mediaOffer(h.state,h.placement).rentalPolicy.viewingHours,24);assertQuotePayable(h.state,d,at,fail);
 h.state.mediaAvailability=[{placementId:h.placement.id,tenantId:h.a.tenantId,businessId:h.a.businessId,status:'unpublished'}];assert.equal(mediaOffer(h.state,h.placement),null);assertQuotePayable(h.state,d,at,fail);assert.throws(()=>assertQuotePayable(h.state,d,'2026-10-10T00:00:00Z',fail),/expired/);
 h.state.mediaAvailability[0].status='withdrawn';assert.throws(()=>assertQuotePayable(h.state,d,at,fail),/withdrawn/);
 h.state.mediaAvailability[0].status='suspended';assert.throws(()=>assertQuotePayable(h.state,d,at,fail),/temporarily/);
 const latest=h.state.mediaCommerceLinks[0].offerId;
 for(const status of ['unpublished','suspended','withdrawn']){h.state.mediaAvailability[0].status=status;assert.throws(()=>createPurchaseDraft(h.state,{requestId:`blocked-${status}`,offerId:latest},h.a,clock,fail,h),/unavailable/);}
});
test('application corrections reject forged policy, unverified recipients and wrong placement',()=>{
 const h=setup();h.state.commerceOffers[0].rentalPolicy=normalizeRentalPolicy({});
 const body={requestId:'complimentary',placementId:h.placement.id,expectedRevision:1,principalId:h.a.userId,reason:'Assistance',action:'complimentary'},run=(body,material=h)=>transition(h.state,{action:'rental-correct',body},h.staff,{...clock,mediaCommerceMaterial:material});
 assert.throws(()=>run(body),/Verified business recipient/);assert.throws(()=>run({...body,rentalPolicy:{}},{...h,recipientVerified:true}),/Unsupported/);
 const granted=run(body,{...h,recipientVerified:true,binding:{state:'ready',readyAt:'2026-10-08T00:00:00Z'}});assert.equal(granted.state.accessEntitlements.length,1);assert.equal(h.state.accessEntitlements,undefined);
 const e=granted.state.accessEntitlements[0];assert.equal(e.rental.policy.viewingHours,48);assert.equal(e.rental.availableAt,at);assert.equal(e.rental.startBy,'2026-11-08T00:00:00.000Z');
 assert.throws(()=>transition(granted.state,{action:'rental-correct',body:{requestId:'bad',placementId:'wrong',entitlementId:e.id,expectedRevision:1,action:'revoke',reason:'Denied'}},h.staff,{...clock,mediaCommerceMaterial:h}),/Business-owned/);
 granted.state.rentalPlaybackTickets=[{entitlementId:e.id,state:'issued',token:'secret'}];
 const revoked=transition(granted.state,{action:'rental-correct',body:{requestId:'revoke',placementId:h.placement.id,entitlementId:e.id,expectedRevision:1,action:'revoke',reason:'Requested'}},h.staff,{...clock,mediaCommerceMaterial:h});assert.equal(revoked.state.rentalPlaybackTickets[0].state,'revocation_pending');
 const view=visibleState(revoked.state,h.a,at);assert.equal(view.rentals.length,1);assert.equal(view.rentals[0].status,'revoked');assert.doesNotMatch(JSON.stringify(view.rentals),/secret|actorId|reason/);assert.equal(visibleState(revoked.state,{...h.a,userId:'other'},at).rentals.length,0);
});
test('expired unused rental remains fulfilled, while played or staff-reset usage preserves wholly-unused refund policy',()=>{
 const h=setup(),p=h.state.purchaseDrafts[0];p.terms.rentalPolicy=normalizeRentalPolicy({});p.terms.fulfillmentPlan.actions[0].target=mediaAccessTarget(h.placement);h.sync();h.fulfill();
 const e=h.state.accessEntitlements[0];e.rental.startBy='2026-10-06T00:00:00Z';e.rental.availableAt='2026-10-05T00:00:00Z';
 const assess=()=>assessRefundEligibility({state:h.state,authority:h.staff,purchaseId:p.id,at,refundRecords:[]});assert.equal(assess().status,'eligible');
 e.rental.activation={confirmedAt:'2026-10-05T23:00:00Z'};assert.deepEqual(assess().reasonCodes,['ENTITLEMENT_CONSUMED']);
 correctRentalEntitlement(h.state,{entitlementId:e.id,expectedRevision:1,requestId:'reset',action:'reset',reason:'Fix startup'},h.staff,clock,fail);assert.deepEqual(assess().reasonCodes,['ENTITLEMENT_CONSUMED']);
});

test('retired grace fields remain historical data only; new policies omit them',()=>{
 const old={version:1,activationDays:30,viewingHours:48,replayAllowed:true,releaseAt:null,startupRecoveryMinutes:10,graceBufferMinutes:10,graceCapHours:4};
 assert.deepEqual(createRentalTerms(old,{grantedAt:at}).policy,old);
 assert.throws(()=>normalizeRentalPolicy(old));assert.equal(normalizeRentalPolicy({}).version,2);
 assert.equal('graceCapHours' in normalizeRentalPolicy({}),false);
});
