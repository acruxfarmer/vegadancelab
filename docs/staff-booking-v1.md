# Section 4.1 — Staff Booking & Adjustments

Baseline comparison: workspace `vega/docs/staff-booking-acceptance-review.md`. Existing hosted cancellation/entitlement evidence remains authoritative for correction, exact-unit restoration/reversal, spent-restoration blocks, issuance, audit, command replay and role isolation.

The People workspace now supports member search, a selected-member account with upcoming/recent bookings and eligible-period credit balances, booking with disclosed pass/capacity/eligibility, explicit early/late cancellation with reason, and existing scoped correction/manual issuance forms and audit. Product-backed provisioning remains available in a separate collapsed section. No new ledger, cancellation or entitlement implementation was introduced.

Staff booking explanations reuse memberBookingOption and eligibleCredits. The new reservationOnly flag narrows the existing reserve command so a full class cannot silently become a waitlist entry during confirmation. Existing staff waitlist behavior without that flag is unchanged and outside this slice. Shared member account summary supplies counts; staff data remains role-gated.

## Local evidence

- 80 tests pass, including new checks for disclosed-pass agreement, stale entitlement rejection, reservation-only capacity race, explicit staff classification actor/reason/original history, member classification denial and summary isolation.
- Browser searched and opened Local Support Member; full and wrong-category classes disabled confirmation with understandable reasons. Eligible booking disclosed Support dance pack and consumed one unit. Duplicate booking was disabled after refresh.
- Staff explicitly chose late and supplied a reason. Result retained the debit; existing late-to-early correction restored once. Account and audit displayed original late classification plus staff cancellation/correction reasons and actor.
- Double-clicked booking and manual courtesy issuance produced one each. Fixture metrics showed four total POST attempts: reserve, cancel, correction, issue; one booking and one restoration. Reload/reopening the member preserved four available credits (three pack including one restoration, one courtesy).
- Browser console error log was empty. Fixture used loopback-only synthetic identity and real application transitions; hosted completion remains pending.
- Separate member browser fixture showed zero staff booking, issuance or correction controls and no People navigation; direct navigation to the staff People route returned the member account. Final presentation/reload check retained the balance and correction policy without duplicated credit totals.

Production, Square disabled, worker, unrelated services and temporary health instrumentation unchanged.
