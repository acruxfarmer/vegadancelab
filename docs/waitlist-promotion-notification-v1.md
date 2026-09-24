# 6.11 — Waitlist Promotion Notification V1: Automatic In-App Notice

Implemented and locally verified. Stopped at the Development operator boundary; no deployment, hosted fixture creation or hosted verification in this phase.

## Implementation and contract

Each newly committed waitlisted-to-reserved promotion records one published `waitlist-promotion` notification, version 1, in the existing business aggregate. It carries a stable notice ID, promotion event ID, reservation ID, participant ID, occurrence ID and the promotion's recorded timestamp. The class snapshot records title, start, duration, instructor, location and category. The credit snapshot records consumption/quantity and existing pass/event lineage, or no credit required. No current class values are substituted into the historical notice.

The reservation links `promotionNoticeId`; `notificationStatus: in_app_available` means only that the notice exists in Vega. Notification `status: published` governs account availability, while `deliveryStatus: disabled` retains the existing external-delivery boundary. No read, acknowledgement, email, SMS or push claim is made. Existing staff-created drafts remain drafts.

The existing locked aggregate update and command receipt transaction includes the notice, promotion, credit consumption and audit evidence. Failure before durable commit rolls back all of them. Same-request replay returns the durable original result; a new request against an already-promoted reservation retains the existing no-op behavior without another notice. Older promotions are not backfilled.

Member account home shows authorized participant notices; staff sees notices for the selected occurrence and confirmation explains in-app availability. Existing participant/account authorization, including delegated participants, governs access. Current booking/occurrence state is displayed separately; later cancellation does not rewrite notice content. No new endpoint, schema, grant, worker, provider or dispatch mechanism.

## Verification

- Full Node regression: 145 tests passed, including four new focused tests for paid/free notice creation, stable links, no-op/no-backfill, rejection/creation failure, participant/delegated isolation, draft exclusion, immutable snapshots and escaped read-only presentation.
- Disposable PostgreSQL 18.4: 30 checks passed. Existing waitlist transaction check extended with a trigger rejecting notice-bearing aggregate persistence: complete state/revision and receipts remain identical after failure. Receipt failure likewise rolls back. Competing promotions yield one winner/one debit/one notice; concurrent same-request replays return the same notice identity with no revision change. Member recipient and nonrecipient database reads tested.
- New real API/domain local browser journey: four groups passed. Review creates no notice; staff confirmation creates one; member home and reload show the exact notice; subsequent cancellation retains the notice and updates separate current state. Escaping, desktop 1440×1050 and mobile 390×844 with expanded identity details verified; no document horizontal overflow or browser errors.
- Existing reservation-history browser regression: five groups passed, including isolation and stale-context behavior. Frontdoor build and diff checks passed. Static HTTP regression includes the new public asset.
- Browser evidence: `docs/promotion-notice-local/verification.json`, `desktop-notice.png`, `mobile-notice.png`; screenshots visually inspected.

## Boundary and remaining verification

Await separate Development deployment authorization. Positive hosted automatic creation needs a newly committed promotion, not an old retained notice or backfill. Review the minimum hosted mutation fixture separately before any such test; retained read-only fixtures alone cannot prove automatic creation. Preserve existing coverage limitations, including 6.9 hosted staff-mobile targeting, distinct-person duplicate names, active-status/nonempty-waitlist cases, delayed mutation responses, cross-business hosted negative-role and DST cases.

Outbound email/SMS remains explicitly deferred. Any future delivery layer must reference the durable notification ID and have independent delivery outcomes/retries; its failure must never reverse the committed promotion. No future dispatcher is implemented here. R-01 remains deferred; 6.10 remains Deferred — Approved Future Enhancement.

Production, worker, Square and unrelated services unchanged; Square disabled. Prior canonical hosted reports unchanged.
