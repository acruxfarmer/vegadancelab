import {isDeepStrictEqual} from 'node:util';
import {mediaOffer} from './media-commerce.mjs';

// Development-only commerce terms. Product pricing and entitlement balances are untouched.
export const PRODUCT_ID = '5dcc7d89-2398-4b29-ba6e-f4e549d4e4f1';
export const OFFER_ID = 'development-three-class-pack-usd60-v1';
const scope = a => a.tenantId === 'vega-development' && a.businessId === 'vega-dance-lab';
const offer = {
 id: OFFER_ID, version: 1, environment: 'development', tenantId: 'vega-development', businessId: 'vega-dance-lab',
 productId: PRODUCT_ID, productName: 'DEV TEST — Three-class pack', productType: 'class_pack',
 quantity: 3, validDays: 30, categories: ['Pack verification'], classIds: [],
 currency: 'USD', priceMinor: 6000, priceLabel: 'DEVELOPMENT TEST PRICE ONLY',
 tax: { treatment: 'non_taxable', jurisdiction: 'Oregon Development', amountMinor: 0, productionReconfirmationRequired: true },
 validityStart: 'confirmed_payment',
 refundPolicy: { approval: 'staff', kind: 'full_only', whollyUnused: true, noActiveReservations: true, requestWithinDays: 30, windowStartsAt: 'confirmed_payment_successful_purchase_completion' }
};
export function developmentOffer() { return structuredClone(offer); }
// Existing operator-provisioned Development member. No inferred email/delegate authority.
const self = { userId: 'e5946b40-9839-4a96-99d5-93262d9573f0', participantId: 'vega-member-test-joe' };
export function selfParticipant(state, a) {
 return scope(a) && a.role === 'member' && a.userId === self.userId &&
  a.participantIds?.length === 1 && a.participantIds[0] === self.participantId &&
  state.participants.filter(p => p.id === self.participantId).length === 1 ? self.participantId : null;
}
export function productMatches(state, terms=offer) {
 const products = (terms.productType==='digital_access'?state.commerceProducts||[]:state.entitlementProducts || []).filter(p => p.id === terms.productId);
 const p = products[0];
 return products.length === 1 && p.name === terms.productName && p.type === terms.productType && p.quantity === terms.quantity && p.validDays === terms.validDays &&
  isDeepStrictEqual(p.categories,terms.categories) && isDeepStrictEqual(p.classIds,terms.classIds);
}
export function commerceView(state, a) {
 const allowed = scope(a), participantId = selfParticipant(state, a);
 return {
  commerceOffers: allowed && productMatches(state) ? [developmentOffer()] : [],
  commerceSelfParticipantId: participantId,
  purchaseDrafts: structuredClone((state.purchaseDrafts || []).filter(d =>
   (allowed || d.saleChannel==='front_desk') &&
   d.tenantId === a.tenantId && d.businessId === a.businessId &&
   (a.role === 'staff' || (d.saleChannel==='front_desk' ? a.role==='member' && d.buyerId===a.userId && a.participantIds?.includes(d.participantId) : participantId && d.buyerId === a.userId && d.participantId === participantId)))).map(d=>{
    const p=(state.paymentAttempts||[]).find(p=>p.id===d.activeAttemptId&&p.purchaseId===d.id);
    return p?{...d,paymentSummary:{attemptId:p.id,status:p.status,paymentId:p.paymentId,integrationRef:p.integrationRef??null,transactionRef:p.transactionRef??null,reason:p.reason??null,paymentConfirmedAt:p.paymentConfirmedAt}}:d;
   })
 };
}
export function createPurchaseDraft(state, body, a, {id, now}, fail,mediaMaterial) {
 if(body.offerId!==OFFER_ID){
  const p=mediaMaterial?.placement,r=mediaMaterial?.resource;
  if(!p||!r||p.resourceId!==r.id||r.lifecycle!=='active'||r.owner.kind!=='business'||r.owner.tenantId!==a.tenantId||r.owner.businessId!==a.businessId||p.authorized!==true||p.visible!==true||p.policy?.kind!=='pay_on_demand')fail('Media offer unavailable',404);
  const offer=mediaOffer(state,p);if(!offer||offer.id!==body.offerId)fail('Active media offer unavailable',404);
  const {active,...terms}=offer;
  return createScopedPurchaseDraft(state,body,a,{id,now},fail,terms);
 }
 if (!scope(a)) fail('Development commerce unavailable', 403);
 const participantId = selfParticipant(state, a);
 if (!participantId) fail('Unambiguous Development self-purchase assignment required', 403);
 return createScopedPurchaseDraft(state,body,a,{id,now},fail,developmentOffer());
}
// Server-owned offer selection is supplied by the composition policy, never the HTTP body.
export function createScopedPurchaseDraft(state,body,a,{id,now},fail,terms){
 const participantId=a.role==='member'&&a.participantIds?.length===1?a.participantIds[0]:null;
 if(!participantId||state.participants.filter(p=>p.id===participantId).length!==1)fail('Unambiguous self-purchase assignment required',403);
 if(!terms||terms.tenantId!==a.tenantId||terms.businessId!==a.businessId)fail('Offer scope mismatch',403);
 if (Object.keys(body).some(k => !['requestId', 'offerId'].includes(k))) fail('Purchase terms and recipient are server-controlled', 400);
 return createOwnedPurchaseDraft(state,body,a,{id,now},fail,terms,{buyerId:a.userId,participantId});
}
// Internal composition helper: callers establish actor and customer authority first.
export function createOwnedPurchaseDraft(state,body,a,{id,now},fail,terms,{buyerId,participantId,saleChannel,customerId}){
 if (body.offerId !== terms.id) fail('Offer unavailable', 404);
 if (!productMatches(state,terms)) fail('Existing product terms must match the approved Development offer', 409);
 state.purchaseDrafts ||= [];
 const prior = state.purchaseDrafts.find(d => d.tenantId === a.tenantId && d.businessId === a.businessId && (d.createdByStaffId??d.buyerId) === a.userId && d.requestId === body.requestId);
 if (prior) { if (prior.offerId !== body.offerId || prior.buyerId!==buyerId || prior.participantId!==participantId || prior.saleChannel!==saleChannel || prior.customerId!==customerId) fail('Request identifier conflict', 409); return prior; }
 state.commerceOffers ||= [];
 const stored = state.commerceOffers.find(o => o.id === terms.id);
 // PostgreSQL jsonb may reorder object keys; all keys, values and array order remain immutable.
 if (stored && !isDeepStrictEqual(stored, terms)) fail('Immutable offer version conflict', 409);
 if (!stored) state.commerceOffers.push(structuredClone(terms));
 const draft = { id: id(), tenantId: a.tenantId, businessId: a.businessId, buyerId, participantId,
  ...(saleChannel?{saleChannel,customerId,createdByStaffId:a.userId}:{}),
  offerId: terms.id, offerVersion: terms.version, terms: structuredClone(terms), currency: terms.currency, subtotalMinor: terms.priceMinor,
  taxMinor: terms.tax.amountMinor, totalMinor: terms.priceMinor + terms.tax.amountMinor,
  status: 'draft', paymentStatus: 'not_started', fulfillmentStatus: 'not_issued',
  paymentConfirmedAt: null, validFrom: null, expiresAt: null, refundWindowStartsAt: null,
  createdAt: now(), requestId: body.requestId };
 state.purchaseDrafts.push(draft);
 state.activity.push({id: id(), action: 'purchase-draft', actorId: a.userId, tenantId: a.tenantId, businessId: a.businessId,
  subjectId: draft.id, offerId: terms.id, requestId: body.requestId, createdAt: draft.createdAt});
 return draft;
}
