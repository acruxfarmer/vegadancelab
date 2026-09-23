# 6.5 — Create One Occurrence from Existing

Implementation approved by Joe on 2026-09-23. Implemented locally; local verification passed. Stopped at the hosted deployment/operator boundary. Hosted verification and closure approval remain pending.

## Delivered behavior

Staff selects one upcoming open occurrence, supplies a different future start, reviews every proposed creation field with an explicit timezone, and confirms one independent new occurrence. The source may have reservation, waitlist or attendance history: it is read-only and all of that history remains with the source. The new occurrence receives a new ID and no participation history.

At confirmation, the source is read again under the existing studio-state transaction lock. A current allowlisted snapshot comes from the canonical `classDetails` contract, combined with the explicitly reviewed staff values, then passes the same validator used by normal creation. `createClass` is the common construction/activity path for normal creation and this operation. No alternative duplication validator/default system exists. The additional future-source/new-start requirements define this operation's approved scope.

The committed snapshot is independent. Later source or new-occurrence edits never propagate. `creationProvenance` stores source/new IDs, source version, actor/role, request, event, timestamp, source creation fields and confirmed new fields as historical audit metadata only. It does not influence eligibility, bookings, edits, credits or any synchronization. Staff can inspect it after refresh; member projections omit it.

## Validation and concurrency

- Read-only authenticated review: `POST /api/classes/duplicate/review`.
- Confirmation: `POST /api/classes/duplicate`, through the existing command transaction and durable receipt.
- Review binds source version, source fields, proposed fields, actor, tenant and business. Changed proposal/source/authority requires a new review; confirmation rechecks source status, time and creation validation.
- Source recheck, new occurrence, attributable activity/provenance and receipt commit atomically under `app_state FOR UPDATE`; existing post-wait authority recheck applies.
- Receipt failure rolls back everything. Same-request concurrent replay or retry after a lost response returns the original new identity. Conflicting reuse rejects. A replay still returns its original result after the source changes.
- Duplication skips booking-account initialization, preserving all credits and unrelated state. No bookings, history, identity, counts or arbitrary source metadata can enter copied creation fields.

## Local evidence — 2026-09-23

- 117/117 Node regression tests passed, including shared creation validation/normalization parity, independent subsequent edits, audit/privacy, authentication, source eligibility/staleness and confirmation-time date boundary checks.
- 23/23 isolated PostgreSQL 18.4 checks passed. New cases cover read-only review; member/business isolation; rollback; overlapping same-request confirmations; persistent source immutability and provenance; staff/member projection agreement; committed source mutation ahead of a queued confirmation; and authority downgrade during a lock wait.
- 7/7 new browser flows passed against loopback synthetic authentication with the real API/domain/projections: history-bearing source, explicit start, invalid duration, nonmutating complete review, back navigation, lost-response retry, staff audit reload, staff/member refresh agreement, two-tab stale source rejection, and mobile confirmation. No captured application errors.
- 8/8 existing 6.4 browser checks also passed, including stale editing, blocked cancelled history, staff/member agreement and mobile review/confirmation. Final desktop/mobile duplication screenshots were visually inspected; review actions are separated and no horizontal overflow was detected.
- Front-door build and `git diff --check` passed.
- Browser machine-readable evidence and screenshots: [verification.json](class-duplication-local/verification.json), [desktop review](class-duplication-local/desktop-review.png), [mobile review](class-duplication-local/mobile-review.png), [member refresh](class-duplication-local/member-refreshed.png).

Reproduce with `node --test test/*.test.mjs`, `node scripts/verify-hardening-postgres.mjs` using the existing local-only `PG_TEST_BIN`, `node scripts/verify-class-duplication-browser.mjs`, and `node scripts/build-frontdoor.mjs` from this checkout. The PostgreSQL harness initializes a fresh loopback cluster; it never accepts a hosted database URL.

## Hosted handoff and limits

No push, Preview/backend deployment, hosted mutation, schema migration, permission change or credential operation was performed for 6.5. No 6.5 deployment script is represented as existing or ready to run. The next separately authorized step is a reviewed Development deployment handoff, followed by authenticated staff/member hosted verification of the same acceptance criteria. Local synthetic browser authentication is not hosted identity verification.

No recurring schedules, templates, bulk creation, linked editing, notification, payment/POS, booking migration, credit movement, reopening, worker behavior, new roles or conflict-detection engine. Existing creation does not guarantee conflict-free instructor/room scheduling.

No new schema, service or scheduler was needed. The single studio lock remains the consistency boundary. The permanent history guarantee for 6.4 still relies on retained reservation rows; future archival needs durable evidence of prior history. R-01 (staff reads depend on optional Square processing tables) remains deferred without runtime changes. Production, Square, worker and unrelated services remain unchanged. Square stays disabled. The canonical hosted 6.4 evidence remains unchanged.
