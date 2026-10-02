import {isDeepStrictEqual} from 'node:util';

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
function productMatches(state) {
 const products = (state.entitlementProducts || []).filter(p => p.id === PRODUCT_ID);
 const p = products[0];
 return products.length === 1 && p.name === offer.productName && p.type === 'class_pack' && p.quantity === 3 && p.validDays === 30 &&
  JSON.stringify(p.categories) === JSON.stringify(offer.categories) && JSON.stringify(p.classIds) === '[]';
}
export function commerceView(state, a) {
 const allowed = scope(a), participantId = selfParticipant(state, a);
 return {
  commerceOffers: allowed && productMatches(state) ? [developmentOffer()] : [],
  commerceSelfParticipantId: participantId,
  purchaseDrafts: allowed ? structuredClone((state.purchaseDrafts || []).filter(d =>
   d.tenantId === a.tenantId && d.businessId === a.businessId &&
   (a.role === 'staff' || (participantId && d.buyerId === a.userId && d.participantId === participantId)))).map(d=>{
    const p=(state.paymentAttempts||[]).find(p=>p.id===d.activeAttemptId&&p.purchaseId===d.id);
    return p?{...d,paymentSummary:{attemptId:p.id,status:p.status,paymentId:p.paymentId,reason:p.reason??null,paymentConfirmedAt:p.paymentConfirmedAt}}:d;
   }) : []
 };
}
export function createPurchaseDraft(state, body, a, {id, now}, fail) {
 if (!scope(a)) fail('Development commerce unavailable', 403);
 const participantId = selfParticipant(state, a);
 if (!participantId) fail('Unambiguous Development self-purchase assignment required', 403);
 if (Object.keys(body).some(k => !['requestId', 'offerId'].includes(k))) fail('Purchase terms and recipient are server-controlled', 400);
 if (body.offerId !== OFFER_ID) fail('Offer unavailable', 404);
 if (!productMatches(state)) fail('Existing product terms must match the approved Development offer', 409);
 state.purchaseDrafts ||= [];
 const prior = state.purchaseDrafts.find(d => d.tenantId === a.tenantId && d.businessId === a.businessId && d.buyerId === a.userId && d.requestId === body.requestId);
 if (prior) { if (prior.offerId !== body.offerId) fail('Request identifier conflict', 409); return prior; }
 state.commerceOffers ||= [];
 const stored = state.commerceOffers.find(o => o.id === OFFER_ID);
 // PostgreSQL jsonb may reorder object keys; all keys, values and array order remain immutable.
 if (stored && !isDeepStrictEqual(stored, offer)) fail('Immutable offer version conflict', 409);
 if (!stored) state.commerceOffers.push(developmentOffer());
 const draft = { id: id(), tenantId: a.tenantId, businessId: a.businessId, buyerId: a.userId, participantId,
  offerId: OFFER_ID, offerVersion: 1, terms: developmentOffer(), currency: 'USD', subtotalMinor: offer.priceMinor,
  taxMinor: offer.tax.amountMinor, totalMinor: offer.priceMinor + offer.tax.amountMinor,
  status: 'draft', paymentStatus: 'not_started', fulfillmentStatus: 'not_issued',
  paymentConfirmedAt: null, validFrom: null, expiresAt: null, refundWindowStartsAt: null,
  createdAt: now(), requestId: body.requestId };
 state.purchaseDrafts.push(draft);
 state.activity.push({id: id(), action: 'purchase-draft', actorId: a.userId, tenantId: a.tenantId, businessId: a.businessId,
  subjectId: draft.id, offerId: OFFER_ID, requestId: body.requestId, createdAt: draft.createdAt});
 return draft;
}
