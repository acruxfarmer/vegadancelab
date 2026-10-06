# Layer 3 — Discovery → First Booking

Status: Hosted member sign-in handoff pending. Implementation and Development deployment verified; no booking confirmation claimed yet.

## Journey and implementation

Public class → existing confirmed account and studio linkage → existing profile/current waiver → class review → explicit reservation or waitlist → booking confirmation → My bookings.

`src/first-booking.mjs` composes the existing customer-profile projection with the existing booking/refund transition. The deployed application store uses this composition for both current eligibility and confirmation inside its existing locked transaction. Missing profile or waiver blocks direct member requests; ambiguity remains Needs Staff Review. No new identity, booking, payment, credit or cancellation engine.

Missing credit routes to existing passes/offers. Profile/waiver and pass screens retain a return-to-selected-class action scoped to the selected business. The member schedule uses viewer-local times and generic studio wording. Existing staff bookings/promotion rules and cancellation remain authoritative.

## Robustness

18 targeted checks cover both Vega and Willow fixtures, successful first booking and one debit, staff/member projection agreement, duplicates, full class and explicit waitlist, missing/expired/restricted credits, profile and waiver requirements, reacceptance, booking after acceptance, cancelled occurrence, foreign business and participant, UI prerequisite routing, competing members for the final seat and request replay. Runtime concurrency test uses a locking database double; it is not a hosted database load test.

Full tracked regression before the final UI assertion: 1,057/1,057 pass. The final targeted set has 18/18 pass. Pre-existing unrelated untracked workspace files are excluded and preserved.

## Development deployment

- Application commit: 0815ce37ff7a7fd73ae8b7b4cac22d3d5e493db6
- Render: https://vega-development-web.onrender.com — Live, 45 seconds, 2026-10-06 15:25 PDT.
- Vercel Preview: https://vega-development-6tlxhls45-acruxfarmer.vercel.app — READY, same source commit, target null, existing protection preserved.
- No Production access or deployment.

## Bounded hosted fixture

The established confirmed Development member is participant 64a3edf5-ff0e-46b2-bdba-7e097eaaff8c. The public credit-required class is ced0dba0-316b-4168-a3f1-f16d6fa43819 (Practice & flow — preview). Existing product 5dcc7d89-2398-4b29-ba6e-f4e549d4e4f1 (DEV TEST — Three-class pack) supplied three synthetic credits through the existing staff issuance command. No payment, purchase draft or new product was created. Preparation verified unrelated records unchanged; revision 164 receipt a9891ba5288027e19a3512a8ae431c62fdb2a93c133e2b59c57f88f979ee3b54 acknowledged.

Baseline unrelated-field digest excludes only reservations, passes, creditUnits, creditEvents, entitlementIssuances and activity: Vega 86c37992c7f73e90797991a150f6a0e5 at revision 163; Willow 0f730041dded0c3754c77cc774bb06c3 at revision 0. Compare after booking. Existing total reservations: Vega 31; Willow 1.

The final verification script checks current member/staff projections, one reservation, one consumption event, two remaining credits, authoritative capacity, duplicate rejection without mutation and recovery pending count. Run after the browser confirmation: `node scripts/verify-first-booking-development.mjs`.

## Deferred

Guest checkout, households/dependents, group booking, new commerce/payment behavior, communications automation, native apps and media. The prior public-entry dragon and Layer 2 remain closed.
