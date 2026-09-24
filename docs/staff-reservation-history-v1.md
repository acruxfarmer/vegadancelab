# 6.9 — Staff Reservation History V1

Status: implemented and locally verified, 2026-09-23. Stopped at the Development operator boundary; no hosted deployment or hosted verification performed for this slice.

## Implementation

An authorized staff roster row opens a read-only timeline anchored to its reservation ID, with participant and occurrence identities visible. Current booking/attendance values are separate from historical snapshots. The versioned projection covers creation, waitlist promotion, cancellation, cancellation correction and attendance changes using existing authorized aggregate evidence. It adds no endpoint, schema, permission, ledger or aggregate payload fields.

Explicit evidence identities and links determine merging. Stable event IDs and recorded-time ordering survive refresh; ties use event identity and missing timestamps sort last. Missing details remain `unrecorded`. Conflicting values are exposed without choosing a historical value. Supporting records without a proven relationship appear separately as ambiguous/unlinked evidence and are not counted as additional actions. Blocked/unchanged corrections retain their outcome and requested classification without presenting them as applied changes.

History selection uses reservation/participant identity, never names. Filter exclusion, occurrence/page/authority changes or removal clear obsolete context. A delayed read cannot replace a newer selection. Full reload clears in-memory selection; reopening yields stable event IDs/order. Members receive no staff history UI through this projection.

## Local verification

- 141 regression tests passed, including eight reservation-history projection tests; frontdoor build passed.
- 30 disposable local PostgreSQL checks passed, including persisted event mapping, stable repeated reads, local staff/member/business isolation and unchanged complete state/revision/receipts.
- 33 browser verification groups passed: reservation history 5, roster navigation 5, schedule navigation 4, occurrence editing 8, duplication 7 and occurrence history 4.
- New browser checks cover distinct people with identical names, delayed reads, context clearing, legacy gaps, escaped content, unapplied outcomes, member exclusion, keyboard use and desktop/mobile rendering. Complete fixture state/revision remained unchanged and navigation sent zero mutation requests.
- Desktop 1440×1050 and mobile 390×844 evidence is in `docs/reservation-history-local/`; the machine-readable report is `verification.json`.
- `git diff --check` passed (existing Windows line-ending notices only).

## Architectural finding and retained limits

Some canonical activity records lack explicit action/request links. The projection deliberately leaves those relationships unrecorded; improving future evidence linkage would require a separately authorized change. No inference by participant name, timestamp proximity or current state, and no backfill or audit rewrite, was introduced.

Local synthetic/disposable coverage is not hosted evidence. Retain hosted limitations for distinct-person duplicate names, positive active-status cases, nonempty waitlists and delayed mutation responses, plus existing cross-business isolation and DST limitations. No hosted fixtures or wider permissions were introduced. R-01 remains deferred.

## Operator boundary

Await separate Development deployment authorization. After deployment/readiness, verify authenticated read-only staff/member behavior using retained evidence, compare database fingerprints and preserve coverage gaps explicitly. No deployment command or readiness claim is made here.

Production, worker, Square and unrelated services were not changed. Square remains disabled. No booking/credit mutation, notification, reconciliation, backfill, permission change, payload redesign or resilience work was added.
