# Layer 3 — Discovery → First Booking

Status: PRODUCT COMPLETE — hosted Development discovery-to-confirmed-booking journey verified.

## Journey and implementation

Public class → existing confirmed account and studio linkage → existing profile/current waiver → class review → explicit reservation or waitlist → booking confirmation → My bookings.

`src/first-booking.mjs` composes the existing customer-profile projection with the existing booking/refund transition. The deployed application store uses this composition for both current eligibility and confirmation inside its existing locked transaction. Missing profile or waiver blocks direct member requests; ambiguity remains Needs Staff Review. No new identity, booking, payment, credit or cancellation engine.

Missing credit routes to existing passes/offers. Profile/waiver and pass screens retain a return-to-selected-class action scoped to the selected business. The member schedule uses viewer-local times and generic studio wording. Existing staff bookings/promotion rules and cancellation remain authoritative.

## Robustness

19 targeted checks cover both Vega and Willow fixtures, successful first booking and one debit, staff/member projection agreement, duplicates, full class and explicit waitlist, missing/expired/restricted credits, profile and waiver requirements, reacceptance, booking after acceptance, cancelled occurrence, foreign business and participant, UI prerequisite routing, competing members for the final seat and request replay. Runtime concurrency test uses a locking database double; it is not a hosted database load test.

Full tracked regression: 1,059/1,059 pass. Targeted: 19/19 pass. Pre-existing unrelated untracked workspace files are excluded and preserved.

## Development deployment

- Application commit: 8b799ae233ecffcb6c5a88a25639f185aec304e6
- Render: https://vega-development-web.onrender.com — Live, 39.7 seconds, 2026-10-06 15:34 PDT.
- Vercel Preview: https://vega-development-fkn07u8bw-acruxfarmer.vercel.app — READY, same final application source commit, target null, existing protection preserved.
- No Production access or deployment.

## Bounded hosted fixture

The established confirmed Development member is participant 64a3edf5-ff0e-46b2-bdba-7e097eaaff8c. The public credit-required class is ced0dba0-316b-4168-a3f1-f16d6fa43819 (Practice & flow — preview). Existing product 5dcc7d89-2398-4b29-ba6e-f4e549d4e4f1 (DEV TEST — Three-class pack) supplied three synthetic credits through the existing staff issuance command. No payment, purchase draft or new product was created. Preparation verified unrelated records unchanged; revision 164 receipt a9891ba5288027e19a3512a8ae431c62fdb2a93c133e2b59c57f88f979ee3b54 acknowledged.

Baseline unrelated-field digest excludes only reservations, passes, creditUnits, creditEvents, entitlementIssuances and activity: Vega 86c37992c7f73e90797991a150f6a0e5 at revision 163; Willow 0f730041dded0c3754c77cc774bb06c3 at revision 0. After booking and an early-cancellation/rebooking verification, both digests remain identical. Vega revision 167 has 33 total reservations (one new cancelled history record and one new active booking); Willow remains revision 0 with one reservation.

The final verification script passed against the hosted runtime: active reservation 908c7601-5fb9-4811-99a9-4e63cf21c9c3, member/staff projections agree, capacity agrees, three issued credits, one debit for this booking and two currently available credits, duplicate rejected without changing revision, zero pending recovery records. All receipts for revisions 164–167 are acknowledged. Staff agreement was checked through the authenticated runtime projection, not a separate staff browser login.

## Hosted browser evidence

The public Practice & flow class retained its selection through the existing account sign-in and onboarding reuse. Joe performed the credential handoff; no new signup was required. Existing current profile and synthetic waiver were ready. Review showed 12 spaces, the matching existing pass, three eligible credits and explicit confirmation. Confirmation saved the booking.

Hosted verification exposed a response-handling defect: receipt acknowledgment alone omitted the reservation details. The browser now replays the same durable reservation request after acknowledgment to retrieve the authoritative response; no second booking or debit occurs. A regression reproduces this exact sequence. Member-facing booking progress uses plain language.

The existing early-cancellation flow restored the credit under its original terms. Rebooking after the correction visibly showed Joe Graham, Booking confirmed and 1 credit consumed from DEV TEST — Three-class pack. My bookings shows the active booking and retained cancellation history. Passes shows two available credits. Reopening the class shows 11 spaces and You already have a booking for this class with confirmation disabled. Anonymous public projection shows 11 spaces without member names. No payment or provider execution occurred.

## Deferred

Guest checkout, households/dependents, group booking, new commerce/payment behavior, communications automation, native apps and media. The prior public-entry dragon and Layer 2 remain closed.
