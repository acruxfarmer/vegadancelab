# 6.12 — Occurrence Cancellation Notification V1

**Implemented / Locally Verified. Stopped at the Development operator boundary.** No hosted deployment or mutation fixture executed.

## Implementation

`src/cancellation-notice.mjs` creates one version-1 published `occurrence-cancellation` notice inside the existing canonical cancellation apply operation for each reserved/waitlisted reservation actually transitioned. It uses the recorded participant-specific credit outcome and links notice, occurrence, reservation, participant and occurrence-cancellation event. The event's affected entry records noticeId, and the committed command result includes noticeIds for exact replay.

Class snapshot includes title, start, duration, instructor, location and category, with missing values recorded as null and displayed as unrecorded. Reservation snapshot records from/to. Credit snapshot preserves the canonical outcome and quantity actually restored; a restoration links the existing restored unit, credit event and pass. Missing restoration evidence rejects the operation. Staff reason/administrative notes are not included. No credit rules changed.

All notices persist in the existing locked aggregate/command-receipt transaction. Any notice or receipt failure rolls back cancellation, reservations, credits, history and revision. Preview runs on an isolated clone with synthetic IDs and writes nothing. Existing impact token and authority recheck remain. Same request replays the original outcome/notice identities. Already-cancelled no-ops and historical cancellations receive no backfill; prior cancelled reservations are untouched.

Member home and the staff selected occurrence show a separate cancellation-notice section. Booked place cancellation/credit restoration and waitlist closure/no-credit effects are different historical content. Current state is separate. Promotion notices and promotionNoticeId remain unchanged. Delivery remains disabled, and in-app availability implies neither delivery nor read/acknowledgement. Existing participant/delegated authority applies without new grants/schema or endpoints.

## Verification

- Full regression: **149/149 Node tests passed**. New focused tests cover paid/free mixed affected rows, prior-cancelled exclusion, empty occurrence, no-backfill, preview purity, rejection/stale impact, failure during construction of the second notice, recipient/delegated isolation, drafts, escaping, immutable snapshot and promotion preservation.
- Disposable loopback **PostgreSQL 18.4: 30 checks passed**. Extended cancellation check rejects multi-notice aggregate persistence and receipt insert, proving unchanged complete state/revision and complete receipts. Concurrent same-request cancellation commits once with two distinct notices, one restoration, one added receipt/revision; later exact replay preserves all state/receipts. Each member reads only their own notice; reads are nonmutating. Existing business RLS, stale impact/competing promotion/booking, attendance boundary and authority regressions remain green.
- Browser verification used `cua_repl` against `scripts/serve-cancellation-notice-fixture.mjs`, a synthetic loopback real API/domain/projection fixture. Staff review: one booked + one waiting, one restoration, two notices. Confirmation creates exactly two cancellation notices and retains the original promotion notice. Prior-cancelled row is unchanged. Member sees only their own cancellation and promotion notices, with no internal reason. Reload preserves exact notice text/IDs. Error/warning log empty.
- Staff and member mobile measured **390×844**, expanded stable identities wrap without document horizontal overflow; screenshots visually inspected in tool transcript. Member desktop **1440×1050** inspected with both independent notice types. Viewport override reset. These are local observations and do not supersede prior hosted-mobile limitations.
- Captured browser fixture state was independently compared by `scripts/verify-cancellation-notice-evidence.mjs`: revision 10→11, two notices, one existing canonical restoration, original promotion and prior-cancelled rows unchanged. Evidence: `docs/cancellation-notice-local/{before,after,last-command,verification}.json`.
- Allowlisted front-door build, new asset HTTP regression and `git diff --check` passed.

## Operator boundary

No push/deployment, hosted mutation, provider configuration or worker change performed. Development deployment requires separate authorization and a pinned candidate handoff. Positive hosted verification needs a separately approved fixture; retained historical cancellations cannot prove creation without forbidden backfill. Do not mutate closed 6.11 evidence for this purpose. Hosted final verification/closure remain pending.

R-01, deferred 6.10 and all existing coverage limitations remain. Outbound SMS/email is an explicit future requirement and must use independent delivery outcomes anchored to durable notices; failure cannot reverse cancellation/promotion. Production, worker, Square and unrelated services unchanged; Square disabled.
